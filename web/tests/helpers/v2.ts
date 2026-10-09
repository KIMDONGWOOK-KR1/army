import { createGame, dispatch } from "../../supabase/functions/_shared/engine";
import {
  demoCourseV2,
  demoV2Input,
} from "../../supabase/functions/_shared/demo-course-v2";
import { ROLES } from "../../supabase/functions/_shared/types";
import type {
  Command,
  GameEvent,
  Role,
} from "../../supabase/functions/_shared/types";

export async function team(options: { arrive?: boolean } = {}) {
  const salt = crypto.randomUUID(),
    course = await demoCourseV2("jnu-demo-dev-test-r2", salt);
  const input = demoV2Input(course.id).privateInput;
  const game = createGame("host", "연습1", course, 100000, "TEST");
  let now = 100000, sequence = 0;
  const events: GameEvent[] = [];
  const callUser = (user: string, cmd: Command) =>
    dispatch(
      game,
      course,
      user,
      { stage_id: "gate", request_id: `req-${sequence++}`, ...cmd },
      now += 1100,
      salt,
      events,
    );
  for (const [i, user] of ["two", "three", "four"].entries()) {
    await callUser(user, { action: "join-game", nickname: `연습${i + 2}` });
  }
  await callUser("host", { action: "start-game" });
  now += 4000;
  for (const m of game.members) {
    await callUser(m.userId, { action: "set-ready" });
  }
  const user = (role: Role) =>
    game.members.find((m) => m.role === role)!.userId;
  const call = (role: Role, cmd: Command) => callUser(user(role), cmd);
  await call("commander", { action: "begin-operation" });
  if (options.arrive !== false) {
    for (const role of ROLES) {
      await call(role, { action: "report-arrival", method: "simulated" });
    }
  }
  const solve = async (role: Role) => {
    for (const step of course.stages[1].roles[role]!.steps) {
      const answer = input.stages.gate.steps[step.id].answer ??
        Object.fromEntries(
          step.fields!.map((f) => [f.id, `[합성] ${f.id} 자유 기록`]),
        );
      await call(role, {
        action: "submit-step",
        step_id: step.id,
        answer,
        method: "field",
        source: { text: "[합성] 관찰 출처", source_id: "MOCK-S1" },
      });
    }
    await call(role, { action: "submit-report" });
  };
  return {
    game,
    course,
    salt,
    events,
    call,
    callUser,
    user,
    solve,
    now: () => now,
    advance: (ms: number) => now += ms,
    input,
  };
}
