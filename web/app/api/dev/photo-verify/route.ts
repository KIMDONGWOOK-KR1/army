import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 개발 서버 전용: 정찰원 '사진으로 찾기'의 사진을 로컬 사진 판정 서버(photo-verify)로 넘긴다.
// 판정 서버 주소·키는 이 서버의 환경변수(PV_URL, PV_API_KEY)에만 두고 브라우저에 주지 않는다.
// 사진은 넘기기만 하고 저장하거나 기록하지 않는다. 운영 빌드에서는 없는 주소(404)다.
const SITES = new Set(["gate"]);
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return fail(404, "NOT_FOUND");
  const url = process.env.PV_URL, key = process.env.PV_API_KEY;
  if (!url || !key) return fail(503, "NOT_CONFIGURED");
  const site = request.nextUrl.searchParams.get("site_id") ?? "";
  if (!SITES.has(site)) return fail(404, "UNKNOWN_SITE");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return fail(400, "TOO_LARGE");
  const photo = await request.arrayBuffer();
  if (photo.byteLength === 0) return fail(400, "INVALID_IMAGE");
  if (photo.byteLength > MAX_BYTES) return fail(400, "TOO_LARGE");
  try {
    const upstream = await fetch(`${url.replace(/\/$/, "")}/verify?site_id=${encodeURIComponent(site)}`, {
      method: "POST",
      headers: { "x-pv-key": key, "content-type": "application/octet-stream" },
      body: photo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await upstream.json().catch(() => ({ error: "BAD_UPSTREAM" }));
    // 점수·지연 시간은 개발 확인용으로 그대로 돌려준다. 401(키 불일치)은 설정 문제라 503으로 바꾼다.
    if (upstream.status === 401) return fail(503, "NOT_CONFIGURED");
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return fail(503, "UNREACHABLE");
  }
}
