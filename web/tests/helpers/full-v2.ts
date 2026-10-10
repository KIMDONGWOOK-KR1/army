import { createGame, dispatch } from "../../supabase/functions/_shared/engine";
import { projectGameV2 } from "../../supabase/functions/_shared/engine-v2";
import { fullDemoCourseV2, fullDemoV2Input } from "../../supabase/functions/_shared/wall-bongji-course-v2";
import { ROLES, type Command, type GameEvent, type Role } from "../../supabase/functions/_shared/types";

export async function fullTeam() {
  const salt = crypto.randomUUID(), id = "jnu-demo-dev-full-test";
  const course = await fullDemoCourseV2(id, salt), input = fullDemoV2Input(id).privateInput;
  const game = createGame("one", "연습1", course, 100000, "TEST");
  let now = 100000, seq = 0;
  const events: GameEvent[] = [];
  const callUser = (user: string, cmd: Command) => dispatch(game, course, user, {
    request_id: `full-${seq++}`, stage_id: course.stages[game.v2!.stageIndex].id, ...cmd,
  }, now += 1100, salt, events);
  for (const [i, user] of ["two", "three", "four"].entries()) await callUser(user, { action: "join-game", nickname: `연습${i + 2}` });
  await callUser("one", { action: "start-game" }); now += 4000;
  for (const m of game.members) await callUser(m.userId, { action: "set-ready" });
  const user = (role: Role) => game.members.find((m) => m.role === role)!.userId;
  const call = (role: Role, cmd: Command) => callUser(user(role), cmd);
  const view = (role: Role) => projectGameV2(game, course, user(role), now);
  const arrive = async () => { for (const role of ROLES) await call(role, { action: "report-arrival", method: "simulated" }); };
  const solve = async (role: Role) => {
    const stage = course.stages[game.v2!.stageIndex];
    for (const step of stage.roles[role]!.steps) {
      const answer = input.stages[stage.id].steps[step.id].answer ?? (step.fields
        ? Object.fromEntries(step.fields.map((f) => [f.id, `[합성] ${stage.id}-${role} 비공개 ${f.id}`])) : "[합성] 자유 기록");
      await call(role, { action: "submit-step", step_id: step.id, answer, method: "official_digital",
        source: { text: `[합성] ${stage.id}-${role} 비공개 출처` } });
    }
    await call(role, { action: "submit-report" });
  };
  const depart = () => call("commander", { action: "depart-next-site" });
  const wallReady = async () => { for (const role of ["scout", "signal", "cipher", "commander"] as const) await solve(role); };
  const draft = (action = "draft-memorial-record", version = 0, extra: Partial<Command> = {}) => call("commander", {
    action, draft_version: version, words: course.stages[game.v2!.stageIndex].recordTemplate!.wordChoices.slice(0, 3),
    text: "[합성] 함께 작성한 문장", reason: "[합성] 함께 확인한 근거", ...extra,
  });
  const wallComplete = async () => {
    await wallReady(); await draft();
    for (const role of ROLES) await call(role, { action: "confirm-stage", draft_version: 1 });
  };
  await call("commander", { action: "begin-operation" });
  // Existing lock stages are traversed through real actions and receipts.
  for (let index = 0; index < 2; index++) {
    await arrive();
    for (const role of ["scout", "signal", "cipher", "commander"] as const) await solve(role);
    const stage = course.stages[game.v2!.stageIndex];
    if (stage.completion.type !== "lock") throw new Error("expected lock stage");
    await call("commander", { action: "open-lock", digits: stage.completion.order.map((r) => input.stages[stage.id].roles[r]!.digit!) });
    await depart();
  }
  return { course, game, input, events, call, callUser, view, arrive, solve, depart, draft, wallReady, wallComplete };
}
