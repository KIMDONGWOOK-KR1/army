import { insidePoly, type MapData } from "./field-geom";
import { MEMORIAL_AT } from "./field-calm";

// 랜드마크 둘레 손질(소품 키트로 세운다): 용봉관 앞 잔디의 원뿔꼴 나무 줄, 민주마루 앞 계단 아래
// 디딤돌과 다듬은 소나무, 혁명정신 계승비. 자리만 여기서 셈하고(시험할 수 있게 three 없이),
// 놓기는 field-props.ts가 다른 소품과 같은 빈자리 규칙으로 한다.
// 근거: hh가 2026-10-07에 준 항공·현장 사진(저장소에 넣지 않음)과 지도 맞춤 상자(boxes).

// out: 자리가 막혔을 때 비켜 볼 바깥 방향(단위 벡터)
export type Spot = { x: number; z: number; ry: number; out?: [number, number] };

// 지도 맞춤 상자 틀(가로 s, 앞 f)과 세계 좌표 사이. 상자 앞(+z)은 세계 (sin a, cos a).
function boxFrame(b: { c: [number, number]; a: number }) {
  const fx = Math.sin(b.a),
    fz = Math.cos(b.a),
    rx = Math.cos(b.a),
    rz = -Math.sin(b.a);
  return {
    toLocal: (x: number, z: number) => {
      const dx = x - b.c[0],
        dz = z - b.c[1];
      return { s: dx * rx + dz * rz, f: dx * fx + dz * fz };
    },
    toWorld: (s: number, f: number) => ({
      x: b.c[0] + rx * s + fx * f,
      z: b.c[1] + rz * s + fz * f,
    }),
  };
}

// 용봉관 앞 잔디 남쪽(정면 쪽) 가장자리에서 4m 안쪽에 원뿔꼴로 다듬은 나무 7그루를 고르게 세운다.
export const HALL_TOPIARY = { n: 7, inset: 4, margin: 3, h: 6.5, r: 1.6 };
export function hallTopiaries(data: MapData): Spot[] {
  const b = data.boxes.hall;
  if (!b) return [];
  const F = boxFrame(b),
    probe = F.toWorld(0, b.d / 2 + 6);
  const lawn = data.areas.find(
    (a) => a.k === "grass" && insidePoly(a.p, probe.x, probe.z),
  );
  if (!lawn) return [];
  const pts: { s: number; f: number }[] = [];
  for (let i = 0; i < lawn.p.length; i += 2) pts.push(F.toLocal(lawn.p[i], lawn.p[i + 1]));
  const fMax = Math.max(...pts.map((p) => p.f));
  // 가장 앞 가장자리(앞 끝에서 3m 안 꼭짓점)의 가로 범위
  const edge = pts.filter((p) => p.f > fMax - 3).map((p) => p.s);
  const s0 = Math.min(...edge) + HALL_TOPIARY.margin,
    s1 = Math.max(...edge) - HALL_TOPIARY.margin,
    f = fMax - HALL_TOPIARY.inset,
    out: Spot[] = [];
  if (!(s1 > s0)) return [];
  for (let i = 0; i < HALL_TOPIARY.n; i++) {
    const p = F.toWorld(s0 + ((s1 - s0) * i) / (HALL_TOPIARY.n - 1), f);
    if (insidePoly(lawn.p, p.x, p.z)) out.push({ ...p, ry: b.a });
  }
  return out;
}

// 민주마루 앞 계단 발치(건물 틀 u 0.25, v 27.6, 건물은 상자 안에서 39.9° 돌아 있다)에서
// 바깥으로 디딤돌 7장(2.6 × 0.8, 틈 1.1m)을 깔고, 그 양옆 4.6m에 다듬은 소나무를 4그루씩 세운다.
// 블렌더 모형(minjumaru.py)과 같은 틀이다.
export const MINJU = {
  u: 0.25,
  v: 27.6,
  th: (39.9 * Math.PI) / 180,
  slabs: 7,
  slab: { w: 2.6, d: 0.8, h: 0.15, gap: 1.1 },
  pines: 4,
  pineSide: 4.6,
  pinePitch: 3.6,
};
export function minjumaruDressing(data: MapData): { slabs: Spot[]; pines: Spot[] } {
  const b = data.boxes.minjumaru;
  if (!b) return { slabs: [], pines: [] };
  const F = boxFrame(b),
    c = Math.cos(MINJU.th),
    s = Math.sin(MINJU.th);
  // 건물 틀(u, v) → 상자 틀(가로 X, 앞 Z) → 세계
  const at = (u: number, v: number) => F.toWorld(u * c - v * s, u * s + v * c);
  const ry = b.a - MINJU.th; // 디딤돌 +z가 계단 바깥 쪽을 본다
  const { d, gap } = MINJU.slab,
    pitch = d + gap,
    slabs: Spot[] = [],
    pines: Spot[] = [];
  for (let i = 0; i < MINJU.slabs; i++)
    slabs.push({ ...at(MINJU.u, MINJU.v + gap + d / 2 + i * pitch), ry });
  // 계단 축의 가로 방향(세계): 막히면(옆 보행로 등) 이쪽으로 비켜 선다
  const ax = Math.cos(ry),
    az = -Math.sin(ry);
  for (let k = 0; k < MINJU.pines; k++)
    for (const sd of [-1, 1])
      pines.push({
        ...at(MINJU.u + sd * MINJU.pineSide, MINJU.v + 2.2 + k * MINJU.pinePitch),
        ry: ry + k * 1.3 + (sd > 0 ? 0.6 : 0),
        out: [ax * sd, az * sd],
      });
  return { slabs, pines };
}

// 혁명정신 계승비(OSM historic=memorial): 정문 쪽을 본다
export function relicStone(data: MapData): Spot {
  const g = data.anchors.gate ?? [0, 0];
  return {
    ...MEMORIAL_AT,
    ry: Math.atan2(g[0] - MEMORIAL_AT.x, g[1] - MEMORIAL_AT.z),
  };
}
