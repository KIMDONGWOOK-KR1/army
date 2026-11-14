// 보직마다 세 판짜리 현장 게임(hh 2026-11-08: 같은 도감 틀에 묶지 말고, 갈수록 재미있게).
// 판 이름·안내·판 사이 무전만 갖는다. 정답·채널·숫자·이야기(해설)는 서버에서만 온다.
// 판 가운데 step이 있는 판은 서버가 확인하는 문항이고, 없는 판은 이 폰에서만 깨는 현장 동작이다.
import type { Role } from "@/supabase/functions/_shared/types";

export type RoundKind =
  | "flag" | "flags" | "roadEnd"
  | "scopeNear" | "scopeFar" | "petals"
  | "rub" | "read" | "tiles"
  | "tune" | "hunt" | "pick"
  | "quiz" | "flame" | "voice" | "dust" | "wheel" | "film";

export type RoundDef = {
  kind: RoundKind;
  /** 판 이름(~하기) */
  title: string;
  /** 그림으로 할 때 판 이름이 다르면 */
  drawnTitle?: string;
  /** 진짜 카메라·나침반으로 할 때 첫 줄 */
  liveGoal: string;
  /** 그림으로 할 때 첫 줄 */
  goal: string;
  /** 이 판이 열릴 때 들어오는 기록실 무전 한 줄 */
  radio: string;
  /** 서버가 확인하는 문항 */
  step?: string;
  /** 서버가 확인하는 문항이 여럿인 판(퀴즈). 모두 풀어야 깬다. */
  steps?: string[];
  /** 문항을 다 풀어도 이 폰에서 '마치기'를 눌러야 깬다(마지막 해설을 읽을 시간) */
  ack?: boolean;
};

/** 이 판에서 서버가 확인하는 문항 ID들 */
export const roundSteps = (round: RoundDef) => round.steps ?? (round.step ? [round.step] : []);

export type RoleGame = { role: Role; name: string; intro: string; rounds: RoundDef[] };

export const ROLE_GAMES: Record<Role, RoleGame> = {
  commander: {
    // hh 2026-11-09: 지휘관은 정문에 도착하면 다른 미션 없이 퀴즈 세 문제만 푼다.
    role: "commander", name: "정문 퀴즈",
    intro: "지휘관은 이 자리가 왜 5·18이 시작된 곳인지 먼저 짚어요. 세 문제를 풀고 팀 자물쇠를 열어요.",
    rounds: [
      {
        // 문제 글·선택지·정답·해설은 서버 코스에만 있다.
        kind: "quiz", title: "정문 퀴즈 풀기", ack: true, steps: ["G-01.dogam-q2", "G-01.dogam-q3", "G-01.dogam-q4"],
        liveGoal: "정문에서 있었던 일을 세 문제로 짚어요. 틀려도 다시 고를 수 있어요.",
        goal: "정문에서 있었던 일을 세 문제로 짚어요. 틀려도 다시 고를 수 있어요.",
        radio: "지휘관, 정문에 도착했어요. 이곳이 왜 5·18이 시작된 자리인지 세 문제로 짚어 봐요.",
      },
    ],
  },
  scout: {
    // hh 2026-11-09: 쌍안경 대신 표지석의 불꽃 모양을 카메라로 비춰 찾는다(scout-scan 모의 판정).
    role: "scout", name: "불꽃 찾기",
    intro: "정찰원은 눈으로 먼저 찾아요. 정문 곁 표지석의 불꽃 모양을 찾아 카메라로 비춰요.",
    rounds: [
      {
        kind: "flame", title: "불꽃 모양 찾기", step: "G-02.dogam-flame",
        liveGoal: "수수께끼를 읽고 불꽃 모양을 찾아요. 동그라미에 맞추고 잠깐 멈추면 찍혀요.",
        goal: "수수께끼를 읽고 불꽃 모양을 찾아요. 동그라미에 맞추고 잠깐 멈추면 찍혀요.",
        radio: "정찰원, 정문 곁 어딘가에 꺼지지 않는 불꽃이 있어요. 찾아서 비춰 줘요.",
      },
    ],
  },
  cipher: {
    // hh 2026-11-10: 어른도 지루하지 않게 방탈출처럼 세 단계를 잇는다.
    // 암호 원판으로 쪽지를 풀면 도구(붉은 필름)를 알게 되고, 필름으로 검열된 편지를 비추면 숨은 문장이 나오고,
    // 그 문장이 가리키는 진짜 표지석의 번호가 기록실 금고 번호다(번호는 서버 문항).
    role: "cipher", name: "기록실 금고",
    intro: "암호해독관은 기록실 금고를 열어요. 원판으로 쪽지를 풀고, 붉은 필름으로 편지를 비추고, 현장의 표지석에서 금고 번호를 찾아요.",
    rounds: [
      {
        kind: "wheel", title: "암호 쪽지 풀기",
        liveGoal: "원판을 돌려 기호 쪽지를 풀어요. 열쇠 글자를 맞추면 쪽지가 문장으로 읽혀요.",
        goal: "원판을 돌려 기호 쪽지를 풀어요. 열쇠 글자를 맞추면 쪽지가 문장으로 읽혀요.",
        radio: "암호해독관, 기록실 금고 앞에 기호로 된 쪽지가 붙어 있어요. 원판을 돌려 무슨 말인지 풀어 줘요.",
      },
      {
        kind: "film", title: "편지 비추기",
        liveGoal: "붉은 필름을 끌어 검열된 편지를 비춰요. 숨은 낱말 여섯 개를 모아요.",
        goal: "붉은 필름을 끌어 검열된 편지를 비춰요. 숨은 낱말 여섯 개를 모아요.",
        radio: "금고 안에 붉은 줄로 지운 편지가 있어요. 쪽지대로 붉은 필름을 대 보면 지운 줄 밑의 글이 보일 거예요.",
      },
      {
        kind: "read", title: "금고 번호 찾기", step: "G-04.dogam",
        liveGoal: "편지가 가리킨 표지석을 현장에서 찾아 새긴 번호를 읽어요. 그 번호가 금고 번호예요.",
        goal: "편지가 가리킨 표지석을 현장에서 찾아 새긴 번호를 읽어요. 그 번호가 금고 번호예요.",
        radio: "편지가 말한 둥근 돌이 정문 곁에 있어요. 직접 가서 새긴 번호를 읽고 금고를 열어 줘요.",
      },
    ],
  },
  signal: {
    // hh 2026-11-09: 다이얼을 돌리면 잡음 속 기록실 목소리(TTS)가 또렷해진다. 들은 내용으로 무전이 말한 곳을 고른다.
    role: "signal", name: "무전 추적",
    intro: "통신원은 보이지 않는 목소리를 찾아요. 다이얼을 돌려 잡음 속 기록실 무전을 잡고, 무전이 말한 곳을 찾아요.",
    rounds: [
      {
        kind: "voice", title: "목소리 잡기",
        liveGoal: "다이얼을 천천히 돌려요. 잡음이 걷히고 목소리가 또렷해지면 그대로 끝까지 들어요.",
        goal: "다이얼을 천천히 돌려요. 잡음이 걷히고 목소리가 또렷해지면 그대로 끝까지 들어요.",
        radio: "통신원, 기록실이 정문 근처 어딘가로 무전을 보내고 있어요. 다이얼을 돌려 목소리를 잡아 줘요.",
      },
      {
        kind: "pick", title: "무전이 말한 곳 찾기", step: "G-03.dogam",
        liveGoal: "무전이 말한 것을 둘레에서 찾아 골라요.",
        goal: "무전이 말한 곳을 골라요. 현장에서는 다 같이 둘러보고 손으로 가리켜요.",
        radio: "그쪽에 무전이 말한 것이 있을 거예요. 직접 보고 골라 줘요.",
      },
    ],
  },
};

