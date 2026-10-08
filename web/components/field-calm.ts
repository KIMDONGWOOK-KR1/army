import type { MapData } from "./field-geom";

// 5·18 사적지 둘레 "조용한 구역": 돌빛·크림·남색·초록·흰 꽃만 쓰고 움직이는 효과를 두지 않는다
// (결정 사항). 땅(가운데 겹줄을 크림으로), 건물(차양 강조색 없음), 소품(돌 벤치·흰 꽃),
// 거점 표석(돌지 않음)이 모두 이 목록 하나를 읽는다.

export type CalmZone = { x: number; z: number; r: number };

// 기본 반지름(m). 정문은 동쪽 '기억의 정원' 잔디까지 덮는다.
export const CALM_R = { gate: 50, stone: 15, bloom: 15, hall: 35, memorial: 12 };
// 혁명정신 계승비(OSM historic=memorial, 박관현언덕). 굽기가 기념물 점을 내보내기 전까지 박아 둔다.
export const MEMORIAL_AT = { x: -36.3, z: -51.1 };
// 거점 도착 반경(m, 코스 자료 radiusM과 같다)
export const ARRIVAL_M = 30;
// 도착 범위 바깥으로 더 덮는 여유(m): 도착해서 둘러보는 자리에도 꽃 색이 남지 않게 한다
const ARRIVAL_PAD = 15;

// 거점이 구역 안에 있으면 구역이 그 거점의 도착 범위 전체(+ 여유)를 덮게 넓힌다
export function coverArrival(
  zone: CalmZone,
  site: readonly [number, number] | undefined,
  arrivalM = ARRIVAL_M,
): CalmZone {
  if (!site) return zone;
  const d = Math.hypot(site[0] - zone.x, site[1] - zone.z);
  if (d > zone.r) return zone;
  return { ...zone, r: Math.max(zone.r, d + arrivalM + ARRIVAL_PAD) };
}

// 정문, 5.18사적비, 피어나다, 용봉관(건물 상자 가운데), 혁명정신 계승비
export function calmZones(data: MapData, arrivalM = ARRIVAL_M): CalmZone[] {
  const A = data.anchors,
    out: CalmZone[] = [];
  if (A.gate)
    out.push(
      coverArrival({ x: A.gate[0], z: A.gate[1], r: CALM_R.gate }, A.gate, arrivalM),
    );
  if (A.stone) out.push({ x: A.stone[0], z: A.stone[1], r: CALM_R.stone });
  if (A.bloom) out.push({ x: A.bloom[0], z: A.bloom[1], r: CALM_R.bloom });
  const h = data.boxes.hall;
  if (h)
    out.push(coverArrival({ x: h.c[0], z: h.c[1], r: CALM_R.hall }, A.hall, arrivalM));
  out.push({ ...MEMORIAL_AT, r: CALM_R.memorial });
  return out;
}

export const inCalm = (calm: readonly CalmZone[], x: number, z: number, pad = 0) =>
  calm.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);
