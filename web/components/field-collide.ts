// 캐릭터가 벽을 통과하지 않게(hh 2026-10-28 현장 플레이).
// 원인: 시연 걷기는 길(legs)을 따라가 건물·모형 밖에 있지만, 현장 GPS 이동은 마지막 위치를 향해 일직선으로 따라가서
// GPS가 건물 쪽으로 튀거나 두 위치 사이가 건물을 가로지르면 건물·모형(용봉관 등)·추모의 벽 고리를 그대로 지나갔다.
// 고침: 화면에 그린 것과 같은 모양으로 장애물을 만든다(OSM 건물 바닥, 모형을 맞춘 상자, 추모의 벽 돌벽 호, 표지석·용봉탑 받침).
// 캐릭터는 반지름 CHAR_R인 원으로 보고, 한 번에 STEP_M보다 크게 움직이지 않게 잘게 나눠 매번 밀어낸다
// (빠른 이동·낮은 프레임에도 벽을 건너뛰지 않음). 밀어내면 벽을 따라 미끄러지고, 막혀서 거의 못 움직이면 제자리에 선다(떨림 없음).
// 정문 모형은 막힌 덩어리(기둥·탑·살 담장·세로 살·글자 벽·분리대)만 넣어 사람 통로·두 차로·양 끝 바깥은 지나가고,
// 추모의 벽은 열린 쪽으로 들어간다. 판정에 쓰는 실제 GPS 위치·거리는 바꾸지 않는다.
import type { MapData } from "./field-geom";

type XZ = { x: number; z: number };
type Poly = { p: number[]; x0: number; x1: number; z0: number; z1: number };
type Capsule = { ax: number; az: number; bx: number; bz: number; r: number };
type Circle = { x: number; z: number; r: number };

export const CHAR_R = 0.5; // 캐릭터 몸 반지름(m)
export const STEP_M = 0.25; // 한 번에 움직이는 최대 거리(m)
const BLOCKED_M = 0.02; // 한 프레임에 이보다 덜 움직였으면 막힌 것으로 보고 제자리

// 정문 모형(public/models/gate.glb)의 몸 높이(0.4~2.6m) 단면, 모형 좌표(m, +z가 바깥).
// field-map이 1.65배로, 바깥이 용봉탑 반대쪽을 보게 세운다. 서쪽 바깥 기둥~살 담장~탑 / 가운데 분리대 화분 /
// 동쪽 안 돌기둥(접힌 회색 살문) / 동쪽 세로 살~'전남대학교' 글자 벽. 실제 정문처럼 돌기둥과 세로 살 사이가
// 사람·자전거 통로(모형 x 5.7~8.7, 지도 약 5m)이고, 시연 길(보도)이 그 가운데를 지난다(hh 2026-10-29 사진).
// 두 차로와 양 끝 바깥도 지나간다.
const GATE = {
  scale: 1.65,
  blocks: [
    { x0: -9.5, x1: -4.25, z0: -0.75, z1: 0.75 },
    { x0: -0.5, x1: 0.5, z0: -2, z1: 1.5 },
    { x0: 4.45, x1: 5.7, z0: -0.7, z1: 0.7 },
    { x0: 8.7, x1: 12.2, z0: -0.9, z1: 0.9 },
  ],
};
// 추모의 벽 모형(field-landmarks MEMORIAL_WALL)을 field-map이 두 배로, 열린 쪽이 용봉관을 보게 세운다
const WALL = { r: 7, t: 0.4, from: -1.75, to: 1.75, n: 14, scale: 2 };

function boundsOf(p: number[]): Poly {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]);
  }
  return { p, x0, x1, z0, z1 };
}

function inside(p: number[], x: number, z: number) {
  let hit = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function closestOnSegment(ax: number, az: number, bx: number, bz: number, x: number, z: number): XZ {
  const ex = bx - ax, ez = bz - az, len = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len));
  return { x: ax + ex * t, z: az + ez * t };
}

/** 모형을 맞춘 상자(three.js rotation.y = a)의 네 모서리 */
export function boxPolygon(b: { c: [number, number]; w: number; d: number; a: number }) {
  const ca = Math.cos(b.a), sa = Math.sin(b.a), out: number[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = (sx * b.w) / 2, lz = (sz * b.d) / 2;
    out.push(b.c[0] + lx * ca + lz * sa, b.c[1] - lx * sa + lz * ca);
  }
  return out;
}

/** 추모의 벽 돌벽 호를 이루는 토막(월드 좌표) */
export function memorialWallSegments(wall: [number, number], hall?: [number, number]) {
  const ry = hall ? Math.atan2(hall[0] - wall[0], hall[1] - wall[1]) : 0;
  const c = Math.cos(ry), s = Math.sin(ry), pts: XZ[] = [];
  for (let i = 0; i <= WALL.n; i++) {
    const a = WALL.from + (i / WALL.n) * (WALL.to - WALL.from);
    const lx = Math.sin(a) * WALL.r * WALL.scale, lz = -Math.cos(a) * WALL.r * WALL.scale;
    pts.push({ x: wall[0] + lx * c + lz * s, z: wall[1] - lx * s + lz * c });
  }
  return pts;
}

/** 정문 모형의 막힌 덩어리(월드 좌표 다각형) */
export function gateBlocks(gate: [number, number], tower: [number, number]) {
  const a = Math.atan2(tower[0] - gate[0], tower[1] - gate[1]) + Math.PI, s = GATE.scale,
    ca = Math.cos(a), sa = Math.sin(a);
  return GATE.blocks.map((b) => {
    const lx = ((b.x0 + b.x1) / 2) * s, lz = ((b.z0 + b.z1) / 2) * s;
    return boxPolygon({ c: [gate[0] + lx * ca + lz * sa, gate[1] - lx * sa + lz * ca], w: (b.x1 - b.x0) * s, d: (b.z1 - b.z0) * s, a });
  });
}

