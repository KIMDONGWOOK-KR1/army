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
          body:
            "기억은 한 사람의 목소리로 완성되지 않는다. 서로 다른 자리에서 찾은 단서를 모아, 이곳에 남은 이야기를 함께 기록했다.",
        },
        clues: {
          commander: clue(
            "quiz",
            "기억을 잇는 질문",
            "현장의 역사를 함께 기억하는 가장 좋은 방법은 무엇인가?",
            "시연용 학습 문항이다. 각자의 관찰을 나누어라.",
            [
              "한 사람의 답만 따른다",
              "서로의 관찰과 기록을 나눈다",
              "빨리 지나가며 순위를 겨룬다",
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
          body:
            "장소에는 여러 시대의 시간이 겹쳐 있다. 오늘의 우리는 이전의 기록을 읽고, 다음 사람이 이어 갈 기억을 남긴다.",
        },
        clues: {
          commander: clue(
            "quiz",
            "시간을 읽는 질문",
            "오래된 건물을 읽을 때 함께 살펴야 할 것은 무엇인가?",
            "기억의 층은 사람과 기록, 장소를 함께 볼 때 드러난다.",
            ["건물의 크기만", "오늘의 풍경만", "시대별 기록과 그곳의 사람들"],
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
