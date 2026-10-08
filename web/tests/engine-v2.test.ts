import { describe, expect, it } from "vitest";
import { team } from "./helpers/v2";
import { dispatch, project } from "../supabase/functions/_shared/engine";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { ROLES } from "../supabase/functions/_shared/types";
import { serializeAnswerV2 } from "../supabase/functions/_shared/answer-v2";
import {
  prepareCourseV2,
  validateCourseV2Content,
} from "../supabase/functions/_shared/prepare-course-v2";
import { demoV2Input } from "../supabase/functions/_shared/demo-course-v2";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import { domainHttpStatus } from "../supabase/functions/_shared/game-core";

describe("v2 gate engine", () => {
  it("runs four roles through dependencies, reports, lock and private sacho", async () => {
    const t = await team();
    expect(t.game.phase).toBe("mission");
    await expect(
      t.call("commander", { action: "submit-step", step_id: "G-01.verdict" }),
    ).rejects.toMatchObject({ code: "STEP_LOCKED" });
    await expect(
      t.call("commander", { action: "open-lock", digits: [2, 3, 4, 5] }),
    ).rejects.toMatchObject({ code: "REPORTS_REQUIRED" });
    await expect(t.call("scout", { action: "submit-report" })).rejects
      .toMatchObject({ code: "REPORTS_REQUIRED" });
    await expect(
      t.call("scout", { action: "submit-step", step_id: "G-03.freq" }),
    ).rejects.toMatchObject({ code: "NO_STEP" });
    for (const r of ["scout", "signal", "cipher", "commander"] as const) {
      await t.solve(r);
    }
    const score = t.game.score;
    const result = await t.call("commander", {
      action: "open-lock",
      digits: [2, 3, 4, 5],
    });
    expect(result).toMatchObject({
      opened: true,
      method: "field",
      sacho_id: "mock-sacho-gate",
    });
    expect(t.game.phase).toBe("cleared");
    expect(t.game.score).toBe(score + 5);
    expect(t.game.status).toBe("playing");
    expect(t.game.v2!.sacho.gate.eventOrder).toEqual([{
      stepId: "G-01.order",
      method: "field",
      verified: true,
    }]);
    expect(t.game.v2!.sacho.gate.observations).toHaveLength(1);
    expect(t.game.v2!.sacho.gate.eventRecords).toHaveLength(1);
    expect(t.game.v2!.sacho.gate.sources).toHaveLength(9);
    for (const r of ROLES) {
      await t.call(r, { action: "get-stage" });
      const s = projectGameV2(t.game, t.course, t.user(r), t.now());
      expect(s.self.reported).toBe(true);
      expect(s.self.digit).toBe(t.course.private.stages.gate.roles[r]!.digit);
      for (const other of ROLES.filter((x) => x !== r)) {
        expect(JSON.stringify(s.self)).not.toContain(
          t.course.stages[1].roles[other]!.intro.text,
        );
        for (
          const secret of Object.values(t.course.private.stages.gate.steps)
        ) {
          expect(JSON.stringify(s)).not.toContain(
            secret.answerHash ?? "NO-HASH-SENTINEL",
          );
        }
      }
      if (r !== "signal") expect(s.self.rewards).toEqual({});
      if (r !== "commander") {
        expect(s.self.lock).toBeNull();
        expect(s.self).not.toHaveProperty("transfer_clue");
      }
      expect(JSON.stringify(s.game)).not.toMatch(
        /"(?:answer|digit|transfer|explanation|record|source_id|userId|receipts)"/i,
      );
    }
  });
  it("keeps the commander relay private before and after mission; no future-stage fetch", async () => {
    const t = await team(),
      value = t.course.private.stages.gate.roles.commander!.transferClue!.value;
    for (const role of ROLES) {
      const snapshot = project(t.game, t.course, t.user(role), t.now());
      expect(JSON.stringify(snapshot).includes(value)).toBe(
        role === "commander",
      );
      expect(JSON.stringify(snapshot.game)).not.toContain(value);
    }
    t.game.phase = "travel";
    expect(projectGameV2(t.game, t.course, t.user("commander"), t.now()).self)
      .not.toHaveProperty("transfer_clue");
    await expect(t.call("commander", { action: "get-stage" })).rejects
      .toMatchObject({ code: "WRONG_PHASE" });
    await expect(
      t.call("commander", { action: "get-stage", stage_id: "future" }),
    ).rejects.toMatchObject({ code: "STALE_STAGE" });
    await expect(t.callUser("outsider", { action: "get-stage" })).rejects
      .toMatchObject({ code: "FORBIDDEN" });
  });
  it("enforces sequential commander hints, idempotence and all-role explanation confirmation", async () => {
    const t = await team();
    await expect(
      t.call("scout", {
        action: "request-hint",
        target_role: "signal",
        level: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.call("commander", {
        action: "request-hint",
        target_role: "signal",
        level: 3,
      }),
    ).rejects.toMatchObject({ code: "HINT_ORDER" });
    await expect(t.call("signal", { action: "confirm-explanation" })).rejects
      .toMatchObject({ code: "EXPLANATION_REQUIRED" });
    for (const role of ROLES) {
      await t.call("commander", {
        action: "request-hint",
        target_role: role,
        level: 1,
      });
      const cmd = {
        action: "request-hint",
        target_role: role,
        level: 2,
        request_id: `hint-${role}`,
      };
      await t.call("commander", cmd);
      const before = structuredClone(t.game), count = t.events.length;
      await t.call("commander", cmd);
      expect(t.game).toEqual(before);
      expect(t.events).toHaveLength(count);
      await expect(t.call("commander", { ...cmd, level: 3 })).rejects
        .toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      await t.call("commander", {
        action: "request-hint",
        target_role: role,
        level: 3,
      });
      expect(
        Object.values(t.game.v2!.progress.gate[role].steps).every((p) =>
          p.status === "explained" && p.attempts === 0
        ),
      ).toBe(true);
      for (const receiver of ROLES) {
        const self =
          projectGameV2(t.game, t.course, t.user(receiver), t.now()).self;
        for (const hint of self.hints) expect(hint).toContain(receiver);
        expect(self.rewards).toEqual({});
      }
    }
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      await t.call(role, { action: "submit-report" });
    }
    await expect(t.call("commander", { action: "open-after-explanation" }))
      .rejects.toMatchObject({ code: "EXPLANATION_REQUIRED" });
    for (const role of ROLES.slice(0, 3)) {
      await t.call(role, { action: "confirm-explanation" });
    }
    await expect(t.call("commander", { action: "open-after-explanation" }))
      .rejects.toMatchObject({ code: "EXPLANATION_REQUIRED" });
    await t.call("cipher", { action: "confirm-explanation" });
    await expect(t.call("scout", { action: "open-after-explanation" })).rejects
      .toMatchObject({ code: "FORBIDDEN" });
    const score = t.game.score;
    const cmd = {
      action: "open-after-explanation",
      request_id: "explanation-open",
    };
    expect(await t.call("commander", cmd)).toMatchObject({
      method: "explained",
      label: "해설 확인 후 복원",
    });
    await t.call("commander", cmd);
    expect(t.game.locks.gate.attempts).toBe(0);
    expect(t.game.score).toBe(score);
    expect(t.game.v2!.completed.gate.method).toBe("explained");
  });
  it("retains completed work when level 3 explains only the remaining steps", async () => {
    const t = await team();
    await t.call("signal", {
      action: "submit-step",
      step_id: "G-03.freq",
      answer: "82.6",
      method: "field",
      source: { text: "[합성] 출처" },
    });
    const before = structuredClone(
      t.game.v2!.progress.gate.signal.steps["G-03.freq"],
    );
    for (const level of [1, 2, 3]) {
      await t.call("commander", {
        action: "request-hint",
        target_role: "signal",
        level,
      });
    }
    expect(t.game.v2!.progress.gate.signal.steps["G-03.freq"]).toEqual(before);
    expect(t.game.v2!.progress.gate.signal.steps["G-03.words"].status).toBe(
      "explained",
    );
  });
  it("retains three lock attempts, -10 per error, partial masks and 60 second cooldown", async () => {
    const t = await team();
    for (const r of ["scout", "signal", "cipher", "commander"] as const) {
      await t.solve(r);
    }
    const wrong = {
      action: "open-lock",
      digits: [2, 0, 0, 0],
      request_id: "lock-wrong",
    };
    await t.call("commander", wrong);
    await t.call("commander", wrong);
    expect(t.game.score).toBe(90);
    expect(t.game.locks.gate.attempts).toBe(1);
    expect(project(t.game, t.course, t.user("scout"), t.now()).game.locked_mask)
      .toEqual([true, false, false, false]);
    await expect(
      t.call("commander", { action: "open-lock", digits: [0, 0, 0, 0] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let i = 0; i < 2; i++) {
      await t.call("commander", { ...wrong, request_id: `lock-${i}` });
    }
    const cooldown = t.game.locks.gate.nextAttemptAt!;
    expect(t.game.score).toBe(70);
    await expect(
      t.call("commander", { action: "open-lock", digits: [2, 3, 4, 5] }),
    ).rejects.toMatchObject({ code: "COOLDOWN", retry_at: cooldown });
    t.advance(60000);
    await t.call("commander", { action: "open-lock", digits: [2, 3, 4, 5] });
    expect(t.game.locks.gate.attempts).toBe(4);
  });
  it("returns explicit missing-content errors and never commits rejected changes", async () => {
    const t = await team();
    delete t.course.private.stages.gate;
    const before = structuredClone(t.game), count = t.events.length;
    await expect(t.call("scout", { action: "get-stage" })).rejects
      .toMatchObject({ code: "CONTENT_UNCONFIRMED" });
    for (const r of ROLES) {
      expect(() => project(t.game, t.course, t.user(r), t.now())).toThrow(
        /자료/,
      );
    }
    expect(t.game).toEqual(before);
    expect(t.events).toHaveLength(count);
    expect(domainHttpStatus("CONTENT_UNCONFIRMED")).toBe(503);
  });
  it("does not persist graded answer plaintext or log source/record payloads", async () => {
    const t = await team();
    await t.solve("scout");
    await t.solve("signal");
    expect(JSON.stringify(t.game)).not.toContain("Mock Sculpture");
    expect(JSON.stringify(t.game)).not.toContain("82.6");
    expect(JSON.stringify(t.events)).not.toMatch(
      /"(?:answer|digit|salt|source|record|latitude|longitude)"|82\.6/,
    );
    const before = structuredClone(t.game);
    await expect(
      dispatch(
        t.game,
        t.course,
        t.user("scout"),
        { action: "get-stage", stage_id: "gate", role: "commander" },
        t.now(),
        t.salt,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(t.game).toEqual(before);
  });
});

describe("v2 normalization and dev seed", () => {
  it("uses the same explicit normalization in seed and submission, preserving defaults", async () => {
    const t = await team();
    expect(
      await t.call("scout", {
        action: "submit-step",
        step_id: "G-02.name",
        answer: "  MOCKsculpture  ",
        method: "field",
        source: { text: "[합성] 출처" },
      }),
    ).toMatchObject({ accepted: true });
    const step = {
      ...t.course.stages[1].roles.scout!.steps[0],
      normalize: undefined,
    };
    expect(serializeAnswerV2(step, "A B")).not.toBe(
      serializeAnswerV2(step, "ab"),
    );
    const words = {
      ...t.course.stages[1].roles.signal!.steps[1],
      normalize: { caseInsensitive: true, ignoreSpaces: true },
    };
    expect(() => serializeAnswerV2(words, ["A B", "ab", "c"])).toThrow();
    const input = demoV2Input(t.course.id);
    input.content.stages[1].roles.signal!.steps[0].normalize = {
      ignoreSpaces: true,
    };
    expect(() => validateCourseV2Content(input.content)).toThrow(/정규화/);
    const frequency = t.course.stages[1].roles.signal!.steps[0];
    expect(() => serializeAnswerV2(frequency, "82.60")).toThrow();
    expect(() => serializeAnswerV2(frequency, "82.64")).toThrow();
    expect(serializeAnswerV2(frequency, "82")).toBe('"82.0"');
  });
  it("keeps match one-to-one and rejects undefined real evidence choices", async () => {
    const { content, privateInput } = demoV2Input("jnu-demo-dev-test-r2");
    const step = content.stages[1].roles.commander!.steps[2];
    expect(() =>
      serializeAnswerV2(step, {
        "event-a": "1",
        "event-b": "1",
        "event-c": "2",
        "event-d": "3",
      })
    ).toThrow();
    step.choices = [];
    await expect(prepareCourseV2(content, privateInput, crypto.randomUUID()))
      .rejects.toThrow();
  });
  it("seeds v2 only into the explicit dev target using the supplied salt", async () => {
    const salt = crypto.randomUUID(), ref = "a".repeat(20);
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key",
      ANSWER_SALT: salt,
    };
    const { course } = await prepareDemoSeed([
      "--dev-project-ref",
      ref,
      "--course-id",
      "jnu-demo-dev-test-r2",
      "--schema-version",
      "2",
    ], env);
    if (!("schemaVersion" in course)) throw new Error("Expected v2");
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow();
    expect(() => assertEdgeCourseAllowed(course, "true")).not.toThrow();
    expect(course.private.stages.gate.steps["G-02.name"].answerHash).toBe(
      (await teamWithSalt(course.id, salt)).private.stages.gate
        .steps["G-02.name"].answerHash,
    );
  });
});
async function teamWithSalt(id: string, salt: string) {
  const { content, privateInput } = demoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
