import { NextRequest, NextResponse } from "next/server";
import { localRequest } from "@/lib/server/store";
import { DomainError } from "@/supabase/functions/_shared/engine";
import type { Command } from "@/supabase/functions/_shared/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store, private" };
  if (process.env.NEXT_PUBLIC_BACKEND === "supabase" || process.env.VERCEL)
    return NextResponse.json(
      {
        code: "LOCAL_DISABLED",
        message: "로컬 시연 서버는 이 환경에서 사용할 수 없다.",
      },
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
  const session =
    raw && /^[a-f0-9-]{36}$/.test(raw) ? raw : crypto.randomUUID();
  try {
    const body = await req.text();
    if (body.length > 8192)
      throw new DomainError("INVALID_REQUEST", "요청이 너무 크다.");
    let cmd: Command;
    try {
      cmd = JSON.parse(body);
    } catch {
      throw new DomainError("INVALID_REQUEST", "요청 형식이 올바르지 않다.");
    }
    if (!cmd || typeof cmd.action !== "string")
      throw new DomainError("INVALID_REQUEST", "요청 이름이 필요하다.");
    const data = await localRequest(session, cmd),
      response = NextResponse.json(data, { headers });
    response.cookies.set("hoguk_session", session, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 86400,
      path: "/",
    });
    return response;
  } catch (e) {
    const error =
      e instanceof DomainError
        ? e
        : new DomainError(
            "SERVER_ERROR",
            "연결을 처리하지 못했다. 잠시 뒤 다시 시도하라.",
          );
    if (!(e instanceof DomainError)) console.error("game request failed", e);
    const status =
      error.code === "NO_GAME"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "SERVER_ERROR"
            ? 500
            : 400;
    const response = NextResponse.json(
      { code: error.code, message: error.message, retry_at: error.retry_at },
      { status, headers },
    );
    response.cookies.set("hoguk_session", session, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 86400,
      path: "/",
    });
    return response;
  }
}
