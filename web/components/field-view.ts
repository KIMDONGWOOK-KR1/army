// 필드 카메라와 안개: 지도 앱처럼 멀리 당길수록 위에서 내려다보고, 안개는 카메라에서 캐릭터까지
// 거리(d)에 맞춰 옮겨 캐릭터 둘레 지도는 늘 또렷하게 둔다(지평선 쪽만 흐려진다).
export const VIEW = {
  defaultPolar: 1.15, // 처음(과 거점이 바뀔 때) 카메라 극각(rad)
  minPolar: 0.35,
  // 최대 극각: 카메라 거리 near→far(m)에서 high→low(rad)로 줄인다
  polar: { near: 90, far: 200, high: 1.25, low: 0.85 },
  fog: { near: 90, far: 520 }, // 안개 시작·끝 = d + 이 값(m)
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 카메라 거리 d(m)에서 허용하는 최대 극각(rad)
export function maxPolarFor(d: number) {
  const p = VIEW.polar;
  return p.high + (p.low - p.high) * smooth(p.near, p.far, d);
}

// 카메라 거리 d(m)에서 안개 시작·끝(m)
export const fogFor = (d: number) => ({
  near: d + VIEW.fog.near,
  far: d + VIEW.fog.far,
});
