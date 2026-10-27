import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const localRequest = vi.hoisted(() => vi.fn());
vi.mock("../lib/server/store", () => ({ localRequest }));
import { POST } from "../app/api/game/solo/route";

const session = "00000000-0000-4000-8000-000000000001";
const otherSession = "00000000-0000-4000-8000-000000000002";
function post(body: unknown, cookie = session, origin = "http://localhost") {
  return POST(new NextRequest("http://localhost/api/game/solo", {
    method: "POST",
    headers: { host: "localhost", origin, "content-type": "application/json", cookie: `hoguk_session=${cookie}` },
    body: JSON.stringify(body),
  }));
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BACKEND", "local");
  vi.stubEnv("VERCEL", "");
  localRequest.mockReset().mockResolvedValue({ game: { id: "mock-solo" }, self: { id: "mock-member" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("local solo endpoint boundaries", () => {
  it.each(["supabase", "vercel"])("disables the endpoint in %s deployments", async (deployment) => {
    if (deployment === "supabase") vi.stubEnv("NEXT_PUBLIC_BACKEND", "supabase");
    else vi.stubEnv("VERCEL", "1");
    const response = await post({ seat: 0, command: { action: "get-game" } });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("LOCAL_DISABLED");
    expect(localRequest).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests before touching the store", async () => {
    expect((await post({ seat: 0, command: { action: "get-game" } }, session, "https://unrelated.invalid")).status).toBe(403);
    expect(localRequest).not.toHaveBeenCalled();
  });
  it.each(["create-game", "create-demo", "create-solo", "join-game", "demo-role"])("does not let a seat dispatch %s", async (action) => {
    expect((await post({ seat: 1, command: { action } })).status).toBe(403);
    expect(localRequest).not.toHaveBeenCalled();
  });
  it("derives a stable private seat session per owning browser and never accepts a supplied session id", async () => {
    const command = { action: "get-game", game_id: "mock-solo" };
    await post({ seat: 1, command, session: otherSession });
    const derived = localRequest.mock.calls[0][0];
    expect(derived).not.toBe(session);
    expect(derived).not.toBe(otherSession);
    await post({ seat: 1, command });
    expect(localRequest.mock.calls[1][0]).toBe(derived);
    await post({ seat: 1, command }, otherSession);
    expect(localRequest.mock.calls[2][0]).not.toBe(derived);
  });
  it("enforces the 8KB request limit using UTF-8 bytes", async () => {
    const response = await post({ seat: 0, command: { action: "submit-retro", text: "가".repeat(3000) } });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_REQUEST");
    expect(localRequest).not.toHaveBeenCalled();
  });
});
