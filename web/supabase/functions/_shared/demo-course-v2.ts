import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { isDevCourseId } from "./deployment.ts";
import { ROLES } from "./types.ts";
import type {
  CourseV2Content,
  CourseV2PrivateInput,
  Role,
  RoleMission,
  SceneText,
  Stage,
  Step,
  StepAnswer,
} from "./types.ts";

// Entirely synthetic development material. Never import scenario files or use in prod.
// Answers here are synthetic examples; deployed hashes always use the caller's salt.
export function demoV2Input(id: string) {
  if (!isDevCourseId(id)) throw new Error("dev 합성 코스 ID가 필요하다.");
  const scene = (id: string, text: string): SceneText => ({
    id,
    channel: "screen",
    text: `[합성] ${text}`,
    trigger: "enter",
  });
  const step = (
    id: string,
    type: Step["type"],
    grading: Step["grading"],
    extra: Partial<Step> = {},
  ): Step => ({
    id,
    type,
    grading,
    confirmed: true,
    prompt: `[합성] ${id} 연습 입력`,
    sourceRequired: true,
    sourceIds: ["MOCK-S1"],
    maxLen: 300,
    ...extra,
  });
  const fields = (...ids: string[]) =>
    ids.map((id) => ({
      id,
      label: `[합성] ${id} 기록`,
      required: true,
      maxLen: 300,
    }));
  const requires = (role: Role, stepId: string) => [{ role, stepId }];
  const choices = [
    "[합성] 항목 가",
    "[합성] 항목 나",
    "[합성] 항목 다",
    "[합성] 항목 라",
  ];
  const steps: Record<Role, Step[]> = {
    commander: [
      step("G-01.verdict", "truefalse", "hash", {
        statements: choices,
        requiresReports: ["scout", "signal", "cipher"],
      }),
      step("G-01.order", "order", "order-hash", {
        choices,
        requires: requires("commander", "G-01.verdict"),
      }),
      step("G-01.evidence", "match", "map-hash", {
        choices,
        fields: fields("event-a", "event-b", "event-c", "event-d"),
        requires: requires("commander", "G-01.order"),
      }),
    ],
    scout: [
      step("G-02.name", "observation", "hash", {
        normalize: { caseInsensitive: true, ignoreSpaces: true },
      }),
      step("G-02.record", "record-form", "record", {
        fields: fields("shape", "source", "memo"),
        requires: requires("scout", "G-02.name"),
      }),
    ],
    signal: [
      step("G-03.freq", "frequency", "hash"),
      step("G-03.words", "words", "set-hash", {
        answerCount: 3,
        requires: requires("signal", "G-03.freq"),
      }),
    ],
    cipher: [
      step("G-04.spots", "spot-correct", "set-hash", {
        choices: [...choices, "[합성] 항목 마"],
        answerCount: 3,
      }),
      step("G-04.corrections", "record-form", "record", {
        fields: fields("time", "reason", "destination", "source"),
        requires: requires("cipher", "G-04.spots"),
      }),
    ],
  };
  const mission = (role: Role): RoleMission => ({
    intro: scene(`MOCK-${role}.intro`, `${role} 개인 안내`),
    scenes: [],
    digit: true,
    steps: steps[role],
  });
  const roles = {
    commander: mission("commander"),
    scout: mission("scout"),
    signal: mission("signal"),
    cipher: mission("cipher"),
  };
  const gate: Stage = {
    id: "gate",
    seq: 2,
    kind: "mission",
    name: "[합성] 정문",
    confirmed: false,
    quiet: false,
    arrival: {
      mode: "gps",
      require: "all",
      confirmed: false,
      lat: null,
      lng: null,
      radiusM: 15,
      noticeM: 20,
      dwellSec: 5,
    },
    scoring: {
      enabled: true,
      confirmed: false,
      hintPenalty: { 1: 0, 2: 10, 3: 30 },
      noHintBonus: 5,
      note: "합성 검증 수치, 실제 정책 아님",
    },
    roles,
    narration: [scene("MOCK-GATE.enter", "공통 안내")],
    completion: { type: "lock", order: [...ROLES] },
    sacho: {
      id: "mock-sacho-gate",
      name: "[합성] 정문 기록",
      sections: ["사건 확인", "관찰 기록", "출처 및 방식"],
    },
  };
  const emptyRoles = {
    commander: null,
    scout: null,
    signal: null,
    cipher: null,
  };
  const prologue: Stage = {
    id: "intro",
    seq: 1,
    kind: "prologue",
    name: "[합성] 시작",
    confirmed: false,
    quiet: false,
    arrival: {
      mode: "none",
      require: "all",
      confirmed: false,
      lat: null,
      lng: null,
    },
    scoring: {
      enabled: false,
      confirmed: false,
      hintPenalty: { 1: 0, 2: 0, 3: 0 },
      noHintBonus: 0,
    },
    roles: emptyRoles,
    narration: [],
    completion: { type: "joint-record" },
  };
  const content: CourseV2Content = {
    schemaVersion: 2,
    id,
    name: "[합성] 정문 API 연습",
    confirmed: false,
    demo: true,
    sources: [{
      id: "MOCK-S1",
      title: "[합성] 연습 자료",
      url: "https://example.com/mock-source",
    }],
    settings: {
      teamSize: 4,
      roleSwapEnabled: false,
      roleSwapSeconds: 30,
      note: "PR-2 정문만 실행",
    },
    stages: [prologue, gate],
  };
  const answers: Record<string, StepAnswer> = {
    "G-01.verdict": ["true", "false", "true", "false"],
    "G-01.order": ["3", "1", "4", "2"],
    "G-01.evidence": {
      "event-a": "2",
      "event-b": "4",
      "event-c": "1",
      "event-d": "3",
    },
    "G-02.name": "Mock Sculpture",
    "G-03.freq": "82.6",
    "G-03.words": ["합성가", "합성나", "합성다"],
    "G-04.spots": ["1", "3", "5"],
  };
  const privateInput: CourseV2PrivateInput = {
    schemaVersion: 2,
    courseId: id,
    synthetic: true,
    stages: {
      intro: { roles: emptyRoles, steps: {} },
      gate: {
        roles: Object.fromEntries(ROLES.map((role, i) => [role, {
          digit: i + 2,
          hints: [1, 2, 3].map((level) => `[합성] ${role} 힌트 ${level}`),
          ...(role === "commander"
            ? {
              transferClue: {
                kind: "relay-frequency",
                label: "[합성] 전달 안내",
                value: answers["G-03.freq"],
                targetStepId: "G-03.freq",
              },
            }
            : {}),
        }])) as CourseV2PrivateInput["stages"][string]["roles"],
        steps: Object.fromEntries(
          Object.values(steps).flat().map((s) => [s.id, {
            ...(answers[s.id] ? { answer: answers[s.id] } : {}),
            explanation: `[합성] ${s.id} 해설`,
            ...(s.id === "G-03.freq"
              ? { reward: "[합성] 복원 자료: 합성가 합성나 합성다" }
              : {}),
          }]),
        ),
      },
    },
  };
  return { content, privateInput };
}
export function demoCourseV2(id: string, salt: string) {
  const { content, privateInput } = demoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
