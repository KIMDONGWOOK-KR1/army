import { describe, expect, it } from "vitest";
import { team } from "./helpers/v2";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { allowsSimulatedArrival, hasGpsArrival } from "../supabase/functions/_shared/arrival-policy";
import { jnuGpsArrival, JNU_GPS_POINTS } from "../supabase/functions/_shared/jnu-gps";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { ROLES, type Command } from "../supabase/functions/_shared/types";
import { judgeArrival } from "../lib/arrival";
import source from "../../codex-handoff-v2/data/courses/jnu-v2.course.json";

async function gpsTeam() {
  const t = await team({ arrive: false });
  t.course.stages[1].arrival = jnuGpsArrival("gate");
  return t;
}

describe("GPS mandatory v2 arrival", () => {
  it("keeps all missions private until all four arrive; receipts and roles survive reload", async () => {
    const t = await gpsTeam();
    const roles = t.game.members.map(m => m.role);
    const protectedCommands: Command[] = [
      { action: "get-stage" }, { action: "submit-step", step_id: "G-01.order", answer: [] },
      { action: "submit-report" }, { action: "request-hint", target_role: "signal", level: 1 },
      { action: "open-lock", digits: [0, 0, 0, 0] },
      { action: "confirm-explanation" }, { action: "open-after-explanation" },
    ];
    for (const role of ROLES.slice(0, 3)) {
      await t.call(role, { action: "report-arrival", method: "gps" });
    }
    expect(t.game.phase).toBe("travel");
    for (const command of protectedCommands)
      await expect(t.call("commander", command)).rejects.toMatchObject({ code: "WRONG_PHASE" });
    for (const role of ROLES) {
      const view = projectGameV2(t.game, t.course, t.user(role), t.now());
      expect(view.self.mission).toBeNull();
      expect(view.self.hints).toEqual([]);
      expect(view.self).not.toHaveProperty("transfer_clue");
      expect(view.game.arrival_mask).toEqual([true, true, true, false]);
    }
    const last = { action: "report-arrival", method: "gps", request_id: "last-arrival" } as const;
    await t.call("cipher", last);
    const state = structuredClone(t.game);
    await t.call("cipher", last);
    expect(t.game).toEqual(state);
    expect(t.game.phase).toBe("mission");
    expect(t.game.arrivals).toHaveLength(4);
    expect(t.game.members.map(m => m.role)).toEqual(roles);
    const restored = projectGameV2(structuredClone(t.game), t.course, t.user("cipher"), t.now());
    expect(restored.self.mission).not.toBeNull();
    expect(restored.game.arrival_mask.every(Boolean)).toBe(true);
    expect(t.game.arrivals.every(a => !a.manual && !a.simulated)).toBe(true);
    expect(Object.keys(t.game.arrivals[0]).sort()).toEqual(["at", "manual", "memberId", "simulated", "siteId"]);
  });
  it("rejects manual, QR, simulated and role-exchange bypasses without mutation", async () => {
    const t = await gpsTeam();
    t.advance(60000);
    for (const extra of [{ method: "manual" }, { manual: true }, { method: "qr" }, { method: "simulated" }] as const) {
      const before = structuredClone(t.game);
      await expect(t.call("commander", { action: "report-arrival", ...extra })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(t.game).toEqual(before);
    }
    await expect(t.call("commander", { action: "propose-swap" })).rejects.toMatchObject({ code: "INVALID_ACTION" });
    expect(t.game.arrivals).toHaveLength(0);
  });
  it("fails closed for unconfirmed, missing, non-GPS or any-member settings", async () => {
    for (const change of [{ confirmed: false }, { lat: null }, { mode: "manual" as const }, { require: "any" as const }, { radiusM: NaN }, { dwellSec: 0 }]) {
      const t = await gpsTeam();
      Object.assign(t.course.stages[1].arrival, change);
      await expect(t.call("scout", { action: "report-arrival", method: "gps" })).rejects.toMatchObject({ code: "CONTENT_UNCONFIRMED" });
      expect(t.game.arrivals).toHaveLength(0);
    }
  });
  it("prevents another member or a different stage from being reported", async () => {
    const t = await gpsTeam();
    await expect(t.callUser("outsider", { action: "report-arrival", method: "gps" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(t.call("scout", { action: "report-arrival", method: "gps", stage_id: "future" })).rejects.toMatchObject({ code: "STALE_STAGE" });
    await t.call("scout", { action: "report-arrival", method: "gps" });
    await t.call("scout", { action: "report-arrival", method: "gps" });
    expect(t.game.arrivals).toHaveLength(1);
    expect(t.game.arrivals[0].memberId).toBe(t.game.members.find(m => m.role === "scout")!.id);
    expect(t.game.phase).toBe("travel");
  });
});

describe("10m targets and dev field preset", () => {
  it("keeps public gate metadata aligned with the approved coordinate configuration", () => {
    expect(source.stages.find(s => s.id === "gate")!.arrival).toEqual(jnuGpsArrival("gate"));
    for (const key of Object.keys(JNU_GPS_POINTS) as (keyof typeof JNU_GPS_POINTS)[]) {
      expect(hasGpsArrival(jnuGpsArrival(key))).toBe(true);
      expect(jnuGpsArrival(key).radiusM).toBe(10);
    }
  });
  it("accepts 9m, rejects 11m, and resets dwell on exit or poor accuracy", () => {
    const target = { lat: 0, lng: 0, radiusM: 10 };
    const point = (i: number, meters: number, accuracy = 5) => ({ lat: meters / 6371000 * 180 / Math.PI, lng: 0, accuracy, timestamp: i * 1000 });
    expect(judgeArrival(Array.from({ length: 8 }, (_, i) => point(i, 9)), target).arrived).toBe(true);
    expect(judgeArrival(Array.from({ length: 20 }, (_, i) => point(i, 11)), target).arrived).toBe(false);
    const near = Array.from({ length: 7 }, (_, i) => point(i, 9));
    expect(judgeArrival([...near, point(7, 100), point(8, 9)], target).arrived).toBe(false);
    expect(judgeArrival([...near, point(7, 9, 41)], target)).toMatchObject({ arrived: false, distance: null, dwell: 0 });
    expect(judgeArrival(near, { ...target, radiusM: Infinity }).arrived).toBe(false);
  });
  it("registers a new GPS-only dev preset while keeping the production guard", async () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${"a".repeat(20)}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: crypto.randomUUID(), ANSWER_SALT: crypto.randomUUID() };
    const { course } = await prepareDemoSeed(["--dev-project-ref", "a".repeat(20), "--course-id", "jnu-demo-dev-gps-test", "--schema-version", "2", "--preset", "v1-gate-gps"], env);
    if (!("stages" in course)) throw new Error("v2 required");
    expect(course.stages[0].arrival).toEqual(jnuGpsArrival("gate"));
    expect(course).toMatchObject({ demo: true, confirmed: false });
    expect(allowsSimulatedArrival(course, course.stages[0].arrival)).toBe(false);
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow();
    expect(() => assertEdgeCourseAllowed(course, "true")).not.toThrow();
  });
});
