import { describe, expect, it } from "vitest";
import { dispatchSoloV2 } from "../lib/server/solo-v2";
import { createGame, dispatch } from "../supabase/functions/_shared/engine";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { storyBDemoCourseV2 } from "../supabase/functions/_shared/story-b-course-v2";
import { ROLES, type Command, type GameEvent } from "../supabase/functions/_shared/types";
import { syntheticStoryAnswers } from "./helpers/story-b";

async function solo() {
  const salt = crypto.randomUUID(), now = 100000;
  const course = await storyBDemoCourseV2("jnu-demo-dev-solo-test", salt, syntheticStoryAnswers());
  const game = createGame("owner", "체험", course, now, "SOLO");
  game.demoOwner = "owner";
  game.members[0].role = "commander";
  for (const role of ROLES.slice(1)) game.members.push({ id: role, userId: role, nickname: role, role, ready: true, lastSeen: now });
  game.status = "playing"; game.phase = "travel";
  const events: GameEvent[] = [];
  const call = (cmd: Command) => dispatchSoloV2(game, course, "owner", {
    request_id: crypto.randomUUID(), stage_id: course.stages[game.v2!.stageIndex].id, ...cmd,
  }, now, salt, events);
  return { game, course, salt, now, events, call };
}

describe("local v2 solo rehearsal", () => {
  it("arrives all four companions atomically and replays the request once", async () => {
    const t = await solo(), cmd = { action: "report-arrival", method: "simulated" as const, request_id: "arrival" };
    await t.call(cmd); const before = structuredClone(t.game);
    expect(t.game.phase).toBe("mission"); expect(t.game.arrivals).toHaveLength(4);
    expect(t.events).toHaveLength(4); expect(t.game.arrivals.every((a) => a.simulated)).toBe(true);
    await t.call(cmd); expect(t.game).toEqual(before); expect(t.events).toHaveLength(4);
    await expect(t.call({ ...cmd, stage_id: "wall" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("switches only the owner, preserves progress and rejects conflicting retries", async () => {
    const t = await solo(); await t.call({ action: "report-arrival", method: "simulated" });
    const cmd = { action: "demo-role", demo_role: "scout" as const, request_id: "switch" };
    await t.call(cmd); const before = structuredClone(t.game);
    expect(projectGameV2(t.game, t.course, "owner", t.now).self.role).toBe("scout");
    expect(projectGameV2(t.game, t.course, "owner", t.now).game.solo_demo).toBe(true);
    await t.call(cmd); expect(t.game).toEqual(before);
    await expect(t.call({ ...cmd, demo_role: "signal" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(dispatchSoloV2(t.game, t.course, "signal", cmd, t.now, t.salt, [])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cannot switch roles in a team room or skip a stage from a solo room", async () => {
    const t = await solo();
    await expect(t.call({ action: "depart-next-site" })).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await expect(t.call({ action: "demo-jump", stage: "done" })).rejects.toMatchObject({ code: "INVALID_ACTION" });
    t.game.demoOwner = null;
    expect(projectGameV2(t.game, t.course, "owner", t.now).game.solo_demo).toBe(false);
    await expect(t.call({ action: "demo-role", demo_role: "scout" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dispatch(t.game, t.course, "owner", { action: "demo-role", demo_role: "scout", request_id: "spoof" }, t.now, t.salt, [])).rejects.toBeTruthy();
  });

  it("rejects invalid arrival without partial updates and does not turn GPS into simulated arrival", async () => {
    const t = await solo(), before = structuredClone(t.game);
    await expect(t.call({ action: "report-arrival", stage_id: "wall", method: "simulated" })).rejects.toMatchObject({ code: "STALE_STAGE" });
    expect(t.game).toEqual(before); expect(t.events).toHaveLength(0);
    await expect(t.call({ action: "report-arrival", method: "gps" })).rejects.toBeTruthy();
    expect(t.game.arrivals).toHaveLength(0);
  });
});
