import { describe, expect, it } from "vitest";
import { fullTeam } from "./helpers/full-v2";
import { fullDemoCourseV2, fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { ROLES, type Command } from "../supabase/functions/_shared/types";

describe("wall and Bongji completion", () => {
  it("rejects a memorial relay in seed and suppresses it in live and completed projections", async () => {
    const { content } = fullDemoV2Input("jnu-demo-dev-relay-test");
    const ref = { role: "scout" as const, stepId: "W-01.activities" };
    const step = content.stages[2].roles.signal!.steps[0];
    step.recordFrom = ref; step.requires = [ref];
    expect(() => validateCourseV2Content(content)).toThrow("추모·회고의 개인 기록");
    const t = await fullTeam(); await t.arrive(); await t.wallReady();
    // Defend projection even if an older/bad authoring path stored a relay declaration.
    t.course.stages[2].roles.signal!.steps[0].recordFrom = ref;
    expect(t.view("signal").self.shared_records).toEqual([]);
    expect(JSON.stringify(t.view("signal"))).not.toContain("wall-scout 비공개");
    await t.draft(); for (const role of ROLES) await t.call(role, { action: "confirm-stage", draft_version: 1 });
    expect(t.view("signal").self.journal.find((j) => j.stage_id === "wall")?.shared_records).toEqual([]);
    expect(JSON.stringify(t.view("signal"))).not.toContain("wall-scout 비공개");
  });
  it("requires four fresh arrivals, reports and independent versioned memorial confirmations", async () => {
    const t = await fullTeam();
    expect(t.view("scout").self.mission).toBeNull();
    await expect(t.draft()).rejects.toMatchObject({ code: "WRONG_PHASE" });
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "report-arrival", method: "simulated" });
    expect(t.view("scout").self.mission).toBeNull();
    await t.call("cipher", { action: "report-arrival", method: "simulated" });
    await expect(t.draft()).rejects.toMatchObject({ code: "REPORTS_REQUIRED" });
    await t.wallReady(); await t.draft();
    await t.call("scout", { action: "confirm-stage", draft_version: 1, request_id: "confirm-once" });
    const version = t.game.version, count = t.events.length;
    await t.call("scout", { action: "confirm-stage", draft_version: 1, request_id: "confirm-once" });
    expect(t.game.version).toBe(version); expect(t.events).toHaveLength(count);
    await t.draft("draft-memorial-record", 1, { reason: "[합성] 수정한 근거" });
    expect(t.view("cipher").self.memorial_record?.confirm_mask).toEqual([false, false, false, false]);
    await expect(t.call("scout", { action: "confirm-stage", draft_version: 1 })).rejects.toMatchObject({ code: "STALE_DRAFT" });
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "confirm-stage", draft_version: 2 });
    expect(t.game.phase).toBe("mission");
    await t.call("cipher", { action: "confirm-stage", draft_version: 2 });
    expect(t.game.phase).toBe("cleared"); expect(t.game.v2!.sacho.wall).toBeDefined();
    expect(t.game.v2!.jointRecords).toBeUndefined(); expect(t.game.locks.wall).toBeUndefined();
    await expect(t.draft("draft-memorial-record", 2)).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });

  it("keeps wall score unchanged for incorrect answers, hints, reports and final confirmation", async () => {
    const t = await fullTeam(); await t.arrive(); const score = t.game.score;
    await t.call("scout", { action: "submit-step", step_id: "W-01.people", answer: ["[합성] 다른 가", "[합성] 다른 나"],
      method: "field", source: { text: "[합성] 출처" } });
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await t.call("commander", { action: "request-hint", target_role: role, level });
      await t.call(role, { action: "submit-report" });
      expect(t.game.score).toBe(score);
    }
    for (const action of ["open-lock", "open-after-explanation", "confirm-explanation"])
      await expect(t.call("commander", { action })).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await t.draft();
    for (const role of ROLES) await t.call(role, { action: "confirm-stage", draft_version: 1 });
    expect(t.game.score).toBe(score); expect(t.view("commander").self.lock).toBeNull();
    expect(t.view("commander").game.attempts_left).toBe(0);
  });

  it("invalidates every consent on retro edits and completes only after four current consents", async () => {
    const t = await fullTeam(); await t.arrive(); await t.wallComplete(); await t.depart(); await t.arrive();
    await expect(t.call("commander", { action: "get-result" })).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await expect(t.draft("draft-joint-record")).rejects.toMatchObject({ code: "REPORTS_REQUIRED" });
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `[합성] ${role} 개인 회고` });
    await t.draft("draft-joint-record");
    await t.call("commander", { action: "consent-joint-record", draft_version: 1 });
    await t.call("scout", { action: "submit-retro", text: "[합성] scout 개인 회고 수정" });
    expect(t.view("commander").self.joint_record).toMatchObject({ draft_version: 2, confirm_mask: [false, false, false, false] });
    await expect(t.call("commander", { action: "consent-joint-record", draft_version: 1 })).rejects.toMatchObject({ code: "STALE_DRAFT" });
    await t.call("scout", { action: "submit-retro", text: "[합성] scout 개인 회고 수정" });
    expect(t.view("commander").self.joint_record?.draft_version).toBe(2);
    await t.draft("draft-joint-record", 2, { text: "[합성] 수정 공동 문장" });
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "consent-joint-record", draft_version: 3 });
    expect(t.game.status).toBe("playing");
    const command = { action: "consent-joint-record", draft_version: 3, request_id: "finish-once" };
    await t.call("cipher", command); const version = t.game.version, events = t.events.length;
    await t.call("cipher", command);
    expect(t.game.version).toBe(version); expect(t.events).toHaveLength(events);
    expect(t.game.status).toBe("done"); expect(t.game.endedAt).not.toBeNull();
    expect(Object.keys(t.game.v2!.sacho)).toEqual(["gate", "yongbong", "wall"]);
    expect(t.view("cipher").game.acquired_sites).toHaveLength(3);
    const result = await t.call("cipher", { action: "get-result" });
    expect(result).toMatchObject({ investigation: { completed: 3, total: 3 }, sacho: { completed: 3, total: 3 }, time_score: null, ranking: null });
    for (const action of ["submit-retro", "draft-joint-record", "consent-joint-record", "depart-next-site"])
      await expect(t.call("commander", { action, text: "[합성] 종료 후 수정", draft_version: 3 })).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await expect(t.callUser("outsider", { action: "get-result" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("projects personal prose only to its author during missions, journals and results", async () => {
    const t = await fullTeam(); await t.arrive(); await t.wallComplete();
    for (const viewer of ROLES) {
      const s = t.view(viewer);
      for (const other of ROLES.filter((r) => r !== viewer)) expect(JSON.stringify(s)).not.toContain(`wall-${other} 비공개`);
      expect(JSON.stringify(s.game)).not.toContain("비공개");
      expect(s.self.memorial_record?.text).toBe("[합성] 함께 작성한 문장");
      expect(s.self.joint_record).toBeUndefined();
    }
    await t.depart(); await t.arrive();
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `[합성] ${role} 개인 회고` });
    await t.draft("draft-joint-record");
    const check = () => { for (const viewer of ROLES) {
      const s = t.view(viewer);
      expect(s.self.retro).toBe(`[합성] ${viewer} 개인 회고`);
      for (const other of ROLES.filter((r) => r !== viewer)) {
        expect(JSON.stringify(s)).not.toContain(`${other} 개인 회고`);
        // Yongbong's explicit signal -> cipher relay is an earlier, scoped exception.
        expect(JSON.stringify(s.self.result ?? null)).not.toContain(`wall-${other} 비공개`);
      }
      expect(JSON.stringify(s.game)).not.toMatch(/개인 회고|함께 작성한|확인한 근거/);
      expect(s.self.memorial_record).toBeUndefined();
    } };
    check(); for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 1 }); check();
    expect(JSON.stringify(t.events)).not.toMatch(/비공개|개인 회고|함께 작성한|answerHash|answer|salt/);
    expect(JSON.stringify(t.game.v2)).not.toContain("연습 인물 가");
  });

  it("rejects impersonation, malformed drafts and bypasses without modifying state", async () => {
    const t = await fullTeam(); await t.arrive(); await t.wallReady();
    for (const cmd of [
      { action: "draft-memorial-record", draft_version: 0 },
      { action: "confirm-stage", draft_version: 0 },
      { action: "submit-retro", text: "[합성] 잘못된 단계" },
      { action: "confirm-stage", role: "commander" },
    ] as Command[]) {
      const before = structuredClone(t.game);
      await expect(t.call("scout", cmd)).rejects.toBeDefined(); expect(t.game).toEqual(before);
    }
    for (const extra of [{ words: ["unknown"] }, { text: " " }, { reason: "x".repeat(601) }, { draft_version: 0.5 }]) {
      const before = structuredClone(t.game);
      await expect(t.draft("draft-memorial-record", 0, extra)).rejects.toBeDefined(); expect(t.game).toEqual(before);
    }
    await t.wallComplete().catch(() => { throw new Error("already solved steps should replay safely"); });
    await t.depart(); await t.arrive();
    for (const action of ["request-hint", "submit-step", "submit-report", "confirm-stage"])
      await expect(t.call("commander", { action })).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });

  it("seeds only a dev revision with caller salt and leaves wall GPS unconfirmed", async () => {
    const salt = crypto.randomUUID(), id = "jnu-demo-dev-full-seed", ref = "abcdefghijklmnopqrst";
    const { course } = await prepareDemoSeed(["--dev-project-ref", ref, "--course-id", id, "--schema-version", "2", "--preset", "full-course"],
      { ANSWER_SALT: salt, SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-a-credential", NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` });
    expect(course).toEqual(await fullDemoCourseV2(id, salt));
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow();
    if (!("stages" in course)) throw new Error("expected v2");
    expect(course.stages.find((s) => s.id === "wall")?.arrival).toMatchObject({ confirmed: false, lat: null, lng: null });
    expect(course.stages.every((s) => !s.arrival.confirmed)).toBe(true);
    const { content } = fullDemoV2Input(id); content.stages[2].scoring.enabled = true;
    expect(() => validateCourseV2Content(content)).toThrow();
  });
});
