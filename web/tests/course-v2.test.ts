import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  answerHashV2,
  normalizeTextV2,
  serializeAnswerV2,
} from "../supabase/functions/_shared/answer-v2";
import {
  prepareCourseV2,
  validateCourseV2Content,
} from "../supabase/functions/_shared/prepare-course-v2";
import { prepareSeedCourse } from "../supabase/functions/_shared/prepare-seed-course";
import {
  projectPublicStageV2,
  projectStageV2,
} from "../supabase/functions/_shared/project-course-v2";
import {
  type CourseV2Content,
  type CourseV2PrivateInput,
  ROLES,
  type Step,
} from "../supabase/functions/_shared/types";
import source from "../../codex-handoff-v2/data/courses/jnu-v2.course.json";
import example from "../../codex-handoff-v2/data/courses/jnu-v2.private.example.json";

// Per-test salt is intentionally unrelated to deployment; never an application default.
const salt = crypto.randomUUID();
function fixture(production = false) {
  const content = structuredClone(source) as CourseV2Content;
  const secret = structuredClone(example) as unknown as CourseV2PrivateInput;
  content.id = production
    ? "synthetic-validation-fixture"
    : "jnu-demo-dev-schema-test";
  content.demo = !production;
  content.confirmed = production;
  delete content.note;
  secret.courseId = content.id;
  secret.synthetic = !production;
  for (const stage of content.stages) {
    stage.confirmed = true;
    stage.arrival.confirmed = production;
    delete stage.arrival.note;
    if (production && stage.arrival.mode === "gps") {
      stage.arrival.lat = 1;
      stage.arrival.lng = 2;
    }
    stage.scoring.confirmed = true;
    stage.scoring.hintPenalty = { 1: 0, 2: 0, 3: 0 };
    stage.scoring.noHintBonus = 0;
    delete stage.scoring.note;
    for (const role of ROLES) {
      const mission = stage.roles[role]!;
      if (mission.asset) {
        mission.asset.url = "https://example.com/synthetic.jpg";
        mission.asset.confirmed = true;
      }
      for (const step of mission.steps) {
        step.confirmed = true;
        delete step.note;
      }
    }
  }
  const gate = content.stages[1];
  gate.roles.commander!.steps[2].choices = [
    "합성 근거 가",
    "합성 근거 나",
    "합성 근거 다",
    "합성 근거 라",
  ];
  return { content, secret, gate };
}
const sample = (
  type: Step["type"],
  grading: Step["grading"],
  extra: Partial<Step> = {},
): Step => ({
  id: "T-01.sample",
  confirmed: true,
  type,
  grading,
  prompt: "합성 문제",
  ...extra,
});

describe("v2 canonical answer format", () => {
  it("normalizes NFC and whitespace without stripping internal spaces or case", () => {
    expect(normalizeTextV2("  가\t나\n ")).toBe("가 나");
    expect(normalizeTextV2("A B")).not.toBe(normalizeTextV2("ab"));
    const step = sample("text", "hash");
    expect(serializeAnswerV2(step, " 가\n나 ")).toBe('"가 나"');
    expect(() => serializeAnswerV2(step, " ")).toThrow();
    expect(() => normalizeTextV2("가".repeat(301))).toThrow();
  });
  it("sorts sets lexicographically, preserves order lists, rejects duplicates", () => {
    const set = sample("words", "set-hash", { answerCount: 3 });
    expect(serializeAnswerV2(set, ["다", " 가 ", "나"])).toBe(
      '["가","나","다"]',
    );
    expect(() => serializeAnswerV2(set, ["가", " 가 ", "나"])).toThrow();
    expect(() => serializeAnswerV2(set, ["가"])).toThrow();
    const order = sample("order", "order-hash", {
      choices: ["가", "나", "다"],
    });
    expect(serializeAnswerV2(order, ["3", "1", "2"])).toBe('["3","1","2"]');
    expect(serializeAnswerV2(order, ["3", "1", "2"])).not.toBe(
      serializeAnswerV2(order, ["1", "2", "3"]),
    );
    expect(() => serializeAnswerV2(order, ["1", "2"])).toThrow();
  });
  it("maps use sorted field IDs, no missing/extra keys or repeated matches", () => {
    const map = sample("match", "map-hash", {
      choices: ["가", "나"],
      fields: [{ id: "b", label: "B", required: true, maxLen: 300 }, {
        id: "a",
        label: "A",
        required: true,
        maxLen: 300,
      }],
    });
    expect(serializeAnswerV2(map, { b: "1", a: "2" })).toBe(
      '[["a","2"],["b","1"]]',
    );
    expect(serializeAnswerV2(map, { a: "2", b: "1" })).toBe(
      serializeAnswerV2(map, { b: "1", a: "2" }),
    );
    for (
      const value of [{ a: "1" }, { a: "1", b: "2", c: "1" }, {
        a: "1",
        b: "1",
      }]
    ) expect(() => serializeAnswerV2(map, value)).toThrow();
  });
  it.each(["0", "3", "01", "1.0", "-1", 1])(
    "rejects invalid choice %s",
    (value) => {
      expect(() =>
        serializeAnswerV2(
          sample("choice", "hash", { choices: ["가", "나"] }),
          value,
        )
      ).toThrow();
    },
  );
  it("frequency is decimal with at most one fractional digit, never rounded", () => {
    const step = sample("frequency", "hash");
    expect(serializeAnswerV2(step, " 12 ")).toBe('"12.0"');
    expect(serializeAnswerV2(step, "012.3")).toBe('"12.3"');
    for (const value of ["12.34", "1e2", "-12.3", "NaN", "12,3", 12.3]) {
      expect(() => serializeAnswerV2(step, value)).toThrow();
    }
  });
  it("truefalse preserves statement order and requires explicit boolean strings", () => {
    const step = sample("truefalse", "hash", {
      statements: ["합성 가", "합성 나"],
    });
    expect(serializeAnswerV2(step, ["false", "true"])).toBe('["false","true"]');
    expect(() => serializeAnswerV2(step, [false, true])).toThrow();
    expect(() => serializeAnswerV2(step, ["true"])).toThrow();
  });
  it("hashes exactly salt + courseId + stepId + serialized answer", async () => {
    const step = sample("words", "set-hash");
    const expected = createHash("sha256").update(
      salt + "fixture" + step.id + '["가","나"]',
    ).digest("hex");
    expect(await answerHashV2(salt, "fixture", step, ["나", "가"])).toBe(
      expected,
    );
    expect(await answerHashV2(salt, "other", step, ["나", "가"])).not.toBe(
      expected,
    );
    expect(
      await answerHashV2(salt, "fixture", { ...step, id: "T-02.sample" }, [
        "나",
        "가",
      ]),
    ).not.toBe(expected);
    expect(
      await answerHashV2(crypto.randomUUID(), "fixture", step, ["나", "가"]),
    ).not.toBe(expected);
    await expect(answerHashV2("short", "fixture", step, ["가"])).rejects
      .toThrow(/32/);
  });
});

