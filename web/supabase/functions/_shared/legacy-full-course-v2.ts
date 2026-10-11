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
  // 힌트 1~3단계(hh 2026-10-11: 문항마다 새로 씀). 힌트·해설·장면 어디에도 정답 값(선택 번호·이름·주파수·칸)을 쓰지 않는다.
  // 통신원 주파수는 지휘관 화면의 전달 단서로만 나온다(정문과 같은 협동 방식).
  const hints: Record<Role, [string, string, string]> = {
    commander: [
      "도착할 때 들은 용봉관 이야기를 떠올려라. 건물이 '지금' 무엇을 품고 있는지가 열쇠다.",
      "선택지 가운데 이 건물의 옛 쓰임·지금 쓰임과 관계없는 것부터 지워라.",
      "남은 선택지를 도착 이야기의 마지막 문장과 맞춰 본 뒤 해설로 확인하라.",
    ],
    scout: [
      "건물 앞 시연 안내판에서 맨 위 제목 줄을 찾아라.",
      "제목 줄에는 이 건물의 이름이 적혀 있다. 띄어쓰기 없이 그대로 옮겨라.",
      "안내판 제목을 다시 읽고 해설로 확인하라.",
    ],
    signal: [
      "주파수는 지휘관에게만 보인다. 지휘관에게 말로 전달받아라.",
      "전달받은 숫자의 소수점 위치를 확인하고 다이얼이나 입력 칸으로 맞추어라. 소수점은 한 자리까지다.",
      "지휘관과 숫자를 한 번 더 확인한 뒤 해설로 확인하라.",
    ],
    cipher: [
      "현판의 글자는 봉황을 뜻한다.",
      "건물 이름 '용봉관'에서 봉황을 뜻하는 글자와 같은 모양을 아홉 칸에서 찾아라. 새를 닮은 획이 들어 있다.",
      "용·산·문처럼 다른 뜻의 글자를 지우고 남은 칸을 해설로 확인하라.",
    ],
  };
  const explanations: Record<Role, string> = {
    commander: "용봉관은 1957년에 세워져 오랫동안 대학 본부로 쓰였고, 지금은 국가등록문화유산으로 남아 있다. 도착 이야기에서 들은 지금의 쓰임을 고르는 문항이다.",
    scout: "시연 안내판 제목 줄에 적힌 건물 이름을 그대로 적는 문항이다. 실제 안내판 문항은 답사 후 교체한다.",
    signal: "지휘관의 개인 단서를 말로 전달받는 협동 과정이다. 주파수는 소수점 첫째 자리까지만 입력한다.",
    cipher: "용봉관의 '봉'은 봉황을 뜻하는 한자다. 현판과 같은 글자가 있는 칸을 찾는 문항이다.",
  };
  // 지휘관이 다시 읽을 수 있는 참고 글(정답 문장은 뺀 용봉관 소개)
  const reference = "용봉관은 1957년에 세워져 오랫동안 대학 본부로 쓰였다. 2020년 5월 문을 연 '전남대 민주길' 정의의 길은 정문에서 출발해 이 옛 본부에 닿는다.";
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
      scenes: role === "commander" ? [scene("legacy-y-commander-reference", reference)] : [],
      digit: true,
      steps: [step],
    };
    privateRoles[role] = {
      digit,
      hints: [...hints[role]],
      ...(role === "commander" ? { transferClue: {
        kind: "relay-frequency" as const, label: "통신원에게 말로 전달할 시연 주파수",
        value: synthetic.yongbong.signal[0], targetStepId: LEGACY_YONGBONG_STEPS.signal.id,
      } } : {}),
    };
    privateSteps[stepId] = {
      answer,
      explanation: explanations[role],
    };
  }
  const stage: Stage = {
    ...base,
    narration: [
      scene("legacy-y-enter-1", "용봉관, 1957년에 세운 붉은 벽돌 건물."),
      scene("legacy-y-enter-2", "오랫동안 대학 본부였고, 지금은 대학의 역사와 오월의 기록을 품고 있다."),
      scene("legacy-y-enter-3", "정문에서 걸어온 기억이 이곳에서 다른 시간과 겹친다."),
      scene("legacy-y-done", "네 사람이 본 것이 모여, 실록에 한 장이 더해졌다.", "stage-complete"),
      // 다음 거점을 말로 알린다(hh 2026-10-11: 용봉관 다음에 추모의 벽으로 간다는 말이 없었다)
      scene("legacy-y-next", "이제 용봉열사 추모의 벽으로 걸어간다. 지휘관이 출발을 알리면 함께 움직인다.", "stage-complete"),
    ],
    roles,
    completion: { type: "lock", order: [...old.lockOrder] },
    sacho: { id: "sacho-yongbong", name: old.sacho.name, char: old.sacho.char, body: old.sacho.body,
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
