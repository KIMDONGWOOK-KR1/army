import { yongbongDemoInput } from "./yongbong-course-v2.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { jnuGpsArrival } from "./jnu-gps.ts";
import { ROLES } from "./types.ts";
import type { CourseV2PrivateInput, Role, SceneText, Stage, Step } from "./types.ts";

/** Offsite development only. No actual scenario sentences or personal names. */
export function fullDemoV2Input(id: string) {
  const { content, privateInput } = yongbongDemoInput(id);
  const scene = (id: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
    ({ id, channel: "screen", text: `[합성] ${text}`, trigger });
  const fields = (labels: Record<string, string>) => Object.entries(labels).map(([id, label]) =>
    ({ id, label: `[합성] ${label}`, required: true, maxLen: 300 }));
  const record = (id: string, prompt: string, labels: Record<string, string>, extra: Partial<Step> = {}): Step =>
    ({ id, prompt: `[합성] ${prompt}`, type: "record-form", grading: "record", confirmed: true,
      fields: fields(labels), sourceRequired: true, sourceIds: ["MOCK-W"], maxLen: 300, ...extra });
  const steps: Record<Role, Step[]> = {
    scout: [
      { id: "W-01.people", type: "words", grading: "set-hash", confirmed: true,
        prompt: "[합성] 연습 인물 가·나를 찾아 두 이름을 입력하라.", answerCount: 2,
        sourceRequired: true, sourceIds: ["MOCK-W"] },
      record("W-01.activities", "두 인물의 활동과 출처를 각각 기록하고 이름은 팀에 말로 전달하라.",
        { activity_a: "인물 A 활동", source_a: "인물 A 출처", activity_b: "인물 B 활동", source_b: "인물 B 출처" },
        { requires: [{ role: "scout", stepId: "W-01.people" }] }),
    ],
    signal: [record("W-02.values", "정찰원의 보고를 듣고 활동과 연결되는 가치를 근거와 함께 기록하라.",
      { activity: "전달받은 활동", value: "연결한 가치", reason: "그렇게 본 근거" }, { requiresReports: ["scout"] })],
    cipher: [
      { id: "W-03.judgement", type: "truefalse", grading: "hash", confirmed: true,
        prompt: "[합성] 두 연습 인물의 활동을 같은 것으로 단정해도 되는지 판단하라.",
        statements: ["[합성] 활동이 다르다는 자료가 있어도 두 활동은 같다."], requiresReports: ["scout"] },
      record("W-03.revision", "두 활동과 시기를 비교하고 단정한 문장을 고쳐라.",
        { comparison: "활동·시기 비교", revision: "고친 문장", evidence: "수정 근거" },
        { requires: [{ role: "cipher", stepId: "W-03.judgement" }], requiresReports: ["scout"] }),
    ],
    commander: [record("W-04.facts", "세 역할의 보고를 듣고 사실 비교를 기록하라.",
      { common: "공통으로 확인한 점", difference: "다르게 확인한 점" }, { requiresReports: ["scout", "signal", "cipher"] })],
  };
  const template = { prompt: "[합성] 낱말 세 개를 골라 공동 문장과 근거를 작성하라.",
    wordChoices: ["[합성] 살피기", "[합성] 비교하기", "[합성] 이어가기", "[합성] 질문하기"], wordCount: 3 };
  const wall: Stage = {
    id: "wall", seq: content.stages.length + 1, kind: "memorial", name: "추모의 벽", confirmed: false, quiet: true,
    arrival: { mode: "gps", require: "all", confirmed: false, lat: null, lng: null, radiusM: 10, noticeM: 25, dwellSec: 5 },
    scoring: { enabled: false, confirmed: true, hintPenalty: { 1: 0, 2: 0, 3: 0 }, noHintBonus: 0 },
    narration: [scene("W-00.enter", "화면과 대화로 조용히 확인하라."), scene("W-06.done", "공동 기록을 보관했다. 잠시 머무르거나 이동할 수 있다.", "stage-complete")],
    roles: Object.fromEntries(ROLES.map((role) => [role, { intro: scene(`W-${role}.intro`, `${role} 조사 연습`),
      scenes: [], digit: false, steps: steps[role] }])) as unknown as Stage["roles"],
    completion: { type: "confirm", labels: Object.fromEntries(ROLES.map((r) => [r, "공동 문장과 근거 확인"])) as Record<Role, string> },
    recordTemplate: structuredClone(template),
    sacho: { id: "sacho-wall", name: "사초③ · 공동 확인 기록", sections: ["개인 조사", "공동 문장", "공동 근거"],
      char: "記", body: "[합성] 서로 다른 활동을 비교하고 공동 문장과 근거를 확인했다." },
  };
  const bongji: Stage = {
    id: "bongji", seq: wall.seq + 1, kind: "epilogue", name: "봉지", confirmed: false, quiet: false,
    arrival: { ...jnuGpsArrival("bongji"), confirmed: false }, scoring: structuredClone(wall.scoring),
    narration: [scene("B-00.enter", "각자 돌아본 내용을 적고 팀 기록을 완성하라.")],
    roles: Object.fromEntries(ROLES.map((role) => [role, { intro: scene(`B-${role}.intro`, `${role} 회고 연습`),
      scenes: [], digit: false, steps: [{ id: `B-01.${role}`, confirmed: true, type: "text", grading: "open", maxLen: 300,
        prompt: `[합성] ${ { commander: "보고를 연결하며 남은 질문", scout: "관찰하며 달라진 생각", signal: "전달하며 확인한 점", cipher: "비교하며 새로 발견한 점" }[role]}을 적어라.` }] }])) as unknown as Stage["roles"],
    completion: { type: "joint-record" }, recordTemplate: structuredClone(template),
  };
  content.name = "[개발용] 정문부터 봉지까지 전체 흐름";
  content.sources.push({ id: "MOCK-W", title: "[합성] 인물·활동 연습 자료", url: "https://example.com/mock-wall" });
  content.stages.push(wall, bongji);
  for (const stage of [wall, bongji]) {
    privateInput.stages[stage.id] = {
      roles: Object.fromEntries(ROLES.map((role) => [role, { hints: [1, 2, 3].map((level) => `[합성] ${role} 확인 안내 ${level}`) }])) as CourseV2PrivateInput["stages"][string]["roles"],
      steps: Object.fromEntries(ROLES.flatMap((role) => stage.roles[role]!.steps.map((s) => [s.id, {
        explanation: `[합성] ${s.id} 확인 안내`,
        ...(s.id === "W-01.people" ? { answer: ["연습 인물 가", "연습 인물 나"] } : {}),
        ...(s.id === "W-03.judgement" ? { answer: ["false"] } : {}),
      }]))),
    };
  }
  return { content, privateInput };
}
export function fullDemoCourseV2(id: string, salt: string) {
  const { content, privateInput } = fullDemoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
