"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ROLES, type Command, type Role, type Snapshot } from "@/supabase/functions/_shared/types";
import { isV2Response, type GameResponse, type V2Response } from "./game-snapshot";
export const backend =
  process.env.NEXT_PUBLIC_BACKEND === "supabase" ? "supabase" : "local";
let supabase: SupabaseClient | null = null,
  authentication: Promise<string> | null = null;
export function getSupabase() {
  if (backend !== "supabase") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 연결 설정을 확인하라.");
  return (supabase ??= createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }));
}
function token() {
  const client = getSupabase()!;
  return (authentication ??= (async () => {
    const { data } = await client.auth.getSession();
    if (data.session) return data.session.access_token;
    const { data: created, error } = await client.auth.signInAnonymously();
    if (error || !created.session)
      throw new Error("익명 세션을 만들지 못했다. 연결을 확인하라.");
    return created.session.access_token;
  })().finally(() => {
    authentication = null;
  }));
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retry_at?: number,
  ) {
    super(message);
  }
}
// 혼자 데모 체험(로컬 전용): 이 기기가 네 자리(본인 + 시연 동료 셋)를 맡는다.
// 방마다 보직별 자리와 지금 보고 있는 보직을 적어 두고, 모든 요청을 그 자리로 보낸다.
const SOLO_KEY = "hoguk:solo";
export type SoloSeats = { game: string; seats: Record<Role, number>; role: Role };
export function soloFor(gameId?: string | null): SoloSeats | null {
  if (backend !== "local" || !gameId || typeof localStorage === "undefined") return null;
  try {
    const v = JSON.parse(localStorage.getItem(SOLO_KEY) ?? "null") as SoloSeats | null;
    return v?.game === gameId && ROLES.includes(v.role) &&
      ROLES.every((r) => Number.isInteger(v.seats?.[r])) ? v : null;
  } catch {
    return null;
  }
}
export function setSoloRole(gameId: string, role: Role) {
  const v = soloFor(gameId);
  if (!v) return;
  try {
    localStorage.setItem(SOLO_KEY, JSON.stringify({ ...v, role }));
  } catch {
    // 저장하지 못하면 다음 요청도 지금 자리로 간다
  }
}

async function requestSnapshot(command: Command): Promise<GameResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const creatingSolo = command.action === "create-solo",
    solo = creatingSolo ? null : soloFor(command.game_id);
  const endpoint =
    backend === "local"
      ? creatingSolo || solo ? "/api/game/solo" : "/api/game"
      : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/game`;
  if (backend === "supabase") {
    headers.Authorization = `Bearer ${await token()}`;
    headers.apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(creatingSolo
        ? { setup: true, request_id: command.request_id }
        : solo
          ? { seat: solo.seats[solo.role], command,
              team: command.action === "report-arrival" && command.method === "simulated" }
          : command),
      cache: "no-store",
      credentials: backend === "local" ? "same-origin" : "omit",
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "연결이 끊겼다. 화면은 유지된다. 다시 연결하라.",
    );
  }
  let data: GameResponse & { code?: string; message?: string; retry_at?: number };
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "NETWORK",
      "응답을 확인하지 못했다. 같은 요청으로 다시 시도하라.",
    );
  }
  // 네 곳 시연 코스가 없는 서버면 예전 혼자 시연(두 곳)으로 연다
  if (creatingSolo && data.code === "SOLO_UNAVAILABLE")
    return requestSnapshot({ ...command, action: "create-demo" });
  if (!response.ok)
    throw new ApiError(
      data.code ?? "SERVER_ERROR",
      data.message ?? "연결을 확인하라.",
      data.retry_at,
    );
  if (creatingSolo && "solo" in data) {
    const { solo: seats, ...snapshot } = data as GameResponse & { solo: { seats: Record<Role, number> } };
    try {
      localStorage.setItem(SOLO_KEY, JSON.stringify({ game: snapshot.game.id, seats: seats.seats, role: "commander" }));
    } catch {
      // 자리를 적지 못하면 본인 자리(지휘관이 아닐 수도 있다)로만 진행한다
    }
    return snapshot;
  }
  return data;
}

export async function requestGame(command: Command): Promise<Snapshot> {
  const data = await requestSnapshot(command);
  if (isV2Response(data))
    throw new ApiError("SCHEMA_MISMATCH", "이 방은 v2 코스다. /verify 확인 화면에서 연결하라.");
  return data;
}

/** Keep the authenticated transport unchanged while the main UI accepts either course schema. */
export function requestGameAny(command: Command): Promise<GameResponse> {
  return requestSnapshot(command);
}

export async function requestGameV2(command: Command): Promise<V2Response> {
  const data = await requestSnapshot(command);
  if (!isV2Response(data))
    throw new ApiError("SCHEMA_MISMATCH", "현재 방은 v1 코스다. 기존 화면을 이용하거나 v2 합성 코스 설정을 확인하라.");
  return data;
}
