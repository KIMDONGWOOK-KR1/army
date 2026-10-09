import { legacyDemoV2Input } from "./legacy-demo-course-v2.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { jnuGpsArrival } from "./jnu-gps.ts";
import { ROLES } from "./types.ts";
import type { CourseV2PrivateInput, Role, SceneText, Stage, Step, StepAnswer } from "./types.ts";

// Synthetic test material only. Actual scenario authoring stays in ignored private files.
export function yongbongDemoInput(id: string, gps = false) {
  const { content, privateInput } = legacyDemoV2Input(id, gps);
  const scene = (id: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
    ({ id, channel: "screen", text: `[합성] ${text}`, trigger });
  const fields = (labels: Record<string, string>) => Object.entries(labels).map(([id, label]) =>
    ({ id, label, required: true, maxLen: 300 }));
  const ref = (role: Role, stepId: string) => ({ role, stepId });
  const step = (id: string, type: Step["type"], grading: Step["grading"], prompt: string, extra: Partial<Step> = {}): Step =>
    ({ id, type, grading, prompt: `[합성] ${prompt}`, confirmed: true,
      sourceRequired: true, sourceIds: ["MOCK-Y"], maxLen: 300, ...extra });
  const cards = ["[합성] 자료 가", "[합성] 자료 나", "[합성] 자료 다", "[합성] 자료 라"];
  const slots = fields({ a: "[합성] 카드 A", b: "[합성] 카드 B", c: "[합성] 카드 C", d: "[합성] 카드 D" });
  const steps: Record<Role, Step[]> = {
    scout: [
      step("Y-01.features", "multi-choice", "set-hash", "연습 도면에서 특징 두 가지를 선택하라.",
        { choices: cards, answerCount: 2 }),
      step("Y-01.use", "text", "hash", "연습 건물의 이전 용도를 입력하라.",
        { requires: [ref("scout", "Y-01.features")], normalize: { caseInsensitive: true, ignoreSpaces: true } }),
    ],
    signal: [
      step("Y-02.functions", "match", "map-hash", "네 자료를 각각 다른 설명과 연결하라.", { choices: cards, fields: slots }),
      step("Y-02.choice", "choice", "hash", "연습 자료의 확인 방법을 선택하라.",
        { choices: cards, requires: [ref("signal", "Y-02.functions")] }),
      step("Y-02.record", "record-form", "record", "자료 한 점을 기록하라. 모르는 칸은 확인 불가로 남겨라.", {
        requires: [ref("signal", "Y-02.choice")], fields: fields({ title: "자료 제목", type: "자료 유형",
          created_at: "표시된 작성 시기", provider: "소장처 또는 제공기관", known: "자료에서 확인한 내용" }),
      }),
    ],
    cipher: [
      step("Y-03.sources", "match", "map-hash", "카드와 확인 항목을 연결하라.", { choices: cards, fields: slots }),
      step("Y-03.verdict", "truefalse", "hash", "연습 문장의 참·거짓을 고르라.",
        { statements: ["[합성] 문장 가", "[합성] 문장 나"], requires: [ref("cipher", "Y-03.sources")] }),
      step("Y-03.limits", "record-form", "record", "전달받은 자료의 확인 범위와 남은 질문을 기록하라.", {
        requires: [ref("cipher", "Y-03.verdict"), ref("signal", "Y-02.record")],
        recordFrom: ref("signal", "Y-02.record"),
        fields: fields({ checked: "확인된 항목", missing: "확인하지 못한 항목", limit: "단정할 수 없는 내용", question: "추가 질문" }),
      }),
    ],
    commander: [
      step("Y-04.classify", "classification", "map-hash", "보고를 듣고 각 연습 문장을 분류하라.", {
        choices: ["자료로 뒷받침됨", "반대 근거가 있음", "판단 유보"], fields: slots,
        requiresReports: ["scout", "signal", "cipher"],
      }),
      step("Y-04.evidence", "match", "map-hash", "연습 주장과 근거를 연결하라.",
        { choices: cards, fields: slots, requires: [ref("commander", "Y-04.classify")] }),
      step("Y-04.revision", "record-form", "record", "보고서의 확인 내용과 후속 확인 내용을 나누어 작성하라.", {
        requires: [ref("commander", "Y-04.evidence")],
        fields: fields({ verified: "자료로 확인한 내용", follow_up: "추가 확인할 내용" }),
      }),
    ],
  };
  const stage: Stage = {
    id: "yongbong", seq: content.stages.length + 1, kind: "mission", name: "용봉관", confirmed: false, quiet: false,
    arrival: gps ? jnuGpsArrival("yongbong") : { ...jnuGpsArrival("yongbong"), confirmed: false, note: "합성 개발 코스의 모의 도착" },
    // D5: synthetic exercise values only; real hint/bonus amounts remain unconfirmed.
    scoring: structuredClone(content.stages[0].scoring),
    narration: [scene("Y-00.enter", "자료 확인 연습을 시작하라."), scene("Y-05.done", "확인한 내용과 남은 질문을 보관했다.", "stage-complete")],
    roles: Object.fromEntries(ROLES.map((role) => [role, {
      intro: scene(`Y-${role}.intro`, `${role} 자료 조사 연습`), scenes: [], digit: true, steps: steps[role],
    }])) as unknown as Stage["roles"],
    completion: { type: "lock", order: [...ROLES] },
    altModes: [{ id: "outdoor", label: "외부 대체 조사" }],
    sacho: { id: "sacho-yongbong", name: "사초② · 자료 조사 기록", char: "考",
      sections: ["자료 제목", "출처", "확인 범위", "추가 질문"], body: "[합성] 자료를 확인하고 남은 질문을 기록했다." },
  };
  const answers: Record<string, StepAnswer> = {
    "Y-01.features": ["1", "3"], "Y-01.use": "Mock Archive",
    "Y-02.functions": { a: "2", b: "4", c: "1", d: "3" }, "Y-02.choice": "2",
    "Y-03.sources": { a: "4", b: "1", c: "3", d: "2" }, "Y-03.verdict": ["true", "false"],
    "Y-04.classify": { a: "1", b: "3", c: "2", d: "3" },
    "Y-04.evidence": { a: "3", b: "2", c: "4", d: "1" },
  };
  content.name = "[개발용] 정문·용봉관 흐름 확인";
  content.settings.note = "정문 시연 문항 + 용봉관 합성 문항. 현장·콘텐츠 검증은 별도.";
  content.sources.push({ id: "MOCK-Y", title: "[합성] 용봉관 연습 자료", url: "https://example.com/mock-yongbong" });
  content.stages.push(stage);
  privateInput.stages.yongbong = {
    roles: Object.fromEntries(ROLES.map((role, index) => [role, { digit: index + 1,
      hints: [1, 2, 3].map((level) => `[합성] ${role} 조사 안내 ${level}`) }])) as CourseV2PrivateInput["stages"][string]["roles"],
    steps: Object.fromEntries(Object.values(steps).flat().map((s) => [s.id, {
      ...(answers[s.id] ? { answer: answers[s.id] } : {}), explanation: `[합성] ${s.id} 확인 안내`,
    }])),
  };
  return { content, privateInput };
}

export function yongbongDemoCourseV2(id: string, salt: string, gps = false) {
  const { content, privateInput } = yongbongDemoInput(id, gps);
  return prepareCourseV2(content, privateInput, salt);
}
