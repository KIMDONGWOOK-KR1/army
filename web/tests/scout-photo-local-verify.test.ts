import { afterEach, describe, expect, it, vi } from "vitest";
import { judgeWithLocalVerifier } from "../lib/scout-photo/local-verify";

const photo = new Blob(["synthetic"], { type: "image/jpeg" });
const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe("local photo verifier mapping", () => {
  it("maps verifier replies to photo outcomes", async () => {
    respond(200, { match: true, reason_code: "MATCH" });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("match");
    respond(200, { match: false, reason_code: "NO_MATCH" });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("no_match");
    respond(200, { match: false, reason_code: "RETAKE" });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("retake");
    respond(400, { error: "INVALID_IMAGE" });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("retake");
    respond(503, { error: "NOT_READY" });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("service_error");
    respond(200, { unexpected: true });
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("service_error");
  });

  it("posts only to the same-origin dev route", async () => {
    respond(200, { match: true, reason_code: "MATCH" });
    await judgeWithLocalVerifier("gate", photo);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/dev/photo-verify?site_id=gate");
    expect(init).toMatchObject({ method: "POST", body: photo });
    expect(JSON.stringify(init?.headers)).not.toMatch(/x-pv-key/i);
  });

  it("treats a network failure as a retryable outage but rethrows a cancel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    expect(await judgeWithLocalVerifier("gate", photo)).toBe("service_error");
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(judgeWithLocalVerifier("gate", photo, controller.signal)).rejects.toThrow("aborted");
  });
});