describe("v2 seed validation", () => {
  it("blocks the field-unconfirmed repository draft and synthetic private example", async () => {
    await expect(prepareCourseV2(source, example, salt)).rejects.toThrow(
      /확정/,
    );
    const { content } = fixture(true);
    await expect(
      prepareCourseV2(content, { ...example, courseId: content.id }, salt),
    ).rejects.toThrow(/합성/);
  });
  it("prepares a complete test-only course, never storing answer plaintext", async () => {
    const { content, secret } = fixture(true);
    const course = await prepareSeedCourse(content, secret, salt);
    expect("private" in course).toBe(true);
    expect(JSON.stringify(course)).not.toContain('"answer":');
    expect(JSON.stringify(course)).not.toContain("가상 조형물 예시");
    expect(JSON.stringify(course)).not.toContain(salt);
    if ("private" in course) {
      expect(course.private.stages.gate.steps["G-03.freq"].answerHash).toMatch(
        /^[a-f0-9]{64}$/,
      );
    }
    await expect(prepareSeedCourse({ schemaVersion: 99 }, secret, salt)).rejects
      .toThrow(/버전/);
  });
  it("requires explicit demo=true with dev ID and private synthetic=true for missing coordinates", async () => {
    const { content, secret } = fixture();
    expect((await prepareCourseV2(content, secret, salt)).demo).toBe(true);
    content.demo = false;
    await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(
      /확정/,
    );
    content.demo = true;
    content.id = "real-course";
    await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(/dev/);
  });
  it.each([
    "roles",
    "duplicate",
    "cycle",
    "report-cycle",
    "bad-ref",
    "wrong-role",
  ])("rejects broken dependency/roles: %s", async (kind) => {
    const { content, secret, gate } = fixture();
    const commander = gate.roles.commander!.steps,
      scout = gate.roles.scout!.steps;
    if (kind === "roles") {
      delete (gate.roles as Partial<typeof gate.roles>).cipher;
    }
    if (kind === "duplicate") scout[0].id = commander[0].id;
    if (kind === "cycle") {
      scout[0].requires = [{ role: "scout", stepId: scout[1].id }];
    }
    if (kind === "report-cycle") scout[0].requiresReports = ["commander"];
    if (kind === "bad-ref") {
      scout[0].requires = [{ role: "signal", stepId: "G-99.missing" }];
    }
    if (kind === "wrong-role") {
      scout[0].requires = [{ role: "cipher", stepId: "G-03.freq" }];
    }
    await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(
      /역할|중복|순환/,
    );
  });
  it.each(["coordinates", "scoring", "evidence", "asset"])(
    "blocks unconfirmed production %s",
    async (kind) => {
      const { content, secret, gate } = fixture(true);
      if (kind === "coordinates") gate.arrival.confirmed = false;
      if (kind === "scoring") gate.scoring.confirmed = false;
      if (kind === "evidence") gate.roles.commander!.steps[2].confirmed = false;
      if (kind === "asset") gate.roles.scout!.asset!.confirmed = false;
      await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(
        /확정/,
      );
    },
  );
  it.each([
    "hints",
    "choice",
    "digit",
    "missing-answer",
    "text-answer",
    "transfer-mismatch",
    "transfer-role",
    "extra-secret",
    "extra-public",
  ])("rejects malformed private/public data: %s", async (kind) => {
    const { content, secret, gate } = fixture();
    if (kind === "hints") secret.stages.gate.roles.scout!.hints.pop();
    if (kind === "choice") {
      secret.stages.gate.steps["G-04.spots"].answer = ["0", "1", "2"];
    }
    if (kind === "digit") secret.stages.gate.roles.scout!.digit = 10;
    if (kind === "missing-answer") {
      delete secret.stages.gate.steps["G-02.name"].answer;
    }
    if (kind === "text-answer") {
      secret.stages.gate.steps["G-02.record"].answer = "forbidden";
    }
    if (kind === "transfer-mismatch") {
      secret.stages.gate.roles.commander!.transferClue!.value = "45.6";
    }
    if (kind === "transfer-role") {
      secret.stages.gate.roles.scout!.transferClue =
        secret.stages.gate.roles.commander!.transferClue;
    }
    if (kind === "extra-secret") {
      Object.assign(secret.stages.gate.steps["G-02.name"], {
        answerHash: "untrusted",
      });
    }
    if (kind === "extra-public") {
      Object.assign(gate.roles.scout!, { answer: "leak" });
    }
    await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow();
  });
  it("preserves the gate collaboration dependencies without a scout lock on signal words", () => {
    const { content } = fixture();
    const gate = validateCourseV2Content(content).stages[1];
    expect(gate.roles.commander!.steps[0].requiresReports).toEqual([
      "scout",
      "signal",
      "cipher",
    ]);
    expect(gate.roles.signal!.steps[1].requires).toEqual([{
      role: "signal",
      stepId: "G-03.freq",
    }]);
    expect(gate.roles.signal!.scenes[0].trigger).toBe("scout-reported");
  });
});

