// 안 2 '현장 도감'(hh 2026-11-08: "안2를 기준으로 더 디벨롭해서 우리 아이템에 반영까지 해서 구현해보자").
// 정문에서 네 보직이 도구 하나씩 들고 정문 둘레의 실제 대상을 찾아 도감 네 칸을 채운다. 답은 화면이 아니라 장소에 있다.
// 엔진과 선배님 코스 파일은 고치지 않는다. 전체 시연 코스(legacy-full-course-v2.ts)에서 정문 단계만 갈아 끼운다.
// 사실은 출처가 있는 것만 쓴다: 전대신문 2020 용봉탑 기사(idxno=14801), news1 2016-12-20 '피어나다' 사진기사,
// 2009년 광주시 5·18 소공원 정비(옛 철문 모형·표지석 이전), 오픈스트리트맵 실측(정문→용봉관 338m).
// 개발용 코스 ID에서만 쓴다. 정답·채널·숫자는 이 서버 쪽 자료에만 있고 화면에는 해시만 간다.
// TODO(PR 전): 실제 현장 값은 서버 시드로 옮기고 저장소에는 [합성] 값만 둔다(정답은 GitHub에 올리지 않는다).
import { demoCourseInput } from "./course.ts";
import { legacyFullDemoV2Input } from "./legacy-full-course-v2.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { ROLES } from "./types.ts";
import type { CourseV2PrivateInput, Role, SceneText, Stage, Step } from "./types.ts";

/** 도감 단계의 문항 ID는 '.dogam' 또는 '.dogam-…'으로 끝난다(화면이 도감 화면을 고르는 표시). */
export const DOGAM_GATE_STEPS = {
  commander: ["G-01.dogam-q2", "G-01.dogam-q3", "G-01.dogam-q4"],
  scout: ["G-02.dogam-flame"],
  signal: ["G-03.dogam"],
  cipher: ["G-04.dogam"],
} as const satisfies Record<Role, readonly string[]>;

type DogamStep = {
  step: Omit<Step, "grading" | "confirmed" | "sourceRequired" | "maxLen"> & { grading?: Step["grading"] };
  answer?: string | string[];
  explanation: string;
  reward?: string;
};

