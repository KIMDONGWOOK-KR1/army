import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { demoCourseInput } from "../supabase/functions/_shared/course";
import {
  legacyDemoCourseV2,
  legacyDemoV2Input,
} from "../supabase/functions/_shared/legacy-demo-course-v2";
import { demoCourseV2, demoV2Input } from "../supabase/functions/_shared/demo-course-v2";
import { answerHashV2 } from "../supabase/functions/_shared/answer-v2";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { createGame, dispatch } from "../supabase/functions/_shared/engine";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import {
  ROLES,
  type Command,
  type GameEvent,
  type Role,
} from "../supabase/functions/_shared/types";

// Reuse the server-only demo factories. Never duplicate content, private values,
// or a deployment salt here. Boolean comparisons keep failure diffs private.
const revision = () => `jnu-demo-dev-legacy-${randomUUID().slice(0, 16)}`;
const freshSalt = () => randomBytes(32).toString("hex");
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

async function rejected(operation: () => unknown, code?: string) {
  let didReject = false;
  let matchesCode = code === undefined;
  try {
    await operation();
  } catch (error) {
    didReject = true;
    matchesCode = code === undefined ||
      (!!error && typeof error === "object" && "code" in error && error.code === code);
  }
  expect(didReject).toBe(true);
  expect(matchesCode).toBe(true);
}

async function team() {
  const id = revision();
  const salt = freshSalt();
  const course = await legacyDemoCourseV2(id, salt);
  const input = legacyDemoV2Input(id).privateInput;
  const stage = course.stages.find((entry) => entry.id === "gate")!;
  const game = createGame("host", "연습1", course, 100000, "TEST");
  const events: GameEvent[] = [];
  let now = 100000;
  const callUser = (user: string, command: Command) => dispatch(
    game,
    course,
    user,
    { stage_id: stage.id, request_id: randomUUID(), ...command },
    now += 1100,
    salt,
    events,
  );
  for (const [index, user] of ["two", "three", "four"].entries())
    await callUser(user, { action: "join-game", nickname: `연습${index + 2}` });
  await callUser("host", { action: "start-game" });
  now += 4000;
  for (const member of game.members)
    await callUser(member.userId, { action: "set-ready" });
  const user = (role: Role) => game.members.find((member) => member.role === role)!.userId;
  const call = (role: Role, command: Command) => callUser(user(role), command);
  const view = (role: Role) => projectGameV2(game, course, user(role), now);
  await call("commander", { action: "begin-operation" });
  const arrive = async () => {
    for (const role of ROLES)
      await call(role, { action: "report-arrival", method: "simulated" });
  };
  const solve = async (role: Role) => {
    const step = stage.roles[role]!.steps[0];
    return call(role, {
      action: "submit-step",
      step_id: step.id,
      answer: input.stages[stage.id].steps[step.id].answer,
      method: "simulated",
      ...(step.sourceRequired ? { source: { text: "합성 확인 출처" } } : {}),
    });
  };
  return { course, input, stage, game, salt, events, call, view, arrive, solve };
}

function relayIsPrivate(t: Awaited<ReturnType<typeof team>>) {
  const frequency = t.input.stages.gate.roles.commander!.transferClue!.value;
  for (const role of ROLES) {
    const snapshot = t.view(role);
    const self = snapshot.self;
    expect("transfer_clue" in self).toBe(role === "commander");
    expect(JSON.stringify(snapshot).includes(frequency)).toBe(role === "commander");
    expect(JSON.stringify({
      game: snapshot.game,
      stage: snapshot.stage,
      course: snapshot.course,
      current_site: snapshot.current_site,
    }).includes(frequency)).toBe(false);
    expect(same(
      Object.keys(self.step_progress).sort(),
      t.stage.roles[role]!.steps.map((step) => step.id).sort(),
    )).toBe(true);
    for (const privateStep of Object.values(t.course.private.stages.gate.steps))
      expect(!!privateStep.answerHash && JSON.stringify(snapshot).includes(privateStep.answerHash)).toBe(false);
  }
}

