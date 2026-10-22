import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/client";
import { refreshCurrentGame } from "../lib/refresh-game";
import type { V2Response } from "../lib/game-snapshot";

// Only the public fields used by the refresh planner are needed here.
const room = (stage: string, phase = "mission") => ({ stage: { schema_version: 2 }, game: { id: "demo-room", stage_id: stage, status: "playing", site_phase: phase } }) as V2Response;
describe("current-stage refresh", () => {
  it("recovers when departure races a stage read, without retrying a mutation", async () => {
    const old = room("gate"), next = room("yongbong", "travel");
    const request = vi.fn().mockResolvedValueOnce(old).mockRejectedValueOnce(new ApiError("STALE_STAGE", "stage moved")).mockResolvedValueOnce(next);
    expect(await refreshCurrentGame(request, "demo-room")).toBe(next);
    expect(request.mock.calls.map(([command]) => command)).toEqual([
      { action: "get-game", game_id: "demo-room" },
      { action: "get-stage", game_id: "demo-room", stage_id: "gate" },
      { action: "get-game", game_id: "demo-room" },
    ]);
  });
  it("keeps connection and permission failures visible", async () => {
    for (const code of ["NETWORK", "FORBIDDEN"]) {
      const error = new ApiError(code, "request failed");
      const request = vi.fn().mockResolvedValueOnce(room("gate")).mockRejectedValueOnce(error);
      await expect(refreshCurrentGame(request)).rejects.toBe(error);
      expect(request).toHaveBeenCalledTimes(2);
    }
  });
  it("bounds recovery to one room re-read", async () => {
    const error = new ApiError("NETWORK", "recovery failed");
    const request = vi.fn().mockResolvedValueOnce(room("gate")).mockRejectedValueOnce(new ApiError("STALE_STAGE", "stage moved")).mockRejectedValueOnce(error);
    await expect(refreshCurrentGame(request)).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(3);
  });
});
