// 필드 카메라와 안개: 지도 앱처럼 멀리 당길수록 위에서 내려다보고, 안개는 카메라에서 캐릭터까지
// 거리(d)에 맞춰 옮겨 캐릭터 둘레 지도는 늘 또렷하게 둔다(지평선 쪽만 흐려진다).
export const VIEW = {
  defaultPolar: 1.15, // 처음(과 거점이 바뀔 때) 카메라 극각(rad)
  minPolar: 0.35,
  // 확대·축소 범위(m): 멀리 빼면 정문~봉지 시연 길(약 600m)이 한 화면에 들어온다(hh 2026-10-29)
  minDistance: 30,
  maxDistance: 900,
  panLimit: 1200, // 지도를 끌어 옮길 수 있는 범위(지도 원점에서 m)
  beyond: 1000, // 보는 곳 너머로 그릴 거리(m)
  // 최대 극각: 카메라 거리 near→far(m)에서 high→low(rad)로 줄이고,
  // 더 멀리(far→top)는 top까지 더 세워 캠퍼스 전체를 위에서 내려다보는 지도처럼 본다
  polar: { near: 90, far: 200, high: 1.25, low: 0.85, top: 0.6, topAt: 600 },
  fog: { near: 90, far: 520 }, // 안개 시작·끝 = d + 이 값(m)
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 카메라 거리 d(m)에서 허용하는 최대 극각(rad)
export function maxPolarFor(d: number) {
  const p = VIEW.polar;
  return p.high + (p.low - p.high) * smooth(p.near, p.far, d) + (p.top - p.low) * smooth(p.far, p.topAt, d);
}

// 카메라 거리 d(m)에서 안개 시작·끝(m)
export const fogFor = (d: number) => ({
  near: d + VIEW.fog.near,
  far: d + VIEW.fog.far,
});