describe("v1 gate demo carried into a dev-only v2 revision", () => {
  it("reuses current v1 questions, choices and role digits through factories", () => {
    const old = demoCourseInput();
    const oldGate = old.course.sites.find((stage) => stage.id === "gate")!;
    const { content, privateInput } = legacyDemoV2Input(revision());
    const gate = content.stages.find((stage) => stage.id === "gate")!;
    expect(content.stages.length).toBe(1);
    expect(content.demo).toBe(true);
    expect(content.confirmed).toBe(false);
    expect(privateInput.synthetic).toBe(true);
    expect(gate.arrival.require).toBe("all");
    expect(gate.arrival.lat === null && gate.arrival.lng === null).toBe(true);
    expect(gate.arrival.confirmed).toBe(false);
    for (const role of ROLES) {
      const steps = gate.roles[role]!.steps;
      expect(steps.length).toBe(1);
      expect(steps[0].prompt === oldGate.clues[role].question).toBe(true);
      expect(same(steps[0].choices, oldGate.clues[role].choices)).toBe(true);
      expect(privateInput.stages.gate.roles[role]!.digit === old.synthetic.gate[role][1]).toBe(true);
      if (role !== "cipher")
        expect(privateInput.stages.gate.steps[steps[0].id].answer === old.synthetic.gate[role][0]).toBe(true);
    }
    expect(same(gate.completion, { type: "lock", order: oldGate.lockOrder })).toBe(true);
  });

  it("converts the legacy calendar label to a one-based choice ID and hashes that representation", async () => {
    const old = demoCourseInput();
    const oldGate = old.course.sites.find((stage) => stage.id === "gate")!;
    const id = revision(), salt = freshSalt();
    const { content, privateInput } = legacyDemoV2Input(id);
    const step = content.stages.find((stage) => stage.id === "gate")!.roles.cipher!.steps[0];
    const oldAnswer = old.synthetic.gate.cipher[0];
    const index = oldGate.clues.cipher.choices!.indexOf(oldAnswer);
    const converted = privateInput.stages.gate.steps[step.id].answer;
    expect(index >= 0).toBe(true);
    expect(step.type).toBe("choice");
    expect(converted === String(index + 1)).toBe(true);
    expect(converted !== oldAnswer).toBe(true);
    const prepared = await legacyDemoCourseV2(id, salt);
    const expected = await answerHashV2(salt, id, step, converted!);
    expect(prepared.private.stages.gate.steps[step.id].answerHash === expected).toBe(true);
    expect(JSON.stringify(prepared).includes('"answer":')).toBe(false);
    expect(JSON.stringify(prepared).includes(salt)).toBe(false);
  });

  it("binds prepared hashes to both a fresh revision and caller-provided salt", async () => {
    const id = revision(), salt = freshSalt();
    const first = await legacyDemoCourseV2(id, salt);
    const revised = await legacyDemoCourseV2(revision(), salt);
    const rekeyed = await legacyDemoCourseV2(id, freshSalt());
    for (const step of Object.values(first.private.stages.gate.steps))
      expect(typeof step.answerHash === "string" && /^[a-f0-9]{64}$/.test(step.answerHash)).toBe(true);
    for (const stepId of Object.keys(first.private.stages.gate.steps)) {
      const hash = first.private.stages.gate.steps[stepId].answerHash;
      expect(hash !== revised.private.stages.gate.steps[stepId].answerHash).toBe(true);
      expect(hash !== rekeyed.private.stages.gate.steps[stepId].answerHash).toBe(true);
    }
    await rejected(() => legacyDemoCourseV2(id, ""));
    await rejected(() => legacyDemoV2Input("unconfirmed-production-course"));
  });

  it("requires all four arrivals, one answer and a separate report per role before the normal lock", async () => {
    const t = await team();
    expect(t.game.phase).toBe("travel");
    expect("transfer_clue" in t.view("commander").self).toBe(false);
    for (const role of ROLES.slice(0, -1)) {
      await t.call(role, { action: "report-arrival", method: "simulated" });
      expect(t.game.phase).toBe("travel");
    }
    await rejected(() => t.solve("scout"), "WRONG_PHASE");
    await t.call(ROLES.at(-1)!, { action: "report-arrival", method: "simulated" });
    expect(t.game.phase).toBe("mission");
    relayIsPrivate(t);
    await rejected(() => t.call("scout", { action: "submit-report" }), "REPORTS_REQUIRED");
    const digits = {} as Record<Role, number>;
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      const result = await t.solve(role);
      expect(result.accepted === true).toBe(true);
      const solved = t.view(role);
      expect(solved.self.reported).toBe(false);
      expect(solved.self.digit === null).toBe(true);
      await t.call(role, { action: "submit-report" });
      const reported = t.view(role);
      expect(reported.self.reported).toBe(true);
      expect(reported.self.digit === t.input.stages.gate.roles[role]!.digit).toBe(true);
      digits[role] = reported.self.digit!;
    }
    relayIsPrivate(t);
    expect(t.stage.completion.type).toBe("lock");
    if (t.stage.completion.type !== "lock") throw new Error("Expected a lock stage");
    const result = await t.call("commander", { action: "open-lock", digits: t.stage.completion.order.map((role) => digits[role]) });
    expect(result.opened === true).toBe(true);
    expect(result.method === "field").toBe(true);
    expect(t.game.phase).toBe("cleared");
    expect(t.game.status).toBe("playing");
    relayIsPrivate(t);
    expect(JSON.stringify(t.events).includes('"answer":')).toBe(false);
    expect(JSON.stringify(t.events).includes(t.input.stages.gate.roles.commander!.transferClue!.value)).toBe(false);
  });

  it("keeps the relay out of other roles' hints and explanations, then requires all reports and read confirmations", async () => {
    const t = await team();
    await t.arrive();
    for (const role of ROLES) {
      for (const level of [1, 2, 3]) {
        await t.call("commander", { action: "request-hint", target_role: role, level });
        relayIsPrivate(t);
      }
      const self = t.view(role).self;
      expect(self.hint_level).toBe(3);
      expect(Object.values(self.step_progress).every((step) => step.status === "explained")).toBe(true);
      expect(Object.keys(self.explanations).length).toBe(1);
      expect(Object.keys(self.rewards).length).toBe(0);
    }
    await rejected(() => t.call("commander", { action: "open-after-explanation" }), "REPORTS_REQUIRED");
    for (const role of ROLES) await t.call(role, { action: "submit-report" });
    await rejected(() => t.call("commander", { action: "open-after-explanation" }), "EXPLANATION_REQUIRED");
    for (const role of ROLES.slice(0, -1)) await t.call(role, { action: "confirm-explanation" });
    await rejected(() => t.call("commander", { action: "open-after-explanation" }), "EXPLANATION_REQUIRED");
    await t.call(ROLES.at(-1)!, { action: "confirm-explanation" });
    await rejected(() => t.call("scout", { action: "open-after-explanation" }), "FORBIDDEN");
    const before = t.view("commander").game;
    const result = await t.call("commander", { action: "open-after-explanation" });
    expect(result.opened === true && result.method === "explained").toBe(true);
    expect(result.label === "해설 확인 후 복원").toBe(true);
    const after = t.view("commander").game;
    expect(after.score === before.score && after.attempts_left === before.attempts_left).toBe(true);
    expect(after.confirm_mask.every(Boolean)).toBe(true);
    relayIsPrivate(t);
  });

  it("requires explicit Edge dev opt-in and rejects a production-style ID even with opt-in", async () => {
    const course = await legacyDemoCourseV2(revision(), freshSalt());
    for (const disabled of ["", "false"])
      await rejected(() => assertEdgeCourseAllowed(course, disabled), "UNCONFIRMED_COURSE");
    let allowed = true;
    try { assertEdgeCourseAllowed(course, "true"); } catch { allowed = false; }
    expect(allowed).toBe(true);
    await rejected(() => assertEdgeCourseAllowed({ ...course, id: "production-course" }, "true"), "UNCONFIRMED_COURSE");
  });

  it("selects the explicit v1-gate seed preset while preserving the synthetic v2 default", async () => {
    const project = randomUUID().replaceAll("-", "").slice(0, 20);
    const id = revision(), salt = freshSalt();
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: randomUUID(),
      ANSWER_SALT: salt,
    };
    const args = ["--dev-project-ref", project, "--course-id", id, "--schema-version", "2"];
    const selected = await prepareDemoSeed([...args, "--preset", "v1-gate"], environment);
    expect("schemaVersion" in selected.course).toBe(true);
    if (!("schemaVersion" in selected.course)) throw new Error("Expected v2 preset");
    const oldGate = demoCourseInput().course.sites.find((stage) => stage.id === "gate")!;
    const selectedGate = selected.course.stages.find((stage) => stage.id === "gate")!;
    for (const role of ROLES) {
      expect(selectedGate.roles[role]!.steps.length).toBe(1);
      expect(selectedGate.roles[role]!.steps[0].prompt === oldGate.clues[role].question).toBe(true);
    }
    const expected = await legacyDemoCourseV2(id, salt);
    expect(same(selected.course, expected)).toBe(true);
    const defaultSeed = await prepareDemoSeed(args, environment);
    expect("schemaVersion" in defaultSeed.course).toBe(true);
    if (!("schemaVersion" in defaultSeed.course)) throw new Error("Expected default v2 preset");
    const syntheticGate = demoV2Input(id).content.stages.find((stage) => stage.id === "gate")!;
    const defaultGate = defaultSeed.course.stages.find((stage) => stage.id === "gate")!;
    expect(same(defaultSeed.course, await demoCourseV2(id, salt))).toBe(true);
    for (const role of ROLES)
      expect(same(
        defaultGate.roles[role]!.steps.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
        syntheticGate.roles[role]!.steps.map(({ id, prompt, choices }) => ({ id, prompt, choices })),
      )).toBe(true);
    await rejected(() => prepareDemoSeed([...args, "--preset", "unknown"], environment));
    await rejected(() => prepareDemoSeed([
      "--dev-project-ref", project, "--course-id", id,
      "--schema-version", "1", "--preset", "v1-gate",
    ], environment));
  });
});
