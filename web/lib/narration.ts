// 시작·거점 도착·사초 보상, 세 순간에만 나오는 타자 나레이션 문구.
// 초안: 공개 기록으로 확인한 사실만 쓰고, 외침·충돌 재연은 넣지 않는다.
// 도착 문구에는 그 거점의 정답(사적지 번호, 요일 등)을 쓰지 않는다.
// 출처: 국가보훈부 5·18 사적지 안내(정문), 동아일보·경향신문 기사(오전 10시 무렵 정문 항의),
// 용봉관 국가등록문화유산 제802호(1957). 줄거리는 /mnt/project-files/hoguk/story/ 참고.
export type NarrationMoment = "intro" | "arrive" | "sacho";

const ARRIVE: Record<string, string[]> = {
  gate: [
    "전남대 정문, 1980년 5월 18일 오전.",
    "교문 앞에 모인 학생들이 학교 출입을 막는 계엄군에 항의했다.",
    "그 목소리가 이 문 앞에서 시작해 광주 전체로 번졌다.",
    "잠시 멈추고, 문 둘레에 남은 기록을 찾는다.",
  ],
  yongbong: [
    "용봉관, 1957년에 세운 붉은 벽돌 건물.",
    "오랫동안 대학 본부였고, 지금은 대학의 역사와 오월의 기록을 품고 있다.",
    "정문에서 걸어온 기억이 이곳에서 다른 시간과 겹친다.",
  ],
};

export function narrationLines(
  moment: NarrationMoment,
  site?: { id: string; name: string; sacho: { name: string } },
): string[] {
  if (moment === "intro")
    return [
      "1980년 5월, 광주.",
      "그해 봄의 기억은 아직 한 권으로 모이지 않았다.",
      "실록은 사초에서 시작된다. 그 자리에서 쓴 첫 기록.",
      "네 사람의 자리에서 사초를 찾아, 오늘의 실록을 함께 엮는다.",
    ];
  if (moment === "arrive")
    return (
      ARRIVE[site?.id ?? ""] ?? [
        `${site?.name ?? "이곳"}에 도착했다.`,
        "이곳에 남은 기록을 찾는다.",
      ]
    );
  return [
    `${site?.sacho.name ?? "사초"} 한 장을 되찾았다.`,
    "네 사람이 본 것이 모여, 실록에 한 장이 더해졌다.",
  ];
}

// 같은 게임에서 이미 본 나레이션은 새로고침해도 다시 띄우지 않는다.
// localStorage "hoguk:narration"="off"는 e2e 시험에서 나레이션을 끄는 스위치다.
const seenKey = (gameId: string, key: string) =>
  `hoguk:narration-seen:${gameId}:${key}`;

export function narrationEnabled() {
  try {
    return localStorage.getItem("hoguk:narration") !== "off";
  } catch {
    return true;
  }
}

export function narrationSeen(gameId: string, key: string) {
  try {
    return sessionStorage.getItem(seenKey(gameId, key)) === "1";
  } catch {
    return false;
  }
}

export function markNarrationSeen(gameId: string, key: string) {
  try {
    sessionStorage.setItem(seenKey(gameId, key), "1");
  } catch {}
}
