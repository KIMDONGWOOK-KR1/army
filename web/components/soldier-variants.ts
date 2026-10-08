// 같은 C02 장병 모형 넷을 사람마다 조금씩 다르게 보이게 하는 값. three 없이 숫자만 다뤄 단위 시험으로 본다.
//
// 값은 참가자 식별자(멤버 id, 없으면 호출명)에서 늘 같게 나온다: 네 사람의 폰이 같은 동료를
// 같은 모습으로 본다. 얼굴 모형은 건드리지 않고 피부 무늬의 색만 살짝 바꾸며, 키·몸집은 ±4% 안,
// 둥근 안경은 일부만 쓴다. 서기 동작의 시작 시점과 빠르기를 어긋나게 해 넷이 똑같이 숨 쉬지 않게 한다.

export type SoldierVariant = {
  skin: number; // SKIN_TONES 차례
  height: number; // 키 배율(0.96~1.04)
  width: number; // 어깨·몸통 너비 배율(0.96~1.04)
  glasses: boolean; // 둥근 안경
  phase: number; // 서기 동작 시작 시점(초, 0~4)
  pace: number; // 서기 동작 빠르기(0.9~1.08)
};

// 모형 피부 무늬(밝은 살구색)를 바꿀 목표 색(sRGB). 첫째가 모형 그대로다.
// 자연스러운 범위 안에서 밝은 살구·본디·조금 그을린·짙게 그을린 넷만 쓴다.
export const SKIN_BASE = "#fab484";
export const SKIN_TONES = ["#fab484", "#fcc29a", "#e69e6e", "#cd875c"] as const;

export const VARIANT_RANGE = {
  scale: 0.04, // 키·너비는 1 ± 이 값 안
  glasses: 0.3, // 안경을 쓰는 비율
  phase: 4, // 서기 동작 시작 시점 범위(초)
  pace: [0.9, 1.08] as const,
};

// 문자열 → 32비트 정수(FNV-1a). 같은 문자열은 어느 기기에서나 같은 값이다.
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 작은 결정적 난수열(mulberry32): 같은 씨앗이면 같은 수열
function stream(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function soldierVariant(seed: string): SoldierVariant {
  const next = stream(hash32(`hoguk-soldier:${seed}`));
  const r = VARIANT_RANGE;
  const skin = Math.min(
    SKIN_TONES.length - 1,
    Math.floor(next() * SKIN_TONES.length),
  );
  const height = 1 - r.scale + next() * 2 * r.scale;
  // 너비는 키와 반쯤 따로 움직인다(키 큰 사람이 늘 마르거나 늘 넓지 않게)
  const width = 1 - r.scale + (0.5 * (height - 1 + r.scale) + next() * r.scale);
  const glasses = next() < r.glasses;
  const phase = next() * r.phase;
  const pace = r.pace[0] + next() * (r.pace[1] - r.pace[0]);
  return {
    skin,
    height: round4(height),
    width: round4(Math.min(1 + r.scale, Math.max(1 - r.scale, width))),
    glasses,
    phase: round4(phase),
    pace: round4(pace),
  };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

// 첫 화면 네 장병: 보직마다 고정된 모습(피부색이 넷 다 다르고 한 사람만 안경을 쓴다)
export const HOME_VARIANTS = {
  commander: {
    skin: 0,
    height: 1.03,
    width: 1.0,
    glasses: false,
    phase: 0.4,
    pace: 0.95,
  },
  scout: {
    skin: 2,
    height: 0.98,
    width: 0.97,
    glasses: false,
    phase: 1.6,
    pace: 1.02,
  },
  signal: {
    skin: 3,
    height: 1.0,
    width: 1.04,
    glasses: false,
    phase: 2.7,
    pace: 0.92,
  },
  cipher: {
    skin: 1,
    height: 0.97,
    width: 0.98,
    glasses: true,
    phase: 3.5,
    pace: 1.06,
  },
} as const satisfies Record<string, SoldierVariant>;