/** 깬 판 수. 서버 문항 판은 푼 문항으로, 현장 동작 판은 이 폰에 남긴 진행으로 센다.
 * 뒤 판을 깼으면 앞 판도 깬 것으로 본다(힌트 해설로 건너뛴 경우 포함). */
export function clearedRounds(game: RoleGame, solved: (stepId: string) => boolean, local: number) {
  let n = 0;
  game.rounds.forEach((round, i) => {
    const ids = roundSteps(round);
    if (ids.length ? ids.every(solved) && (!round.ack || local > i) : local > i) n = i + 1;
  });
  return n;
}

/** 동료가 깬 판 수(공개 값만): 서버가 센 푼 문항 수와 보고 여부. 혼자 데모면 이 폰의 진행도 본다. */
export function peerRounds(game: RoleGame, doneSteps: number, reported: boolean, local = 0) {
  if (reported) return game.rounds.length;
  let n = 0, seen = 0;
  game.rounds.forEach((round, i) => {
    const ids = roundSteps(round);
    if (ids.length) { if (seen + ids.length <= doneSteps) { seen += ids.length; n = i + 1; } else seen = Infinity; }
    else if (local > i) n = Math.max(n, i + 1);
  });
  return n;
}

/** 해설 글에서 기록 한 줄을 골라 낱말 조각으로 나눈다(낱말 4~10개인 문장 가운데 가장 긴 것, 조각은 max개까지). */
export function recordTiles(text: string, max = 7) {
  const sentences = (text.match(/[^.!?]+[.!?]?/g) ?? []).map((line) => line.trim()).filter(Boolean);
  const words = (line: string) => line.split(/\s+/).filter(Boolean);
  let pick = sentences[0] ?? "", best = -1;
  for (const line of sentences) {
    const n = words(line).length;
    if (n >= 4 && n <= 10 && n > best) { best = n; pick = line; }
  }
  const tiles = words(pick);
  // 조각이 많으면 붙였을 때 가장 짧은 이웃끼리 붙인다
  while (tiles.length > max) {
    let at = 0, len = Infinity;
    for (let i = 0; i < tiles.length - 1; i++) {
      const l = tiles[i].length + tiles[i + 1].length;
      if (l < len) { len = l; at = i; }
    }
    tiles.splice(at, 2, `${tiles[at]} ${tiles[at + 1]}`);
  }
  return tiles;
}

/** 늘 같은 순서로 섞는다(처음 순서 그대로는 내지 않는다). */
export function shuffledOrder(n: number, seed = 7) {
  const order = Array.from({ length: n }, (_, i) => i);
  let x = Math.max(1, Math.floor(seed)) % 2147483647;
  for (let i = n - 1; i > 0; i--) {
    x = (x * 16807) % 2147483647;
    const j = x % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n > 1 && order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}
