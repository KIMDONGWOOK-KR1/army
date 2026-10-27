import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.UTC(2026, 9, 23, 1, 2, 3);
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BACKEND", "local");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function request(response: Response) {
  fetchMock.mockResolvedValueOnce(response);
  const { requestGameAny } = await import("../lib/client");
  return requestGameAny({ action: "get-game" });
}

describe("client platform throttling", () => {
  it("normalizes an English JSON 429 and follows Retry-After seconds without retrying", async () => {
    await expect(request(Response.json({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Try again in 1 second.",
      retry_at: NOW + 1000,
    }, { status: 429, headers: { "Retry-After": "5" } }))).rejects.toMatchObject({
      code: "REQUEST_THROTTLED",
      message: expect.stringMatching(/[가-힣]/),
      retry_at: NOW + 5000,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes a numeric platform code and follows an HTTP-date Retry-After", async () => {
    await expect(request(Response.json({
      code: 429,
      message: "Rate limit exceeded.",
    }, { status: 429, headers: { "Retry-After": new Date(NOW + 7000).toUTCString() } }))).rejects.toMatchObject({
      code: "REQUEST_THROTTLED",
      message: expect.stringMatching(/[가-힣]/),
      retry_at: NOW + 7000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes a non-JSON 429 with the two-second fallback instead of parsing English text", async () => {
    await expect(request(new Response("Too many requests. Retry in 1 second.", {
      status: 429, headers: { "Content-Type": "text/plain" },
    }))).rejects.toMatchObject({
      code: "REQUEST_THROTTLED",
      message: expect.stringMatching(/[가-힣]/),
      retry_at: NOW + 2000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: "COOLDOWN", message: "[합성] 자물쇠 대기 중", retry_at: NOW + 60000 },
    { code: "RATE_LIMITED", message: "[합성] 합류 요청 대기 중", retry_at: NOW + 30000 },
  ])("preserves the application $code message and deadline even with Retry-After", async (domain) => {
    await expect(request(Response.json(domain, {
      status: 429, headers: { "Retry-After": "90" },
    }))).rejects.toMatchObject(domain);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing non-429 server error unchanged", async () => {
    await expect(request(Response.json({
      code: "SERVER_ERROR", message: "[합성] 서버 연결 오류",
    }, { status: 500 }))).rejects.toMatchObject({
      code: "SERVER_ERROR", message: "[합성] 서버 연결 오류", retry_at: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a successful synthetic transport payload unchanged", async () => {
    const body = {
      version: 1,
      game: { id: "mock-client-game", status: "lobby" },
      self: { id: "mock-client-member" },
    };
    await expect(request(Response.json(body))).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/game", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ action: "get-game" }),
      credentials: "same-origin",
    }));
  });
});
