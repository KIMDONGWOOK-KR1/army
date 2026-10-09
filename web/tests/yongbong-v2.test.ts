import { describe, expect, it } from "vitest";
import { createGame, dispatch } from "../supabase/functions/_shared/engine";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { yongbongDemoInput, yongbongDemoCourseV2 } from "../supabase/functions/_shared/yongbong-course-v2";
import { serializeAnswerV2 } from "../supabase/functions/_shared/answer-v2";
import { validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import { ROLES, type Command, type GameEvent, type Role } from "../supabase/functions/_shared/types";

async function setup(gps = false) {
  const salt = crypto.randomUUID(), id = "jnu-demo-dev-yong-test";
  const course = await yongbongDemoCourseV2(id, salt, gps);
  const input = yongbongDemoInput(id, gps).privateInput;
  const game = createGame("one", "연습1", course, 100000, "TEST");
  let now = 100000, seq = 0;
  const events: GameEvent[] = [];
  const callUser = (user: string, cmd: Command) => dispatch(game, course, user, {
    request_id: `y-${seq++}`, stage_id: course.stages[game.v2!.stageIndex].id, ...cmd,
  }, now += 1100, salt, events);
  for (const [i, user] of ["two", "three", "four"].entries())
    await callUser(user, { action: "join-game", nickname: `연습${i + 2}` });
  await callUser("one", { action: "start-game" }); now += 4000;
  for (const m of game.members) await callUser(m.userId, { action: "set-ready" });
  const user = (role: Role) => game.members.find((m) => m.role === role)!.userId;
  const call = (role: Role, cmd: Command) => callUser(user(role), cmd);
  const view = (role: Role) => projectGameV2(game, course, user(role), now);
  const arrive = async () => { for (const role of ROLES) await call(role, { action: "report-arrival", method: gps ? "gps" : "simulated" }); };
  const solve = async (role: Role, only?: string[]) => {
    const stage = course.stages[game.v2!.stageIndex];
    for (const step of stage.roles[role]!.steps.filter((s) => !only || only.includes(s.id))) {
      const answer = input.stages[stage.id].steps[step.id].answer ?? (step.fields
        ? Object.fromEntries(step.fields.map((f) => [f.id, f.id === "created_at" ? "확인 불가" : `[합성] ${role}-${f.id} 개인 기록`]))
        : "[합성] 자유 기록");
      await call(role, { action: "submit-step", step_id: step.id, answer,
        method: "official_digital", source: { text: `[합성] ${role} 확인 출처` } });
    }
  };
  const report = (role: Role) => call(role, { action: "submit-report" });
  const open = () => {
    const stage = course.stages[game.v2!.stageIndex];
    if (stage.completion.type !== "lock") throw new Error("lock required");
    return call("commander", { action: "open-lock", digits: stage.completion.order.map((r) => input.stages[stage.id].roles[r]!.digit!) });
  };
  await call("commander", { action: "begin-operation" }); await arrive();
  for (const role of ROLES) { await solve(role); await report(role); }
  await open();
  return { course, game, input, events, call, callUser, view, arrive, solve, report, open };
}

describe("Yongbong v2", () => {
  it.each(["gate-yongbong", "gate-yongbong-gps"])("prepares %s through the dev seed CLI with the supplied salt", async (preset) => {
    const projectRef = "abcdefghijklmnopqrst", id = "jnu-demo-dev-yong-seed";
    const salt = crypto.randomUUID(), env = { NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key-not-a-credential", ANSWER_SALT: salt };
    const args = ["--dev-project-ref", projectRef, "--course-id", id, "--preset", preset];
    await expect(prepareDemoSeed(args, env)).rejects.toThrow(/schema-version 2/);
    const { course } = await prepareDemoSeed([...args, "--schema-version", "2"], env);
    expect(course).toEqual(await yongbongDemoCourseV2(id, salt, preset.endsWith("-gps")));
    if (!("stages" in course)) throw new Error("v2 required");
    expect(course.stages.map((stage) => stage.id)).toEqual(["gate", "yongbong"]);
    expect(course.stages.every((stage) => stage.arrival.confirmed === preset.endsWith("-gps"))).toBe(true);
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow();
  });

  it("travels from the completed gate and requires four fresh GPS arrivals", async () => {
    const t = await setup(true);
    await expect(t.call("scout", { action: "depart-next-site" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const command = { action: "depart-next-site", stage_id: "gate", request_id: "depart-once" };
    await t.call("commander", command);
    const version = t.game.version;
    await t.call("commander", command);
    expect(t.game.version).toBe(version);
    expect(t.view("cipher").game.arrival_mask).toEqual([false, false, false, false]);
    expect(t.view("cipher").self.mission).toBeNull();
    await expect(t.call("commander", { action: "select-alt-mode", mode_id: "outdoor" })).rejects.toMatchObject({ code: "WRONG_PHASE" });
    await expect(t.call("scout", { action: "report-arrival", method: "simulated" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "report-arrival", method: "gps" });
    expect(t.view("cipher").self.mission).toBeNull();
    await t.call("cipher", { action: "report-arrival", method: "gps" });
    expect(t.view("cipher").self.mission).not.toBeNull();
    await expect(t.call("signal", { action: "submit-step", stage_id: "gate" })).rejects.toMatchObject({ code: "STALE_STAGE" });
    expect(t.game.v2!.completed.gate).toBeDefined();
  });

  it("relays only the submitted material to cipher and privately stores research on completion", async () => {
    const t = await setup(); await t.call("commander", { action: "depart-next-site" }); await t.arrive();
    expect(t.view("cipher").self.shared_records).toEqual([]);
    await expect(t.call("cipher", { action: "submit-step", step_id: "Y-03.limits", answer: {} })).rejects.toMatchObject({ code: "STEP_LOCKED" });
    await t.solve("signal"); await t.report("signal");
    const relay = t.view("cipher").self.shared_records![0];
    expect(relay).toMatchObject({ status: "recorded", record: { created_at: "확인 불가" } });
    for (const role of ["commander", "scout"] as const) expect(JSON.stringify(t.view(role))).not.toContain("signal-title 개인 기록");
    expect(JSON.stringify(t.view("cipher").game)).not.toContain("signal-title 개인 기록");
    await t.solve("scout"); await t.report("scout"); await t.solve("cipher"); await t.report("cipher");
    await t.solve("commander", ["Y-04.classify", "Y-04.evidence"]);
    await expect(t.call("commander", { action: "submit-step", step_id: "Y-04.revision", answer: { verified: "[합성] 일부" },
      method: "field", source: { text: "[합성] 출처" } })).rejects.toMatchObject({ code: "BAD_ANSWER" });
    await t.solve("commander", ["Y-04.revision"]); await t.report("commander"); await t.open();
    expect(t.game.v2!.sacho.yongbong.research?.material?.created_at).toBe("확인 불가");
    expect(t.game.v2!.sacho.yongbong.research?.assessment?.question).toContain("cipher-question");
    expect(t.view("cipher").self.journal.find((j) => j.stage_id === "yongbong")?.shared_records?.[0].record).toEqual(relay.record);
    expect(JSON.stringify(t.events)).not.toContain("개인 기록");
    expect(JSON.stringify(t.game.v2!.progress.yongbong.commander)).not.toContain('"answer"');
    await expect(t.call("commander", { action: "depart-next-site" })).rejects.toMatchObject({ code: "NO_STAGE" });
  });

  it("marks an absent material record honestly after level three and permits the explanation path", async () => {
    const t = await setup(); await t.call("commander", { action: "depart-next-site" }); await t.arrive();
    for (const role of ["signal", "scout", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await t.call("commander", { action: "request-hint", target_role: role, level });
      await t.report(role); await t.call(role, { action: "confirm-explanation" });
    }
    expect(t.view("cipher").self.shared_records![0]).toMatchObject({ status: "explained_without_record", record: null, source: null });
    expect(t.view("commander").self.shared_records).toBeUndefined();
    const before = structuredClone(t.game.locks.yongbong);
    const opened = await t.call("commander", { action: "open-after-explanation" });
    expect(opened.label).toBe("해설 확인 후 복원");
    expect(t.game.locks.yongbong.attempts).toBe(before?.attempts ?? 0);
    expect(t.game.v2!.sacho.yongbong.research).toEqual({ material: null, assessment: null, revision: null });
  });

  it("selects outdoor mid-mission without resetting records, hints or penalties and restores the label", async () => {
    const t = await setup(); await t.call("commander", { action: "depart-next-site" }); await t.arrive();
    await t.solve("signal"); await t.report("signal");
    await t.call("commander", { action: "request-hint", target_role: "cipher", level: 1 });
    await t.call("commander", { action: "request-hint", target_role: "cipher", level: 2 });
    const progress = structuredClone(t.game.v2!.progress), score = t.game.score;
    await expect(t.call("signal", { action: "select-alt-mode", mode_id: "outdoor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const command = { action: "select-alt-mode", mode_id: "outdoor", request_id: "outdoor-once" };
    await t.call("commander", command); const version = t.game.version; await t.call("commander", command);
    expect(t.game.version).toBe(version); expect(t.game.score).toBe(score); expect(t.game.v2!.progress).toEqual(progress);
    await expect(t.call("commander", { ...command, mode_id: "onsite" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(t.call("commander", { action: "select-alt-mode", mode_id: "onsite" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const role of ["scout", "cipher", "commander"] as const) { await t.solve(role); await t.report(role); }
    await t.call("commander", { action: "open-lock", digits: [0, 0, 0, 0] });
    const failedLock = structuredClone(t.game.locks.yongbong), penalizedScore = t.game.score;
    expect(failedLock.attempts).toBe(1);
    await t.call("commander", { action: "select-alt-mode", mode_id: "outdoor" });
    expect(t.game.locks.yongbong).toEqual(failedLock);
    expect(t.game.score).toBe(penalizedScore);
    await t.open();
    const restored = JSON.parse(JSON.stringify(t.game)); Object.assign(t.game, restored);
    for (const role of ROLES) {
      expect(t.view(role).game.completion?.visit?.label).toContain("실내 관람 아님");
      expect(t.view(role).self.journal.find((j) => j.stage_id === "yongbong")?.visit?.mode).toBe("outdoor");
    }
    expect(t.game.v2!.sacho.yongbong.visitMode).toBe("outdoor");
    await expect(t.call("commander", { action: "select-alt-mode", mode_id: "outdoor" })).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });

  it("supports repeated classification categories but preserves 1:1 matching and validates relay sources", async () => {
    const { content } = yongbongDemoInput("jnu-demo-dev-yong-schema");
    const step = content.stages[1].roles.commander!.steps[0];
    const answer = { a: "3", b: "3", c: "3", d: "3" };
    expect(() => serializeAnswerV2(step, answer)).not.toThrow();
    expect(() => serializeAnswerV2({ ...step, type: "match" }, answer)).toThrow();
    expect(() => serializeAnswerV2(step, { ...answer, a: "4" })).toThrow();
    const limit = content.stages[1].roles.cipher!.steps[2];
    limit.recordFrom = { role: "signal", stepId: "Y-02.choice" };
    limit.requires!.push(limit.recordFrom);
    expect(() => validateCourseV2Content(content)).toThrow(/記録|기록/);
  });

  it("keeps the new courses dev-only and does not expose personal content during travel", async () => {
    const t = await setup(true); await t.call("commander", { action: "depart-next-site" });
    expect(() => assertEdgeCourseAllowed(t.course, "")).toThrow();
    expect(() => assertEdgeCourseAllowed(t.course, "true")).not.toThrow();
    for (const role of ROLES) {
      const s = t.view(role);
      expect(s.self.mission).toBeNull(); expect(s.self.shared_records).toBeUndefined();
      expect(s.self.digit).toBeNull(); expect(s.self.hints).toEqual([]);
      expect(s.game.report_mask.every((v) => !v)).toBe(true);
    }
  });
});
