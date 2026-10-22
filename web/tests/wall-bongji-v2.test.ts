import { describe, expect, it } from "vitest";
import { fullTeam } from "./helpers/full-v2";
import { fullDemoCourseV2, fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { ROLES, type Command } from "../supabase/functions/_shared/types";

describe("wall and Bongji completion", () => {
  it("accepts a tribute only as one confirm step per role on a memorial stage", () => {
    const { content } = fullDemoV2Input("jnu-demo-dev-tribute-test");
    const wall = content.stages[2];
    expect(wall.completion).toEqual({ type: "tribute", label: "국화 올리기" });
    expect(wall.recordTemplate).toBeUndefined();
    const extra = structuredClone(content);
    extra.stages[2].roles.scout!.steps.push({ ...extra.stages[2].roles.scout!.steps[0], id: "W-01.extra" });
    expect(() => validateCourseV2Content(extra)).toThrow("헌화 단계는");
    const graded = structuredClone(content);
    graded.stages[2].roles.signal!.steps[0] = { ...graded.stages[2].roles.signal!.steps[0], type: "text", grading: "open", maxLen: 300 };
    expect(() => validateCourseV2Content(graded)).toThrow("헌화 단계는");
    const outside = structuredClone(content);
    outside.stages[2].kind = "mission";
    expect(() => validateCourseV2Content(outside)).toThrow();
  });
  it("requires four fresh arrivals and completes after four flowers without a shared draft", async () => {
    const t = await fullTeam();
    expect(t.view("scout").self.mission).toBeNull();
    await expect(t.offer("scout")).rejects.toMatchObject({ code: "WRONG_PHASE" });
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "report-arrival", method: "simulated" });
    expect(t.view("scout").self.mission).toBeNull();
    await t.call("cipher", { action: "report-arrival", method: "simulated" });
    expect(t.view("scout").self.mission?.steps).toHaveLength(1);
    await t.offer("scout", { request_id: "flower-once" });
    const version = t.game.version, count = t.events.length;
    await t.offer("scout", { request_id: "flower-once" });
    expect(t.game.version).toBe(version); expect(t.events).toHaveLength(count);
    // 국화를 올린 사람은 팀 전체에 보이고(보고 표시), 다시 올려도 한 송이로 센다
    expect(t.view("commander").game.report_mask).toEqual([false, true, false, false]);
    await t.offer("scout");
    expect(t.view("commander").game.report_mask.filter(Boolean)).toHaveLength(1);
    await expect(t.offer("signal", { answer: "no" })).resolves.toMatchObject({ accepted: false });
    for (const role of ["signal", "cipher"] as const) await t.offer(role);
    expect(t.game.phase).toBe("mission");
    await t.offer("commander");
    expect(t.game.phase).toBe("cleared"); expect(t.game.v2!.sacho.wall).toBeDefined();
    expect(t.game.v2!.memorialRecords).toBeUndefined(); expect(t.game.locks.wall).toBeUndefined();
    expect(t.view("scout").current_site.sacho?.body).toContain("국화");
  });

  it("keeps the wall free of score, hints, reports, drafts and locks", async () => {
    const t = await fullTeam(); await t.arrive(); const score = t.game.score;
    for (const cmd of [
      { action: "request-hint", target_role: "scout", level: 1 },
      { action: "submit-report" },
      { action: "open-lock", digits: [1, 2, 3, 4] },
      { action: "open-after-explanation" },
      { action: "confirm-explanation" },
    ] as Command[]) {
      const before = structuredClone(t.game);
      await expect(t.call("commander", cmd)).rejects.toMatchObject({ code: "WRONG_PHASE" });
      expect(t.game).toEqual(before);
    }
    await expect(t.call("commander", { action: "draft-memorial-record", draft_version: 0, words: [], text: "x", reason: "y" }))
      .rejects.toBeDefined();
    await expect(t.call("scout", { action: "confirm-stage", draft_version: 0 })).rejects.toBeDefined();
    await t.wallComplete();
    expect(t.game.score).toBe(score); expect(t.view("commander").self.lock).toBeNull();
    expect(t.view("commander").self.digit).toBeNull();
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
      expect(JSON.stringify(s.game)).not.toContain("비공개");
      expect(s.self.memorial_record).toBeUndefined();
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
      }
      expect(JSON.stringify(s.game)).not.toMatch(/개인 회고|함께 작성한|확인한 근거/);
      expect(s.self.memorial_record).toBeUndefined();
    } };
    check(); for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 1 }); check();
    expect(JSON.stringify(t.events)).not.toMatch(/비공개|개인 회고|함께 작성한|answerHash|answer|salt/);
  });

  it("rejects impersonation and flowers for other roles without modifying state", async () => {
    const t = await fullTeam(); await t.arrive();
    const other = t.course.stages[2].roles.commander!.steps[0].id;
    for (const cmd of [
      { action: "submit-step", step_id: other, answer: "confirmed", method: "field" },
      { action: "submit-step", step_id: "W-01.tribute", answer: "confirmed", method: "field", role: "commander" },
      { action: "submit-step", step_id: "W-01.tribute", answer: "confirmed", method: "explained" },
      { action: "submit-retro", text: "[합성] 잘못된 단계" },
    ] as Command[]) {
      const before = structuredClone(t.game);
      await expect(t.call("scout", cmd)).rejects.toBeDefined(); expect(t.game).toEqual(before);
    }
    await t.wallComplete();
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
