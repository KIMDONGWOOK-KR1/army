import { describe, expect, it } from "vitest";
import { clearedRounds, peerRounds, recordTiles, ROLE_GAMES, shuffledOrder } from "@/lib/field-rounds";

const none = () => false;

describe("보직 판 진행(hh 2026-11-09 구성)", () => {
  it("지휘관은 퀴즈 한 판, 정찰원은 불꽃 찾기 한 판이다", () => {
    expect(ROLE_GAMES.commander.rounds.map((r) => r.kind)).toEqual(["quiz"]);
    expect(ROLE_GAMES.scout.rounds.map((r) => r.kind)).toEqual(["flame"]);
    const scout = ROLE_GAMES.scout;
    expect(clearedRounds(scout, none, 0)).toBe(0);
    expect(clearedRounds(scout, (id) => id === scout.rounds[0].step, 0)).toBe(1);
  });

  it("뒤 판 문항을 풀었으면(힌트 해설 포함) 앞 판도 깬 것으로 본다", () => {
    // 암호해독관(hh 2026-11-10): 원판 → 붉은 필름(이 폰) → 금고 번호(문항)
    const cipher = ROLE_GAMES.cipher;
    expect(cipher.rounds.map((r) => r.kind)).toEqual(["wheel", "film", "read"]);
    expect(clearedRounds(cipher, none, 1)).toBe(1);
    expect(clearedRounds(cipher, (id) => id === cipher.rounds[2].step, 0)).toBe(3);
  });

  it("통신원은 목소리 잡기(이 폰) 다음에 무전이 말한 곳 고르기(문항)다", () => {
    const signal = ROLE_GAMES.signal;
    expect(signal.rounds.map((r) => r.kind)).toEqual(["voice", "pick"]);
    expect(clearedRounds(signal, none, 1)).toBe(1);
    expect(clearedRounds(signal, (id) => id === signal.rounds[1].step, 0)).toBe(2);
  });

  it("동료 진행은 공개 값(푼 문항 수·보고)만 본다", () => {
    expect(peerRounds(ROLE_GAMES.signal, 1, false)).toBe(2);
    expect(peerRounds(ROLE_GAMES.signal, 0, false, 1)).toBe(1);
    expect(peerRounds(ROLE_GAMES.commander, 2, false)).toBe(0);
    expect(peerRounds(ROLE_GAMES.commander, 3, false)).toBe(1);
    expect(peerRounds(ROLE_GAMES.scout, 0, true)).toBe(1);
  });

  it("판 이름·안내에 '~하라'가 없다", () => {
    for (const game of Object.values(ROLE_GAMES)) {
      expect(game.rounds.length).toBeGreaterThan(0);
      for (const r of game.rounds) expect(`${r.title}${r.liveGoal}${r.goal}${r.radio}`).not.toMatch(/하라/);
    }
  });
});

describe("기록 맞추기 조각", () => {
  // [합성] 예시 글(실제 해설 아님)
  const text = "가나다 마을은 첫째 마을이에요. 2000년 1월 1일 아침 작은 행사가 처음 열린 곳이에요. 비석은 2001년에 옮겼어요.";

  it("낱말 4~10개인 문장 가운데 가장 긴 것을 7조각 안으로 나눈다", () => {
    const tiles = recordTiles(text);
    expect(tiles.join(" ")).toBe("2000년 1월 1일 아침 작은 행사가 처음 열린 곳이에요.");
    expect(tiles.length).toBeLessThanOrEqual(7);
  });

  it("빈 글이면 조각이 없다", () => {
    expect(recordTiles("")).toEqual([]);
  });

  it("섞은 차례는 늘 같고, 처음 차례 그대로는 내지 않는다", () => {
    for (const n of [2, 3, 5, 7]) {
      const a = shuffledOrder(n, 18), b = shuffledOrder(n, 18);
      expect(a).toEqual(b);
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(a.every((v, i) => v === i)).toBe(false);
    }
  });
});

describe("지휘관 정문 퀴즈 판", () => {
  const commander = ROLE_GAMES.commander;
  const quiz = commander.rounds[0];
  const ids = quiz.steps!;
  it("세 문제를 다 풀고 이 폰에서 마치기를 눌러야 깬다", () => {
    const two = (id: string) => ids.slice(0, 2).includes(id);
    expect(clearedRounds(commander, two, 0)).toBe(0);
    const all = (id: string) => ids.includes(id);
    expect(clearedRounds(commander, all, 0)).toBe(0);
    expect(clearedRounds(commander, all, 1)).toBe(1);
  });
  it("동료 칸은 퀴즈 세 문제를 다 풀어야 찬다", () => {
    expect(peerRounds(commander, 2, false)).toBe(0);
    expect(peerRounds(commander, 3, false)).toBe(1);
    expect(peerRounds(commander, 0, true)).toBe(1);
  });
});
