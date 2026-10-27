import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();
const seats = { commander: 2, scout: 0, signal: 3, cipher: 1 };
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BACKEND", "local");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local solo transport", () => {
  it("creates four seats with the original request id then routes only that room through its selected seat", async () => {
    const snapshot = { game: { id: "mock-solo" }, self: { role: "commander" } };
    fetchMock.mockResolvedValueOnce(Response.json({ ...snapshot, solo: { seats } }));
    const client = await import("../lib/client");
    await expect(client.requestGameAny({ action: "create-solo", request_id: "mock-setup" })).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/game/solo", expect.objectContaining({
      body: JSON.stringify({ setup: true, request_id: "mock-setup" }),
    }));
    client.setSoloRole("mock-solo", "scout");
    const command = { action: "get-game", game_id: "mock-solo" };
    fetchMock.mockResolvedValueOnce(Response.json(snapshot));
    await client.requestGameAny(command);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/game/solo", expect.objectContaining({
      body: JSON.stringify({ seat: 0, command, team: false }),
    }));
    fetchMock.mockResolvedValueOnce(Response.json(snapshot));
    await client.requestGameAny({ action: "get-game", game_id: "mock-four-player" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/game", expect.anything());
  });

  it("keeps solo platform throttling and retries the unchanged request id without automatic resubmission", async () => {
    storage.set("hoguk:solo", JSON.stringify({ game: "mock-solo", seats, role: "scout" }));
    fetchMock.mockResolvedValueOnce(new Response("Too many requests", { status: 429, headers: { "Retry-After": "1" } }));
    const { requestGameAny } = await import("../lib/client");
    const command = { action: "submit-step", game_id: "mock-solo", request_id: "mock-same-request" };
    await expect(requestGameAny(command)).rejects.toMatchObject({ code: "REQUEST_THROTTLED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ game: { id: "mock-solo" } }));
    await requestGameAny(command);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body);
  });

  it("keeps seats in the current tab when browser storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    fetchMock.mockResolvedValueOnce(Response.json({ game: { id: "mock-solo" }, solo: { seats } }));
    const client = await import("../lib/client");
    await client.requestGameAny({ action: "create-solo", request_id: "mock-setup" });
    client.setSoloRole("mock-solo", "signal");
    expect(client.soloFor("mock-solo")).toEqual({ game: "mock-solo", seats, role: "signal" });
  });

  it.each([
    { ...seats, scout: -1 },
    { ...seats, scout: 2 },
  ])("rejects malformed or duplicate seats", async (invalid) => {
    storage.set("hoguk:solo", JSON.stringify({ game: "mock-solo", seats: invalid, role: "scout" }));
    const { soloFor } = await import("../lib/client");
    expect(soloFor("mock-solo")).toBeNull();
  });

  it("does not load local solo seats for the Supabase backend", async () => {
    vi.stubEnv("NEXT_PUBLIC_BACKEND", "supabase");
    storage.set("hoguk:solo", JSON.stringify({ game: "mock-solo", seats, role: "scout" }));
    const { soloFor } = await import("../lib/client");
    expect(soloFor("mock-solo")).toBeNull();
  });
});

describe("camera permission scope", () => {
  it.each([
    { mode: "production", backend: "local", allowed: false },
    { mode: "development", backend: "supabase", allowed: false },
    { mode: "development", backend: "local", allowed: true },
  ])("allows camera overrides only for local development ($mode/$backend)", async ({ mode, backend, allowed }) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("NEXT_PUBLIC_BACKEND", backend);
    const config = (await import("../next.config")).default;
    const headers = await config.headers!();
    const cameraRoutes = headers.filter((route) => route.headers.some((header) =>
      header.key === "Permissions-Policy" && header.value.includes("camera=(self)"))).map((route) => route.source);
    expect(cameraRoutes).toEqual(allowed ? ["/dev/scout-photo", "/", "/j/:code"] : []);
  });
});