export function dogamFullDemoV2Input(id: string) {
  const { content, privateInput } = legacyFullDemoV2Input(id);
  const { synthetic } = demoCourseInput();
  const index = content.stages.findIndex((stage) => stage.id === "gate");
  const base = content.stages[index];
  const scene = (sid: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
    ({ id: sid, channel: "screen", text, trigger });
  const step = (s: DogamStep["step"]): Step =>
    ({ grading: "hash", ...s, confirmed: false, sourceRequired: false, maxLen: 300 });
  const steps: Record<Role, DogamStep[]> = {
    // 지휘관 정문 퀴즈 세 문제(hh 2026-11-09): 지휘관은 정문에 도착하면 이 세 문제만 푼다.
    commander: [
    {
      step: step({ id: "G-01.dogam-q2", type: "choice",
        prompt: "전남대학교 정문이 5·18민주화운동의 발원지로 불리는 이유로 가장 알맞은 것은 무엇일까요?",
        choices: [
          "시민군이 마지막까지 도청을 지켰던 장소이기 때문이에요.",
          "5·18 희생자들이 처음으로 안장된 장소이기 때문이에요.",
          "학교 출입을 막는 계엄군에 학생들이 항의하며 맞섰던 장소이기 때문이에요.",
          "시민군이 무기를 반납하고 해산했던 장소이기 때문이에요.",
        ] }),
      answer: "3",
      explanation: "1980년 5월 18일 오전, 정문에 모인 학생들은 학교 출입을 막는 계엄군과 맞섰어요. 이후 학생들의 시위는 광주 시내로 이어졌어요. (출처: 518trail.jnu.ac.kr)",
    },
    {
      step: step({ id: "G-01.dogam-q3", type: "order", grading: "order-hash",
        prompt: "다음 사건을 먼저 일어난 순서대로 놓아 봐요.",
        choices: [
          "학생들이 금남로로 나아가 시민들과 함께 시위를 벌였다.",
          "비상계엄이 전국으로 확대되고 대학에 휴교령이 내려졌다.",
          "전남대 정문 앞에서 학생들과 학교 출입을 막는 계엄군이 충돌했다.",
        ] }),
      answer: ["2", "3", "1"],
      explanation: "5월 17일 밤 비상계엄이 전국으로 확대됐고, 18일 오전 전남대 정문에서 학생들과 계엄군의 충돌이 일어났어요. 이후 학생들은 금남로로 나아가 시민들과 함께 시위를 벌였어요. (출처: theme.archives.go.kr)",
    },
    {
      step: step({ id: "G-01.dogam-q4", type: "choice",
        prompt: "정문 인근 민주공원의 상징조형물 '피어나다'가 세 장의 꽃잎으로 표현한 가치는 무엇일까요?",
        choices: ["진리·창조·봉사", "자유·평등·박애", "민주·인권·평화", "통일·번영·협력"] }),
      answer: "3",
      explanation: "'피어나다'는 5·18을 통해 드러난 광주정신인 민주·인권·평화의 가치가 세 장의 꽃잎으로 피어나는 모습을 표현한 작품이에요.",
    }],
    // 정찰원(hh 2026-11-09): 쌍안경 대신 표지석 불꽃 모양을 카메라로 비춰 찾는다. 찾으면 확인 하나로 끝난다.
    scout: [{
      step: step({ id: "G-02.dogam-flame", type: "confirm", grading: "confirm",
        prompt: "정문 곁 표지석의 불꽃 모양을 찾았어요.",
        note: "판정은 개발 서버의 모의 판정. 실제 사진 판정은 서버 계약 뒤." }),
      answer: undefined,
      explanation: "정문 곁 5·18 사적지 표지석에서 청동 불꽃을 찾았어요. 암호해독관에게 표지석 자리를 알려 줘요.",
    }],
    signal: [
      {
        step: step({ id: "G-03.dogam", type: "choice",
          prompt: "무전이 말한 곳은 어느 것일까요?",
          choices: ["가", "나", "다"],
          note: "철문 모형의 지금 상태는 현장 확인 필요." }),
        answer: "2",
        explanation: "옛 정문은 1996년 길을 넓히며 헐렸어요. 2009년 5·18 소공원을 정비하며 1980년의 철문 모형을 세웠어요.",
      },
    ],
    cipher: [{
      step: step({ id: "G-04.dogam", type: "choice",
        prompt: "표지석에 새긴 번호를 읽어요. 5·18 사적지 제 몇 호인가요?",
        choices: ["제1호", "제5호", "제10호", "제18호"],
        note: "표지석 글자와 자리는 현장 확인 필요." }),
      answer: "1",
      explanation: "전남대 정문은 5·18 사적지 제1호예요. 1980년 5월 18일 아침 5·18민주화운동이 처음 시작된 곳이에요. 표지석은 2009년에 정문 가까이로 옮겼어요.",
    }],
  };
  // 1·2단계는 도구 쓰는 법, 3단계는 해설과 함께 나온다(엔진 규칙). 말투는 '~해요'.
  const hints: Record<Role, [string, string, string]> = {
    commander: [
      "문제 글을 끝까지 읽고, 그날 정문에서 무슨 일이 있었는지 떠올려요.",
      "순서 문제는 날짜를 떠올려요. 5월 17일 밤 다음이 18일 오전이에요.",
      "꽃잎 문제는 5·18로 드러난 광주정신을 나타내는 세 낱말이에요.",
    ],
    scout: [
      "정문 곁 잔디밭의 둥근 표지석을 찾아요. 그 위에 불꽃 모양이 있어요.",
      "불꽃을 동그라미 가운데 두고 잠깐 멈추면 저절로 찍혀요.",
      "표지석 가까이 가서 불꽃이 화면을 채우게 비춰요.",
    ],
    signal: [
      "다이얼을 천천히 돌리며 잡음이 줄어드는 쪽을 찾아요.",
      "신호 막대가 다 차면 그대로 들고 무전을 끝까지 들어요.",
      "무전을 다시 듣고 1980년의 문을 닮은 것을 골라요.",
    ],
    cipher: [
      "받침 가장자리로 공을 받으면 옆으로 꺾여 남은 먼지를 털기 쉬워요.",
      "드러난 그림의 둥근 표지석을 정문 곁에서 찾아 직접 번호를 읽어요.",
      "사적지 번호 가운데 가장 앞 번호예요.",
    ],
  };
  const tools: Record<Role, string> = {
    commander: "정문 퀴즈",
    scout: "불꽃 찾기",
    signal: "무전기",
    cipher: "기록 닦기",
  };
  const roles = {} as Stage["roles"];
  const privateRoles = {} as CourseV2PrivateInput["stages"][string]["roles"];
  const privateSteps: CourseV2PrivateInput["stages"][string]["steps"] = {};
  for (const role of ROLES) {
    roles[role] = {
      intro: scene(`dogam-g-${role}-intro`, tools[role]),
      scenes: [],
      digit: true,
      steps: steps[role].map((s) => s.step as Step),
    };
    privateRoles[role] = {
      digit: synthetic.gate[role][1],
      hints: [...hints[role]],
    };
    for (const s of steps[role]) {
      privateSteps[s.step.id] = {
        ...(s.answer !== undefined ? { answer: s.answer } : {}),
        explanation: s.explanation,
        ...(s.reward ? { reward: s.reward } : {}),
      };
    }
  }
  const stage: Stage = {
    ...base,
    narration: [
      scene("dogam-g-enter-1", "전남대 정문. 1980년 5월 18일 아침, 5·18이 시작된 자리다."),
      scene("dogam-g-enter-2", "네 사람이 도구 하나씩 들고 정문 둘레를 살핀다. 답은 눈앞의 장소에 있다."),
      scene("dogam-g-done", "네 사람이 채운 도감 한 장이 실록의 첫 장이 되었다.", "stage-complete"),
      scene("dogam-g-next", "이제 용봉관으로 걸어간다. 지휘관의 깃발이 가리킨 그 길이다.", "stage-complete"),
    ],
    roles,
  };
  delete stage.altModes;
  content.stages[index] = stage;
  content.name = "[개발용] 정문 현장 도감 · 용봉관 v1 문항";
  privateInput.stages.gate = { roles: privateRoles, steps: privateSteps };
  return { content, privateInput };
}

export function dogamFullDemoCourseV2(id: string, salt: string) {
  const { content, privateInput } = dogamFullDemoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
