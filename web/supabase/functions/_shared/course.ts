// Synthetic demonstration content only. This module is never imported by client components.
import { answerHash } from "./engine.ts";
import { type Clue, type Course, type Role, ROLES } from "./types.ts";
const clue = (
  type: Clue["type"],
  title: string,
  question: string,
  hint: string,
  choices?: string[],
): Clue => ({
  type,
  title,
  question,
  hint,
  ...(choices ? { choices } : {}),
  ...(type === "frequency" ? { min: 10, max: 100 } : {}),
});
// The default is for the existing local-only demo. Cloud seeding must supply ANSWER_SALT.
export async function demoCourse(
  salt = "hoguk-synthetic-demo-only",
): Promise<Course> {
  const course: Course = {
    id: "jnu-demo",
    name: "전남대, 기억을 잇는 길",
    confirmed: false,
    demo: true,
    sites: [
      {
        id: "gate",
        seq: 1,
        name: "전남대 정문",
        lat: null,
        lng: null,
        radiusM: 30,
        reverent: true,
        lockOrder: [...ROLES],
        sacho: {
          char: "證",
          name: "증언의 사초",
          body: "1980년 5월 17일 밤, 계엄군이 학교에 들어와 도서관에 남아 있던 학생들을 연행했다. 이튿날 오전 이 문 앞에서 학생들이 학교 출입을 막는 계엄군에 항의했고, 그 목소리가 광주 전체로 번졌다. 문 곁의 표지석은 이곳을 5·18이 시작된 곳으로 기록한다.",
        },
        clues: {
          commander: clue(
            "quiz",
            "그날 아침의 질문",
            "1980년 5월 18일 오전, 학생들이 정문 앞에 모인 까닭은?",
            "도착할 때 들은 기록을 떠올려라.",
            [
              "체육대회를 열려고",
              "학교 출입을 막는 계엄군에 항의하려고",
              "시험을 치르려고",
            ],
          ),
          scout: clue(
            "find",
            "표지석의 흔적",
            "시연 표지석에 적힌 사적지 번호를 찾아라.",
            "시연 표지석: 「5·18 사적지 제1호」. 현장 표지석은 답사로 확인한다.",
          ),
          signal: clue(
            "frequency",
            "기억의 주파수",
            "흩어진 신호를 하나의 주파수로 맞추어라.",
            "시연 수신 기록: 51.8 MHz. 실제 현장의 꽃잎 단서는 미확정이다.",
          ),
          cipher: clue(
            "calendar",
            "그날의 달력",
            "1980년 5월 18일은 무슨 요일인가?",
            "달력에서 18일이 놓인 요일을 찾아라.",
            [
              "월요일",
              "화요일",
              "수요일",
              "목요일",
              "금요일",
              "토요일",
              "일요일",
            ],
          ),
        },
        answers: {} as Course["sites"][number]["answers"],
      },
      {
        id: "yongbong",
        seq: 2,
        name: "용봉관",
        lat: null,
        lng: null,
        radiusM: 30,
        reverent: false,
        walkMin: 4,
        lockOrder: [...ROLES],
        sacho: {
          char: "層",
          name: "겹친 시간의 사초",
          body: "용봉관은 1957년에 세워져 오랫동안 대학 본부로 쓰였고, 지금은 국가등록문화유산으로 대학의 역사와 오월의 기록을 품고 있다. 2020년 5월 문을 연 '전남대 민주길' 정의의 길은 정문에서 출발해, 민주화에 헌신한 이들의 이름을 딴 자리를 지나 이 옛 본부에 닿는다.",
        },
        clues: {
          commander: clue(
            "quiz",
            "옛 본부의 질문",
            "용봉관이 지금 품고 있는 것은 무엇인가?",
            "도착할 때 들은 기록을 떠올려라.",
            ["학생 식당", "실내 체육관", "대학의 역사와 오월의 기록"],
          ),
          scout: clue(
            "find",
            "안내판을 읽어라",
            "시연 안내판의 건물 이름을 찾아라.",
            "시연 안내판 제목: 「용봉관」. 실제 안내판 문항은 답사 후 교체한다.",
          ),
          signal: clue(
            "frequency",
            "시간 사이의 신호",
            "오래된 수신 기록을 따라 주파수를 맞추어라.",
            "시연 수신 기록: 19.9 MHz. 역사 연도와의 대응은 실제 코스에서 확인한다.",
          ),
          cipher: clue(
            "hanja",
            "현판의 글자",
            "현판의 鳳과 같은 글자가 있는 칸을 찾아라.",
            "봉황을 뜻하는 글자를 살펴라.",
            ["龍", "山", "門", "光", "時", "記", "南", "鳳", "學"],
          ),
        },
        answers: {} as Course["sites"][number]["answers"],
      },
    ],
  };
  const synthetic: Record<string, Record<Role, [string, number]>> = {
    gate: {
      commander: ["2", 2],
      scout: ["1", 1],
      signal: ["51.8", 3],
      cipher: ["일요일", 7],
    },
    yongbong: {
      commander: ["3", 3],
      scout: ["용봉관", 4],
      signal: ["19.9", 6],
      cipher: ["8", 8],
    },
  };
  for (const s of course.sites) {
    for (const role of ROLES) {
      const [answer, digit] = synthetic[s.id][role];
      s.answers[role] = {
        answerHash: await answerHash(
          salt,
          s.id,
          role,
          s.clues[role],
          answer,
        ),
        digit,
      };
    }
  }
  return course;
}
