import { syntheticStoryAnswers } from "./helpers/story-b";
import { prepareCourseV2 } from "../supabase/functions/_shared/prepare-course-v2";
import { describe, expect, it } from "vitest";
import { storyBDemoCourseV2, storyBDemoV2Input } from "../supabase/functions/_shared/story-b-course-v2";
import { legacyFullDemoV2Input } from "../supabase/functions/_shared/legacy-full-course-v2";
import { createGame, dispatch } from "../supabase/functions/_shared/engine";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { ROLES, type Role, type Command, type GameEvent } from "../supabase/functions/_shared/types";
import { closingLines } from "../components/next-stop";
import { narrationLines, isStoryB } from "../lib/narration";

async function team() {
  const salt = crypto.randomUUID(), id = "jnu-demo-dev-story-b-test";
  const course = await storyBDemoCourseV2(id, salt, syntheticStoryAnswers()), { privateInput } = storyBDemoV2Input(id, syntheticStoryAnswers());
  const game = createGame("one", "기록1", course, 100000, "TEST");
  let now = 100000, seq = 0;
  const events: GameEvent[] = [];
  const callUser = (user: string, cmd: Command) => dispatch(game, course, user, {
    request_id: `story-${seq++}`, stage_id: course.stages[game.v2!.stageIndex].id, ...cmd,
  }, now += 1100, salt, events);
  for (const [i, user] of ["two", "three", "four"].entries()) await callUser(user, { action: "join-game", nickname: `기록${i + 2}` });
  await callUser("one", { action: "start-game" }); now += 4000;
  for (const m of game.members) await callUser(m.userId, { action: "set-ready" });
  const user = (role: Role) => game.members.find((m) => m.role === role)!.userId;
  const call = (role: Role, cmd: Command) => callUser(user(role), cmd);
  const view = (role: Role) => projectGameV2(game, course, user(role), now);
  const arrive = async () => { for (const role of ROLES) await call(role, { action: "report-arrival", method: "simulated" }); };
  const solveStep = async (role: Role, stepId: string, alias = false) => {
    const stage = course.stages[game.v2!.stageIndex], step = stage.roles[role]!.steps.find((s) => s.id === stepId)!;
    const secret = privateInput.stages[stage.id].steps[step.id];
    const answer = (alias ? secret.acceptedAnswers?.[0] : secret.answer) ?? Object.fromEntries(step.fields!.map((f) => [f.id, `시연 관찰 ${role} ${f.id}`]));
    await call(role, { action: "submit-step", step_id: step.id, answer });
    expect(view(role).self.step_progress[step.id].status).toBe("done");
  };
  const solve = async (role: Role) => {
    const stage = course.stages[game.v2!.stageIndex];
    for (const step of stage.roles[role]!.steps) {
      if (view(role).self.step_progress[step.id].status === "done") continue;
      await solveStep(role, step.id, step.type === "text");
    }
    await call(role, { action: "submit-report" });
  };
  await call("commander", { action: "begin-operation" });
  return { course, privateInput, game, call, view, arrive, solve, solveStep, events };
}

