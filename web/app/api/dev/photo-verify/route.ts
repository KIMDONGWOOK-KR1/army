import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
const fail = (status: number, error: string) => json({ error }, status);

// Local preview only. Credentials, similarity scores and reference data never reach the browser.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL ||
      process.env.NEXT_PUBLIC_BACKEND === "supabase") return fail(404, "NOT_FOUND");
  const origin = request.headers.get("origin");
  const ownOrigin = `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  if ((origin && origin !== ownOrigin) || request.headers.get("sec-fetch-site") === "cross-site")
    return fail(403, "FORBIDDEN");
  if (!/^[a-f0-9-]{36}$/.test(request.cookies.get("hoguk_session")?.value ?? ""))
    return fail(401, "SESSION_REQUIRED");
  if (request.nextUrl.searchParams.get("site_id") !== "gate") return fail(404, "UNKNOWN_SITE");
  if (!["image/jpeg", "image/png"].includes(request.headers.get("content-type")?.split(";")[0] ?? ""))
    return fail(400, "INVALID_IMAGE");
  const url = process.env.PV_URL, key = process.env.PV_API_KEY;
  if (!url || !key) return fail(503, "NOT_CONFIGURED");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail(400, "TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "INVALID_IMAGE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return fail(400, "TOO_LARGE"); }
      chunks.push(value);
    }
    if (!size) return fail(400, "INVALID_IMAGE");
    const photo = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { photo.set(chunk, offset); offset += chunk.length; }
    const upstream = await fetch(`${url.replace(/\/$/, "")}/verify?site_id=gate`, {
      method: "POST", headers: { "X-PV-Key": key, "content-type": "application/octet-stream" },
      body: photo, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
    if ([400, 413, 415, 422].includes(upstream.status)) return fail(400, "INVALID_IMAGE");
    if (!upstream.ok) return fail(503, "UNAVAILABLE");
    const body = await upstream.json();
    if (body?.match === true && body.reason_code === "MATCH")
      return json({ match: true, reason_code: "MATCH" });
    if (body?.match === false && ["NO_MATCH", "RETAKE"].includes(body.reason_code))
      return json({ match: false, reason_code: body.reason_code });
    return fail(503, "INVALID_RESULT");
  } catch {
    return fail(503, "UNAVAILABLE");
  } finally { reader.releaseLock(); }
}
