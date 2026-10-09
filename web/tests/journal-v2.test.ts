import { expect, it } from "vitest";
import { team } from "./helpers/v2";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { projectPublicStageV2 } from "../supabase/functions/_shared/project-course-v2";
import { projectJournalV2 } from "../supabase/functions/_shared/project-journal-v2";
import { ROLES } from "../supabase/functions/_shared/types";

it("withholds reward text and journals until completion, then exposes only the caller's records", async () => {
  const t = await team();
  const gate = t.course.stages.find((s) => s.id === "gate")!;
  const body = `[합성] 완료 후 공개 기록 ${crypto.randomUUID()}`;
  gate.sacho = { ...gate.sacho!, char: "記", body };
  const view = (role: typeof ROLES[number]) =>
    projectGameV2(t.game, t.course, t.user(role), t.now());
  expect(JSON.stringify(projectPublicStageV2(t.course, gate.id)).includes(body))
    .toBe(false);
  for (const role of ROLES) {
    expect(view(role).self.journal).toEqual([]);
    expect(view(role).game.completion).toBeNull();
    expect(JSON.stringify(view(role)).includes(body)).toBe(false);
  }
  for (const role of ["scout", "signal", "cipher", "commander"] as const) {
    await t.solve(role);
  }
  expect(view("commander").self.journal).toEqual([]);
  await t.call("commander", {
    action: "open-lock",
    digits: ROLES.map((r) => t.course.private.stages.gate.roles[r]!.digit!),
  });
  for (const role of ROLES) {
    const s = view(role);
    expect(s.current_site.sacho.body === body).toBe(true);
    expect(s.game.acquired_sites[0].sacho.body === body).toBe(true);
    expect(s.game.completion?.method).toBe("field");
    const journal = s.self.journal[0];
    expect(journal.entries.map((entry) => entry.step_id)).toEqual(
      gate.roles[role]!.steps.map((step) => step.id),
    );
    expect(
      journal.entries.every((entry) =>
        entry.source?.text === "[합성] 관찰 출처"
      ),
    ).toBe(true);
    expect(journal.entries.every((entry) => entry.verified)).toBe(true);
    const text = JSON.stringify(journal);
    expect(/answerHash|transfer_clue|"answer"|"digit"|userId/.test(text)).toBe(
      false,
    );
    for (const other of ROLES.filter((r) => r !== role)) {
      for (const step of gate.roles[other]!.steps) {
        expect(text.includes(step.id)).toBe(false);
      }
    }
    expect(JSON.stringify(s.game).includes('"entries"')).toBe(false);
  }
  expect(projectJournalV2(t.course, t.game.v2!, null)).toEqual([]);
});

it("keeps explanation completion after a fresh projection without changing lock penalties", async () => {
  const t = await team();
  for (const role of ["scout", "signal", "cipher", "commander"] as const) {
    for (const level of [1, 2, 3]) {
      await t.call("commander", {
        action: "request-hint",
        target_role: role,
        level,
      });
    }
    await t.call(role, { action: "submit-report" });
    await t.call(role, { action: "confirm-explanation" });
  }
  const before = {
    score: t.game.score,
    attempts: t.game.locks.gate?.attempts ?? 0,
  };
  await t.call("commander", { action: "open-after-explanation" });
  for (const role of ROLES) {
    await t.call(role, { action: "get-stage" });
    const s = projectGameV2(t.game, t.course, t.user(role), t.now());
    expect(s.game.completion?.label).toBe("해설 확인 후 복원");
    expect(
      s.self.journal[0].entries.every((entry) =>
        !entry.verified && !entry.reward
      ),
    ).toBe(true);
    expect(s.game.score).toBe(before.score);
    expect(s.self.lock?.attempts ?? before.attempts).toBe(before.attempts);
  }
});
