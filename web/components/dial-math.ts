// 통신원 주파수 다이얼의 계산. 화면과 떨어진 순수 함수라 단위 시험으로 확인한다.
// 값은 0.1 MHz 단위 정수(tenths)로 다뤄 소수 오차 없이 멈춤 칸에 맞춘다.
// 정답 주파수는 서버에만 있다. 여기의 어떤 계산도 정답을 알지 못한다.

/** 한 바퀴에 5 MHz를 돈다. 멈춤 칸은 0.1 MHz라 한 바퀴에 50칸, 한 칸 7.2도. */
export const MHZ_PER_TURN = 5;
export const DETENTS_PER_TURN = MHZ_PER_TURN * 10;
export const DEG_PER_DETENT = 360 / DETENTS_PER_TURN;
/** PageUp/PageDown 한 번에 움직이는 칸(1 MHz). */
export const PAGE_DETENTS = 10;
/** 마우스 휠 한 눈금(약 100px)에 한 칸. */
export const WHEEL_PX_PER_DETENT = 100;

export const toTenths = (mhz: number) => Math.round(mhz * 10);
export const formatTenths = (t: number) => (t / 10).toFixed(1);

export function clampTenths(t: number, minT: number, maxT: number) {
  return Math.min(maxT, Math.max(minT, t));
}

/** 입력 글자 → 범위 안 0.1 단위 정수. 숫자가 아니면 null. */
export function parseTenths(
  text: string,
  minT: number,
  maxT: number,
): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isFinite(n) ? clampTenths(toTenths(n), minT, maxT) : null;
}

/** 입력 중인 글자가 범위 안의 숫자일 때만 0.1 단위 정수. 아직 치는 중인 "5"나 범위 밖은 null. */
export function tenthsInRange(
  text: string,
  minT: number,
  maxT: number,
): number | null {
  if (!text.trim()) return null;
  const t = toTenths(Number(text));
  return Number.isFinite(t) && t >= minT && t <= maxT ? t : null;
}

/** 다이얼 중심에서 본 손가락 방향(도). 12시가 0, 시계 방향으로 커진다(화면 y는 아래로 +). */
export function pointerAngle(dx: number, dy: number) {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** from에서 to로 가는 가장 짧은 회전(도), -180 이상 180 미만. 12시를 지나도 튀지 않는다. */
export function angleDelta(from: number, to: number) {
  const d = (((to - from) % 360) + 540) % 360;
  return d - 180;
}

/** 최솟값에서 돈 누적 각도 ↔ 값. */
export const tenthsToAngle = (t: number, minT: number) =>
  (t - minT) * DEG_PER_DETENT;

/** 누적 각도를 가장 가까운 멈춤 칸으로 맞추고 범위 안에 둔다. */
export function angleToTenths(angle: number, minT: number, maxT: number) {
  return clampTenths(minT + Math.round(angle / DEG_PER_DETENT), minT, maxT);
}

/**
 * 손가락 한 번의 이동(delta도)을 누적 각도에 더한다. 끝에 닿으면 각도도 끝에 붙인다.
 * 그래야 끝을 지나 더 돌린 뒤 되돌릴 때 헛도는 구간 없이 곧바로 움직인다.
 */
export function turn(angle: number, delta: number, minT: number, maxT: number) {
  return Math.min(
    tenthsToAngle(maxT, minT),
    Math.max(0, angle + delta),
  );
}

/** 키보드: 화살표 ±1칸(0.1), PageUp/PageDown ±10칸(1 MHz), Home/End 끝. 다른 키는 null. */
export function keyStep(
  key: string,
  t: number,
  minT: number,
  maxT: number,
): number | null {
  const by = (n: number) => clampTenths(t + n, minT, maxT);
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return by(1);
    case "ArrowDown":
    case "ArrowLeft":
      return by(-1);
    case "PageUp":
      return by(PAGE_DETENTS);
    case "PageDown":
      return by(-PAGE_DETENTS);
    case "Home":
      return minT;
    case "End":
      return maxT;
    default:
      return null;
  }
}

/**
 * 휠 이동을 칸 수로 바꾼다. 남은 픽셀은 다음 이동에 이어 쓴다.
 * 위로 굴리면(deltaY < 0) 값이 커진다. 방향을 바꾸면 남은 픽셀을 버려 곧바로 반응한다.
 * deltaMode 1(줄)·2(쪽)는 픽셀로 환산한다.
 */
export function wheelDetents(
  rest: number,
  delta: number,
  deltaMode = 0,
): { detents: number; rest: number } {
  const px = delta * (deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1);
  const total = (Math.sign(rest) === -Math.sign(px) ? 0 : rest) + px;
  const steps = Math.trunc(total / WHEEL_PX_PER_DETENT);
  return {
    detents: steps === 0 ? 0 : -steps,
    rest: total - steps * WHEEL_PX_PER_DETENT,
  };
}

/**
 * 자동 시연용: 값을 목표까지 부드럽게 돌리는 칸 목록(처음 값 제외, 마지막은 목표).
 * 거리가 멀수록 프레임이 늘지만 12~36 사이로 둔다.
 */
export function glide(fromT: number, toT: number): number[] {
  const dist = Math.abs(toT - fromT);
  if (!dist) return [];
  const frames = Math.min(36, Math.max(12, 10 + Math.ceil(dist / 8)));
  const out: number[] = [];
  for (let i = 1; i <= frames; i++) {
    const p = i / frames,
      eased = 0.5 - Math.cos(Math.PI * p) / 2;
    const t = i === frames ? toT : Math.round(fromT + (toT - fromT) * eased);
    if (t !== (out.at(-1) ?? fromT)) out.push(t);
  }
  return out;
}

/** 띠 눈금의 숫자 간격(MHz): 범위에 맞춰 10·5·1 중 하나. */
export function bandStep(min: number, max: number) {
  const range = max - min;
  return range >= 40 ? 10 : range >= 15 ? 5 : 1;
}