it("rejects production placeholders in private data and incomplete record requirements", async () => {
  const { content, secret } = fixture(true);
  secret.stages.gate.roles.scout!.hints[0] = "TODO(확인필요)";
  await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(
    /미확정/,
  );
  secret.stages.gate.roles.scout!.hints[0] = "테스트 안내";
  secret.stages.gate.steps["G-02.record"].rubric!.required.pop();
  await expect(prepareCourseV2(content, secret, salt)).rejects.toThrow(
    /필수 항목/,
  );
});

describe("v2 role isolation", () => {
  it("serializes the relay clue only to commander self; no answers, hints, digits or reward leak", async () => {
    const { content, secret } = fixture();
    const course = await prepareCourseV2(content, secret, salt);
    const rawPublic = JSON.stringify(projectPublicStageV2(course, "gate"));
    for (
      const token of [
        '"value"',
        '"answerHash"',
        '"digit"',
        '"hints"',
        '"explanation"',
        '"reward"',
        '"private"',
        "12.3",
        "G-03.freq",
      ]
    ) expect(rawPublic).not.toContain(token);
    for (const role of ROLES) {
      const view = projectStageV2(course, "gate", role);
      const raw = JSON.stringify(view);
      expect(view.self.role).toBe(role);
      for (
        const token of [
          '"answerHash"',
          '"hints"',
          '"explanation"',
          '"reward"',
          '"private"',
          '"answer":',
          '"digit":8',
          '"digit":6',
          '"digit":0',
          '"digit":9',
        ]
      ) expect(raw).not.toContain(token);
      for (const other of ROLES.filter((r) => r !== role)) {
        expect(raw).not.toContain(course.stages[1].roles[other]!.intro.text);
      }
      if (role === "commander") {
        expect(view.self.transfer_clue?.value).toBe("12.3");
      } else {
        expect(view.self).not.toHaveProperty("transfer_clue");
        expect(raw).not.toContain("12.3");
      }
    }
  });
  it("uses explicit projections even if stored data acquires extra properties", async () => {
    const { content, secret } = fixture();
    const course = await prepareCourseV2(content, secret, salt);
    const marker = "PRIVATE_SENTINEL";
    Object.assign(course.stages[1], { accidentalSecret: marker });
    Object.assign(course.stages[1].roles.signal!, { accidentalSecret: marker });
    Object.assign(course.stages[1].roles.signal!.steps[0], { answer: marker });
    Object.assign(course.stages[1].narration[0], { answer: marker });
    Object.assign(course.stages[1].arrival, { qrToken: marker });
    for (const role of ROLES) {
      expect(JSON.stringify(projectStageV2(course, "gate", role))).not
        .toContain(marker);
    }
    expect(() => projectStageV2(course, "missing", "commander")).toThrow();
    const view = projectStageV2(course, "gate", "signal");
    view.self.mission!.steps[0].prompt = "changed response";
    expect(course.stages[1].roles.signal!.steps[0].prompt).not.toBe(
      "changed response",
    );
  });
});
