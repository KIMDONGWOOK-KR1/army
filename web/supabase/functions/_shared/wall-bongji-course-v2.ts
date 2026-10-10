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
  // 추모의 벽은 미션 없이 헌화만 한다: 역할마다 '국화 올리기' 확인 하나(2026-10-10 팀 결정)
  const tribute = (id: string): Step => ({ id, type: "confirm", grading: "confirm", confirmed: true,
    prompt: "국화 한 송이를 올려 추모한다.", sourceRequired: false });
  const steps: Record<Role, Step[]> = {
    scout: [tribute("W-01.tribute")],
    signal: [tribute("W-02.tribute")],
    cipher: [tribute("W-03.tribute")],
    commander: [tribute("W-04.tribute")],
  };
  // 시연 문안. 실제 소개 글은 현장 확인 뒤 확정한다.
  const intro = "5·18민주화운동으로 희생된 이들을 기억하는 자리다. 잠시 걸음을 멈추고 새겨진 이름을 천천히 읽어 보자. 각자 국화 한 송이를 올려 마음을 전한다.";
  const template = { prompt: "[합성] 낱말 세 개를 골라 공동 문장과 근거를 작성하라.",
    wordChoices: ["[합성] 살피기", "[합성] 비교하기", "[합성] 이어가기", "[합성] 질문하기"], wordCount: 3 };
  const wall: Stage = {
    id: "wall", seq: content.stages.length + 1, kind: "memorial", name: "추모의 벽", confirmed: false, quiet: true,
    arrival: { mode: "gps", require: "all", confirmed: false, lat: null, lng: null, radiusM: 10, noticeM: 25, dwellSec: 5 },
    scoring: { enabled: false, confirmed: true, hintPenalty: { 1: 0, 2: 0, 3: 0 }, noHintBonus: 0 },
    narration: [{ id: "W-00.enter", channel: "screen", text: intro, trigger: "enter" },
      { id: "W-06.done", channel: "screen", text: "네 송이의 국화를 올렸다. 잠시 머무르거나 이동할 수 있다.", trigger: "stage-complete" }],
    roles: Object.fromEntries(ROLES.map((role) => [role, { intro: { id: `W-${role}.intro`, channel: "screen", text: intro, trigger: "enter" },
      scenes: [], digit: false, steps: steps[role] }])) as unknown as Stage["roles"],
    completion: { type: "tribute", label: "국화 올리기" },
    sacho: { id: "sacho-wall", name: "사초③ · 추모의 기록", sections: ["헌화"],
      char: "念", body: "네 사람이 추모의 벽 앞에 국화 한 송이씩을 올리고 그날을 기억했다." },
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
  content.stages.push(wall, bongji);
  for (const stage of [wall, bongji]) {
    privateInput.stages[stage.id] = {
      roles: Object.fromEntries(ROLES.map((role) => [role, { hints: [1, 2, 3].map((level) => `[합성] ${role} 확인 안내 ${level}`) }])) as CourseV2PrivateInput["stages"][string]["roles"],
      steps: Object.fromEntries(ROLES.flatMap((role) => stage.roles[role]!.steps.map((s) => [s.id, {
        explanation: stage.id === "wall" ? "국화 한 송이를 올려 추모했다." : `[합성] ${s.id} 확인 안내`,
      }]))),
    };
  }
  return { content, privateInput };
}
export function fullDemoCourseV2(id: string, salt: string) {
  const { content, privateInput } = fullDemoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