export type Collider = {
  /** 몸이 장애물과 겹치면 겹치지 않는 가장 가까운 자리, 아니면 null */
  resolve(x: number, z: number): XZ | null;
};

export function buildCollider(shapes: { polys?: number[][]; capsules?: Capsule[]; circles?: Circle[] }, r = CHAR_R): Collider {
  const polys = (shapes.polys ?? []).filter((p) => p.length >= 6).map(boundsOf);
  const capsules = shapes.capsules ?? [], circles = shapes.circles ?? [];
  const EPS = 1e-6;
  // 몸(반지름 r)과 겹치는 장애물마다, 그 장애물에서 가장 가까이 빠져나가는 자리
  const exits = (x: number, z: number): XZ[] => {
    const out: XZ[] = [];
    for (const b of polys) {
      if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
      const isIn = inside(b.p, x, z);
      let best = Infinity, q: XZ = { x, z };
      for (let i = 0, j = b.p.length - 2; i < b.p.length; j = i, i += 2) {
        const c = closestOnSegment(b.p[j], b.p[j + 1], b.p[i], b.p[i + 1], x, z);
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < best) { best = d; q = c; }
      }
      const d = Math.sqrt(best);
      if (!isIn && d >= r - EPS) continue;
      // 안이면 벽 너머로, 밖인데 너무 붙었으면 벽에서 r만큼 떨어지게
      const nx = d > EPS ? (isIn ? q.x - x : x - q.x) / d : 1, nz = d > EPS ? (isIn ? q.z - z : z - q.z) / d : 0;
      out.push({ x: q.x + nx * (r + 1e-3), z: q.z + nz * (r + 1e-3) });
    }
    for (const w of capsules) {
      const c = closestOnSegment(w.ax, w.az, w.bx, w.bz, x, z), R = w.r + r;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d >= R - EPS) continue;
      const nx = d > EPS ? (x - c.x) / d : 1, nz = d > EPS ? (z - c.z) / d : 0;
      out.push({ x: c.x + nx * (R + 1e-3), z: c.z + nz * (R + 1e-3) });
    }
    for (const o of circles) {
      const R = o.r + r, d = Math.hypot(x - o.x, z - o.z);
      if (d >= R - EPS) continue;
      const nx = d > EPS ? (x - o.x) / d : 1, nz = d > EPS ? (z - o.z) / d : 0;
      out.push({ x: o.x + nx * (R + 1e-3), z: o.z + nz * (R + 1e-3) });
    }
    return out;
  };
  const free = (p: XZ) => exits(p.x, p.z).length === 0;
  return {
    resolve(x, z) {
      const first = exits(x, z);
      if (!first.length) return null;
      // 가장 가까운 출구부터, 다른 장애물과도 겹치지 않는 자리를 고른다(붙은 건물·모형 상자가 겹쳐도)
      const dist = (p: XZ) => Math.hypot(p.x - x, p.z - z);
      for (const p of first.sort((a, b) => dist(a) - dist(b))) if (free(p)) return p;
      for (const p of first) {
        const again = exits(p.x, p.z).sort((a, b) => dist(a) - dist(b));
        for (const q of again) if (free(q)) return q;
      }
      // 그래도 막히면 둘레를 넓혀 가며 가장 가까운 빈자리
      for (const R of [1, 2, 3, 5, 8, 12, 18, 25, 35, 50, 70])
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2, p = { x: x + Math.cos(a) * R, z: z + Math.sin(a) * R };
          if (free(p)) return p;
        }
      return first[0];
    },
  };
}

/** 캠퍼스 지도에 그린 것과 같은 장애물 */
export function campusCollider(map: Pick<MapData, "buildings" | "boxes" | "anchors">): Collider {
  const A = map.anchors;
  const polys = [
    ...map.buildings.map((b) => b.p),
    // 블렌더·코드 모형은 OSM 바닥보다 크게 서기도 해서, 모형을 맞춘 상자도 함께 막는다
    ...Object.values(map.boxes).map(boxPolygon),
    ...(A.gate && A.tower ? gateBlocks(A.gate, A.tower) : []),
  ];
  const capsules: Capsule[] = [];
  if (A.wall) {
    const pts = memorialWallSegments(A.wall, A.hall);
    for (let i = 1; i < pts.length; i++)
      capsules.push({ ax: pts[i - 1].x, az: pts[i - 1].z, bx: pts[i].x, bz: pts[i].z, r: WALL.t * WALL.scale / 2 });
  }
  const circles: Circle[] = [];
  // 5·18 표지석(둥근 돌판과 받침)과 용봉탑 로터리 섬
  if (A.stone) circles.push({ x: A.stone[0], z: A.stone[1], r: 1.6 });
  if (A.tower) circles.push({ x: A.tower[0], z: A.tower[1], r: 6.2 });
  return buildCollider({ polys, capsules, circles });
}

/** from에서 to로 움직이되, 잘게 나눠 매번 장애물 밖으로 밀어낸다. 막혀서 거의 못 움직이면 from 그대로 */
export function moveWithin(col: Collider, from: XZ, to: XZ, step = STEP_M): XZ & { blocked: boolean } {
  const dx = to.x - from.x, dz = to.z - from.z, dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(dist / step));
  let x = from.x, z = from.z;
  for (let i = 0; i < n; i++) {
    x += dx / n; z += dz / n;
    const r = col.resolve(x, z);
    if (r) { x = r.x; z = r.z; }
  }
  const blocked = dist > 0 && Math.hypot(x - from.x, z - from.z) < BLOCKED_M;
  return blocked ? { x: from.x, z: from.z, blocked } : { x, z, blocked: false };
}