describe("MINO story-b", () => {
  it("preserves the old course, isolates story copy and keeps memorial ungraded", async () => {
    const before = legacyFullDemoV2Input("jnu-demo-dev-old");
    const { content, privateInput } = storyBDemoV2Input("jnu-demo-dev-story-b-test", syntheticStoryAnswers());
    await storyBDemoCourseV2(content.id, crypto.randomUUID(), syntheticStoryAnswers());
    expect(legacyFullDemoV2Input("jnu-demo-dev-old")).toEqual(before);
    expect(content.stages.map((s) => s.id)).toEqual(["gate", "yongbong", "wall", "bongji"]);
    expect(content.stages.filter((s) => s.sacho)).toHaveLength(3);
    expect(content.stages[2]).toEqual(before.content.stages[2]);
    expect(privateInput.stages.wall).toEqual(before.privateInput.stages.wall);
    expect(closingLines({ id: "wall", seq: 3 }, true)).toEqual(closingLines({ id: "wall", seq: 3 }));
    expect(content.stages[2]).toMatchObject({ quiet: true, scoring: { enabled: false }, completion: { type: "tribute" } });
    for (const role of ROLES) {
      expect(content.stages[2].roles[role]!.steps).toHaveLength(1);
      expect(content.stages[2].roles[role]!.digit).toBe(false);
      for (const id of ["gate", "yongbong"]) expect(new Set(privateInput.stages[id].roles[role]!.hints).size).toBe(3);
    }
    expect(isStoryB(content)).toBe(true); expect(isStoryB(before.content)).toBe(false);
    expect(narrationLines("intro", undefined, true)).not.toEqual(narrationLines("intro"));
    expect(closingLines({ id: "gate", seq: 1 }, true)).not.toEqual(closingLines({ id: "gate", seq: 1 }));
    expect(JSON.stringify(content)).not.toMatch(/answerHash|transferClue|"answer"|박기순|박관현/);
  });

  it("four roles solve, relay, unlock, offer flowers and consent through to private results", async () => {
    const t = await team();
    for (const id of ["gate", "yongbong"]) {
      await t.arrive();
      const commandStep = t.view("commander").self.mission!.steps[0];
      expect(t.view("commander").self.step_progress[commandStep.id].status).toBe("locked");
      const priv = t.privateInput.stages[id];
      if (id === "gate") {
        expect(t.view("scout").self.step_progress["G-02.name"].status).toBe("locked");
        await t.solveStep("signal", "G-03.freq");
        expect(t.view("scout").self.step_progress["G-02.name"].status).toBe("open");
      }
      for (const role of ["scout", "signal", "cipher", "commander"] as const) {
        await t.solve(role);
        expect(t.view(role).self.digit).toBe(priv.roles[role]!.digit);
        expect(JSON.stringify(t.view(role))).not.toMatch(/answerHash|"answer"|"private"/);
      }
      if (id === "yongbong") {
        expect(t.view("cipher").self.shared_records?.[0].record).toBeTruthy();
        expect(t.view("cipher").self.shared_records?.[0].method).toBeNull();
        expect(t.view("commander").self.shared_records ?? []).toHaveLength(0);
      }
      await t.call("commander", { action: "open-lock", digits: ROLES.map((r) => priv.roles[r]!.digit!) });
      expect(t.game.phase).toBe("cleared");
      expect(t.view("scout").self.journal.at(-1)?.entries.every((entry) => entry.method === null)).toBe(true);
      await t.call("commander", { action: "depart-next-site" });
    }
    await t.arrive(); const score = t.game.score;
    await expect(t.call("commander", { action: "request-hint", target_role: "scout", level: 1 })).rejects.toBeTruthy();
    for (const role of ROLES) {
      const step = t.view(role).self.mission!.steps[0];
      await t.call(role, { action: "submit-step", step_id: step.id, answer: "confirmed", method: "simulated" });
    }
    expect(t.game.score).toBe(score); expect(t.game.locks.wall).toBeUndefined();
    await t.call("commander", { action: "depart-next-site" }); await t.arrive();
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `${role}의 비공개 회고` });
    await t.call("commander", { action: "draft-joint-record", draft_version: 0, words: ["참여", "연대", "존중"], text: "민주주의는 개인의 참여에서 시작해 사람들의 연대로 확산되며, 역사를 정확히 기억하기 위해서는 기록에 대한 존중이 필요하다.", reason: "각자 살핀 근거가 달랐다." });
    await t.call("commander", { action: "consent-joint-record", draft_version: 1 });
    await t.call("scout", { action: "submit-retro", text: "정찰원의 수정 회고" });
    await expect(t.call("cipher", { action: "consent-joint-record", draft_version: 1 })).rejects.toMatchObject({ code: "STALE_DRAFT" });
    for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 2 });
    expect(t.game.status).toBe("done");
    for (const role of ROLES) {
      expect(t.view(role).self.result?.sacho).toEqual({ completed: 3, total: 3 });
      for (const other of ROLES.filter((r) => r !== role)) expect(JSON.stringify(t.view(role))).not.toContain(`${other}의 비공개 회고`);
    }
    expect(JSON.stringify(t.events)).not.toMatch(/시연 관찰|비공개 회고|시험용 관찰|answerHash|"answer"|"digits"/);
  });

  it("rejects an incorrect synthetic frequency and allows a non-revealing three-hint route", async () => {
    const t = await team(); await t.arrive();
    const step = t.view("signal").self.mission!.steps[0];
    const wrong = "42.0";
    await expect(t.call("signal", { action: "submit-step", step_id: step.id, answer: wrong, method: "simulated" })).resolves.toMatchObject({ accepted: false });
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await t.call("commander", { action: "request-hint", target_role: role, level });
      expect(t.view(role).self.hints).toHaveLength(3);
      for (const hints of Object.values(t.view(role).self.step_hints ?? {})) {
        expect(hints).toHaveLength(3); expect(new Set(hints).size).toBe(3);
        expect(hints.join(" ")).not.toContain("시험자료");
      }
      expect(Object.values(t.view(role).self.step_progress).every((s) => s.status === "explained")).toBe(true);
    }
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      await t.call(role, { action: "submit-report" }); await t.call(role, { action: "confirm-explanation" });
    }
    await t.call("commander", { action: "open-after-explanation" });
    expect(t.game.phase).toBe("cleared");
  });
  it("validates aliases and never projects accepted answers or hashes", async () => {
    const input = storyBDemoV2Input("jnu-demo-dev-invalid", syntheticStoryAnswers());
    input.privateInput.stages.gate.steps["G-03.freq"].acceptedAnswers = ["65.1"];
    await expect(prepareCourseV2(input.content, input.privateInput, crypto.randomUUID())).rejects.toBeTruthy();
    const t = await team(); await t.arrive();
    await t.solveStep("signal", "G-03.freq");
    await t.solveStep("scout", "G-02.name", true);
    const publicText = JSON.stringify(t.view("scout"));
    expect(publicText).not.toMatch(/answerHashes|acceptedAnswers|다른표기|시험자료/);
    expect(t.course.stages.slice(0, 2).flatMap((s) => ROLES.flatMap((r) => s.roles[r]!.steps))).toHaveLength(25);
  });

});
