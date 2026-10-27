import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { localRequest } from "@/lib/server/store";
import { DomainError } from "@/supabase/functions/_shared/engine";
import { domainHttpStatus } from "@/supabase/functions/_shared/game-core";
import type { SnapshotV2 } from "@/supabase/functions/_shared/engine-v2";
import { ROLES, type Command, type Role } from "@/supabase/functions/_shared/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 혼자 데모 체험(로컬 전용): 한 기기가 네 자리(본인 + 시연 동료 셋)를 맡아 4인 방과 같은 네 곳 코스를 끝까지 걷는다.
// 엔진 규칙은 그대로다. 동료 자리도 각자의 세션으로 합류·준비·도착하고, 보직은 서로 바꾸지 않는다.
// 자리 세션은 이 기기의 세션 쿠키에서만 나오므로 다른 기기는 이 자리로 요청할 수 없다.
const NICKNAMES = ["기록자", "솔빛", "너울", "가람"];
const seatSession = (session: string, seat: number) => {
  if (seat === 0) return session;
  const h = createHash("sha256").update(`${session}:solo-seat:${seat}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(session: string, requestId: string) {
  if (!process.env.LOCAL_V2_COURSE_ID)
    throw new DomainError("SOLO_UNAVAILABLE", "이 서버에는 네 곳 시연 코스가 없다.");
  const as = (seat: number, cmd: Command) =>
    localRequest(seatSession(session, seat), cmd) as Promise<SnapshotV2>;
  // 다시 보낸 요청도 이어서 마칠 수 있게 단계마다 지금 상태를 보고 남은 것만 한다
  const created = await as(0, { action: "create-game", request_id: requestId, nickname: NICKNAMES[0] });
  if (!("stage" in created)) throw new DomainError("SOLO_UNAVAILABLE", "이 서버에는 네 곳 시연 코스가 없다.");
  const game_id = created.game.id;
  for (let seat = 1; seat < 4; seat++)
    await as(seat, { action: "join-game", code: created.game.code, nickname: NICKNAMES[seat], request_id: `${requestId}-join${seat}` });
  let lead = await as(0, { action: "get-game", game_id });
  if (lead.game.status === "lobby")
    lead = await as(0, { action: "start-game", game_id, request_id: `${requestId}-start` });
  if (lead.game.status === "briefing" && lead.game.reveal_at)
    await wait(Math.max(0, lead.game.reveal_at - lead.server_now) + 50);
  const seats: SnapshotV2[] = [];
  for (let seat = 0; seat < 4; seat++) {
    let s = await as(seat, { action: "get-game", game_id });
    if (s.game.status === "equip" && !s.self.ready)
      s = await as(seat, { action: "set-ready", game_id, request_id: `${requestId}-ready${seat}` });
    seats.push(s);
  }
  const map = Object.fromEntries(seats.map((s, seat) => [s.self.role, seat])) as Record<Role, number>;
  if (!ROLES.every((r) => Number.isInteger(map[r])))
    throw new DomainError("SERVER_ERROR", "시연 자리 보직을 확인하지 못했다.");
  lead = seats[map.commander];
  if (lead.game.status === "equip")
    lead = await as(map.commander, { action: "begin-operation", game_id, request_id: `${requestId}-begin` });
  return { ...lead, solo: { seats: map } };
}

async function act(session: string, seat: number, cmd: Command, team: boolean) {
  if (["create-game", "create-demo", "create-solo", "join-game", "demo-role"].includes(cmd.action))
    throw new DomainError("FORBIDDEN", "시연 자리는 새 방을 만들거나 다른 방에 합류하지 않는다.");
  const snapshot = await localRequest(seatSession(session, seat), cmd);
  // 모의 도착은 시연 동료도 함께 도착한다(실제 4인 방에서는 각자 폰이 GPS로 도착한다)
  if (!team || cmd.action !== "report-arrival" || cmd.method !== "simulated") return snapshot;
  for (let other = 0; other < 4; other++) {
    if (other === seat) continue;
    try {
      await localRequest(seatSession(session, other), { ...cmd, request_id: `${cmd.request_id}-team${other}` });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }
  return localRequest(seatSession(session, seat), { action: "get-game", game_id: cmd.game_id });
}

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store, private" };
  if (process.env.NEXT_PUBLIC_BACKEND === "supabase" || process.env.VERCEL)
    return NextResponse.json(
      { code: "LOCAL_DISABLED", message: "로컬 시연 서버는 이 환경에서 사용할 수 없다." },
      { status: 403, headers },
    );
  const origin = req.headers.get("origin");
  const ownOrigin = `${req.nextUrl.protocol}//${req.headers.get("host")}`;
  if (origin && origin !== ownOrigin)
    return NextResponse.json(
      { code: "FORBIDDEN", message: "같은 출처의 요청만 허용한다." },
      { status: 403, headers },
    );
  if (!req.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "JSON 요청이 필요하다." },
      { status: 400, headers },
    );
  const raw = req.cookies.get("hoguk_session")?.value;
  const session = raw && /^[a-f0-9-]{36}$/.test(raw) ? raw : crypto.randomUUID();
  let response: NextResponse;
  try {
    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > 8192)
      throw new DomainError("INVALID_REQUEST", "요청이 너무 크다.");
    let input: { setup?: boolean; request_id?: string; seat?: number; command?: Command; team?: boolean };
    try {
      input = JSON.parse(body);
    } catch {
      throw new DomainError("INVALID_REQUEST", "요청 형식이 올바르지 않다.");
    }
    let data;
    if (input?.setup) {
      if (!input.request_id || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.request_id))
        throw new DomainError("INVALID_REQUEST", "요청 식별자가 필요하다.");
      data = await setup(session, input.request_id);
    } else {
      const seat = input?.seat, cmd = input?.command;
      if (typeof seat !== "number" || ![0, 1, 2, 3].includes(seat) || !cmd || typeof cmd.action !== "string")
        throw new DomainError("INVALID_REQUEST", "시연 자리와 요청이 필요하다.");
      data = await act(session, seat, cmd, !!input.team);
    }
    response = NextResponse.json(data, { headers });
  } catch (e) {
    const error = e instanceof DomainError
      ? e
      : new DomainError("SERVER_ERROR", "연결을 처리하지 못했다. 잠시 뒤 다시 시도하라.");
    if (!(e instanceof DomainError)) console.error("solo request failed");
    response = NextResponse.json(
      { code: error.code, message: error.message, retry_at: error.retry_at },
      { status: domainHttpStatus(error.code), headers },
    );
  }
  response.cookies.set("hoguk_session", session, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 86400,
    path: "/",
  });
  return response;
}
