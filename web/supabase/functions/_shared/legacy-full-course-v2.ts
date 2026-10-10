// 시연용 전체 코스(정문 → 용봉관 → 추모의 벽 → 봉지)에서 용봉관만 hh의 v1 시연 문항으로 바꾼다.
// (hh 2026-10-11: "용봉관 문제를 기존에 주파수 맞추고 했던 내 버전으로")
// 선배님 코스 파일(yongbong-course-v2.ts·wall-bongji-course-v2.ts)은 고치지 않고, 그 결과에서 용봉관 단계만 갈아 끼운다.
// 문항은 course.ts의 v1 용봉관(퀴즈·안내판·주파수·현판 한자)을 정문 이관(legacy-demo-course-v2.ts)과 같은 방식으로 옮긴다.
// 실제 시나리오·현장 값이 아니며 개발용 코스 ID에서만 쓴다.
import { demoCourseInput } from "./course.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { fullDemoV2Input } from "./wall-bongji-course-v2.ts";
import { ROLES } from "./types.ts";
import type { CourseV2PrivateInput, Role, SceneText, Stage, Step } from "./types.ts";

export const LEGACY_YONGBONG_STEPS: Record<Role, { id: string; type: Step["type"] }> = {
  commander: { id: "Y-01.legacy", type: "choice" },
  scout: { id: "Y-02.legacy", type: "observation" },
  signal: { id: "Y-03.legacy", type: "frequency" },
  cipher: { id: "Y-04.legacy", type: "choice" },
};

export function legacyFullDemoV2Input(id: string) {
  const { content, privateInput } = fullDemoV2Input(id);
  const { course, synthetic } = demoCourseInput();
  const old = course.sites.find((site) => site.id === "yongbong")!;
  const index = content.stages.findIndex((stage) => stage.id === "yongbong");
  const base = content.stages[index];
  const scene = (sid: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
    ({ id: sid, channel: "screen", text, trigger });
  // 힌트 2·3단계(1단계는 v1 힌트). 통신원 힌트에는 주파수를 쓰지 않는다(지휘관이 말로 전한다)
  const guidance: Record<Role, [string, string]> = {
    commander: ["도착할 때 들은 용봉관 이야기를 다시 떠올리고 선택지와 비교하라.", "해설을 읽고 용봉관이 지금 품은 것을 확인한 뒤 보고하라."],
    scout: ["시연 안내판의 제목 줄만 읽고 그대로 입력하라.", "안내판 제목을 다시 확인한 뒤 보고하라."],
    signal: ["지휘관에게 받은 주파수의 숫자와 소수점 위치를 확인하라.", "지휘관과 전달 내용을 확인한 뒤 해설을 읽고 보고하라."],
    cipher: ["봉황을 뜻하는 글자는 새 모양이 들어간 글자다.", "해설을 읽고 현판의 글자를 확인한 뒤 보고하라."],
  };
  const roles = {} as Stage["roles"];
  const privateRoles = {} as CourseV2PrivateInput["stages"][string]["roles"];
  const privateSteps: CourseV2PrivateInput["stages"][string]["steps"] = {};
  for (const role of ROLES) {
    const clue = old.clues[role];
    const [answer, digit] = synthetic.yongbong[role];
    const { id: stepId, type } = LEGACY_YONGBONG_STEPS[role];
    const step: Step = {
      id: stepId, type, grading: "hash", confirmed: false, prompt: clue.question,
      ...(clue.choices ? { choices: [...clue.choices] } : {}),
      sourceRequired: false, maxLen: 300,
      note: "hh v1 시연 용봉관 문항 재사용. 실제 시나리오·현장 값은 미확정.",
    };
    roles[role] = {
      intro: scene(`legacy-y-${role}-intro`, clue.title),
      scenes: role === "commander" ? [scene("legacy-y-commander-reference", old.sacho.body)] : [],
      digit: true,
      steps: [step],
    };
    privateRoles[role] = {
      digit,
      hints: [role === "signal" ? "지휘관의 개인 전달 단서를 말로 전달받아 주파수를 맞추어라." : clue.hint, ...guidance[role]],
      ...(role === "commander" ? { transferClue: {
        kind: "relay-frequency" as const, label: "통신원에게 말로 전달할 시연 주파수",
        value: synthetic.yongbong.signal[0], targetStepId: LEGACY_YONGBONG_STEPS.signal.id,
      } } : {}),
    };
    privateSteps[stepId] = {
      answer,
      explanation: role === "commander" ? old.sacho.body
        : role === "scout" ? "시연 안내판 제목은 「용봉관」이다. 실제 안내판 문항은 답사 후 교체한다."
        : role === "signal" ? "지휘관의 개인 단서를 말로 전달받는 협동 과정이다. 주파수는 소수점 첫째 자리까지만 입력한다."
        : "鳳(봉)은 봉황을 뜻하는 글자로, 용봉관의 '봉'이다.",
    };
  }
  const stage: Stage = {
    ...base,
    narration: [
      scene("legacy-y-enter-1", "용봉관, 1957년에 세운 붉은 벽돌 건물."),
      scene("legacy-y-enter-2", "오랫동안 대학 본부였고, 지금은 대학의 역사와 오월의 기록을 품고 있다."),
      scene("legacy-y-enter-3", "정문에서 걸어온 기억이 이곳에서 다른 시간과 겹친다."),
      scene("legacy-y-done", "네 사람이 본 것이 모여, 실록에 한 장이 더해졌다.", "stage-complete"),
    ],
    roles,
    completion: { type: "lock", order: [...old.lockOrder] },
    sacho: { id: "sacho-yongbong", name: "사초② · 겹친 시간의 기록", char: old.sacho.char, body: old.sacho.body,
      sections: ["관찰 기록", "출처 및 확인 방식"] },
  };
  delete stage.altModes;
  content.stages[index] = stage;
  content.name = "[개발용] 정문부터 봉지까지 · 용봉관 v1 문항";
  // 용봉관 합성 연습 자료 목록은 v1 문항에 쓰지 않는다(남아 있으면 '연습 문항' 표시가 붙는다)
  content.sources = content.sources.filter((source) => source.id !== "MOCK-Y");
  privateInput.stages.yongbong = { roles: privateRoles, steps: privateSteps };
  return { content, privateInput };
}

export function legacyFullDemoCourseV2(id: string, salt: string) {
  const { content, privateInput } = legacyFullDemoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
