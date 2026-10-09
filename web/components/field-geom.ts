import * as THREE from "three";
import type { FieldAssets } from "./field-assets";

// 입체 필드가 함께 쓰는 지도 자료 모양과 순수 기하 도구. 장면에 아무것도 넣지 않는다.
// 좌표는 정문 기준 미터, x 동쪽, z 남쪽이다. 지도 자료는 scripts/build-map.mjs가 굽는다.

// 건물 한 채. t·lv·hs는 굽기에서 붙이는 선택 값이다.
export type MapBuilding = {
  id: string; // OSM id(w…/r…)
  p: number[]; // 바깥 윤곽 [x0, z0, x1, z1, …]
  h: number; // 높이(m): 설정의 근거 값 → height 태그 → 층수 × 3.4 + 1 → 면적 기본값
  name?: string;
  holes?: number[][];
  t?: string; // OSM building 값(yes, university, commercial, house, …)
  lv?: number; // 지상 층수(태그 또는 설정)
  hs?: 1; // 1이면 h가 태그·설정 근거, 없으면 면적으로 짐작한 값
};
// 거리 소품 자리. a는 모형의 +z가 볼 방향(y축 회전, 라디안):
// crossing은 차도 진행 방향, entrance는 벽 바깥, 나머지는 가장 가까운 길(정류장은 차도) 쪽.
export type PoiKind =
  | "bench"
  | "bicycle_parking"
  | "shelter"
  | "bus_stop"
  | "waste_basket"
  | "entrance"
  | "crossing";
export type MapPoi = { k: PoiKind; x: number; z: number; a: number };
// 건물 윤곽에 맞춘 회전 상자(모형 맞춤용): 가운데 c, 가로 w, 깊이 d, 정면 회전 a
export type MapBox = { c: [number, number]; w: number; d: number; a: number };
export type MapRoad = { k: number; w: number; p: number[] }; // k 0 차도, 1 서비스 길, 2 보행로

export type MapData = {
  credit: string;
  license?: string;
  origin: { lat: number; lng: number };
  anchors: Record<string, [number, number]>;
  // hall(용봉관)과, 굽기 설정에 있으면 jungbomaru·minjumaru·library·hq
  boxes: Record<string, MapBox>;
  legs: number[][];
  rows: number[];
  buildings: MapBuilding[];
  roads: MapRoad[];
  // k: wood | grass | parking | track | pitch | plaza | water | flower(화단)
  areas: { k: string; p: number[]; holes?: number[][]; surface?: string }[];
  streams: { w: number; p: number[] }[];
  trees: number[];
  pois?: MapPoi[];
};

// 건물 정면(현관 자리)과 현관 모형의 +z가 벽 밖을 보게 하는 y축 회전
export type Front = { x: number; z: number; ry: number };

// 캐릭터 자리(x, z)와 카메라에 맞춰 매 프레임 가까이·멀리 모형을 고르는 함수
export type Updater = (x: number, z: number, camera?: THREE.Camera) => void;

// 지도 부품(건물·소품)을 만들 때 함께 넘기는 것
export type FieldCtx = {
  assets?: FieldAssets | null;
  // 나무를 심지 못하는 칸(건물·길·물·운동장). 소품 자리를 고를 때도 본다.
  occ: Occupancy;
  // 폰 화면이면 세계 재질을 Lambert로 만든다(field-clay worldMaterial)
  phone?: boolean;
};

// 가까이는 자세한 모형, 멀리는 줄인 모형으로 바꿔 그리는 인스턴스 묶음(나무·소품)
export interface LodInstancer<K> {
  add(kind: K, m: THREE.Matrix4, color: THREE.Color): void;
  build(parent: THREE.Object3D): Updater;
}

export const ring = (p: number[]) => {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2)
    v.push(new THREE.Vector2(p[i], p[i + 1]));
  return v;
};
export const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// 평평한 다각형(구멍 포함)을 높이 y의 바닥판으로 만든다. 모든 삼각형이 위를 보게 맞춘다.
export function flatPolygon(p: number[], holes: number[][] = [], y: number) {
  const outer = ring(p),
    inner = holes.map(ring),
    tris = THREE.ShapeUtils.triangulateShape(outer, inner),
    all = [...outer, ...inner.flat()],
    pos = new Float32Array(tris.length * 9),
    nor = new Float32Array(tris.length * 9);
  tris.forEach(([i0, i1, i2], i) => {
    const a = all[i0];
    let b = all[i1],
      c = all[i2];
    // 법선의 y = (bz-az)(cx-ax) - (bx-ax)(cz-az) 가 양수여야 위를 본다
    if ((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) < 0)
      [b, c] = [c, b];
    pos.set([a.x, y, a.y, b.x, y, b.y, c.x, y, c.y], i * 9);
  });
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}

// 꺾은선을 너비 w의 띠로 만들고 꺾이는 곳과 끝은 둥글게 메운다
export function ribbon(p: number[], w: number, y: number) {
  const pos: number[] = [],
    h = w / 2,
    seg = w >= 5 ? 8 : 5;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2],
      az = p[i - 1],
      bx = p[i],
      bz = p[i + 1],
      L = Math.hypot(bx - ax, bz - az) || 1,
      nx = (-(bz - az) / L) * h,
      nz = ((bx - ax) / L) * h;
    pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, ax - nx, y, az - nz);
    pos.push(ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
  }
  for (let i = 0; i < p.length; i += 2) {
    // 거의 곧게 이어지는 곳은 메울 필요가 없다
    if (i > 0 && i < p.length - 2) {
      const ux = p[i] - p[i - 2],
        uz = p[i + 1] - p[i - 1],
        vx = p[i + 2] - p[i],
        vz = p[i + 3] - p[i + 1],
        cos =
          (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
      if (cos > 0.99) continue;
    }
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2,
        a1 = ((k + 1) / seg) * Math.PI * 2;
      pos.push(
        p[i],
        y,
        p[i + 1],
        p[i] + Math.cos(a1) * h,
        y,
        p[i + 1] + Math.sin(a1) * h,
        p[i] + Math.cos(a0) * h,
        y,
        p[i + 1] + Math.sin(a0) * h,
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // 띠는 모두 위를 본다
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  return g;
}

// 점이 다각형 안에 있는지(짝홀 규칙)
export function insidePoly(p: number[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i],
      zi = p[i + 1],
      xj = p[j],
      zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

// 나무를 심지 못하는 칸(건물·길·물·운동장)을 5m 격자로 표시한다
export class Occupancy {
  cells: Uint8Array;
  constructor(
    public x0: number,
    public z0: number,
    public n: number,
    public size = 5,
  ) {
    this.cells = new Uint8Array(n * n);
  }
  idx(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.size),
      j = Math.floor((z - this.z0) / this.size);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  blocked(x: number, z: number) {
    const k = this.idx(x, z);
    return k < 0 || this.cells[k] === 1;
  }
  mark(x: number, z: number) {
    const k = this.idx(x, z);
    if (k >= 0) this.cells[k] = 1;
  }
  circle(x: number, z: number, r: number) {
    for (let dz = -r; dz <= r; dz += this.size / 2)
      for (let dx = -r; dx <= r; dx += this.size / 2)
        if (dx * dx + dz * dz <= r * r) this.mark(x + dx, z + dz);
  }
  polygon(p: number[], pad = 0) {
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]);
      maxX = Math.max(maxX, p[i]);
      minZ = Math.min(minZ, p[i + 1]);
      maxZ = Math.max(maxZ, p[i + 1]);
    }
    for (let z = minZ - pad; z <= maxZ + pad; z += this.size / 2)
      for (let x = minX - pad; x <= maxX + pad; x += this.size / 2)
        if (insidePoly(p, x, z)) this.mark(x, z);
  }
  line(p: number[], w: number) {
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2],
        az = p[i - 1],
        L = Math.hypot(p[i] - ax, p[i + 1] - az) || 1;
      for (let s = 0; s <= L; s += this.size / 2)
        for (let o = -w / 2; o <= w / 2; o += this.size / 2)
          this.mark(
            ax + ((p[i] - ax) * s) / L + (-(p[i + 1] - az) / L) * o,
            az + ((p[i + 1] - az) * s) / L + ((p[i] - ax) / L) * o,
          );
    }
  }
}

// 길마다 한 번만 재 두는 테두리 상자 [minX, minZ, maxX, maxZ]
const roadBox = new WeakMap<MapRoad, [number, number, number, number]>();
function boxOf(r: MapRoad) {
  let b = roadBox.get(r);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < r.p.length; i += 2) {
      b[0] = Math.min(b[0], r.p[i]);
      b[1] = Math.min(b[1], r.p[i + 1]);
      b[2] = Math.max(b[2], r.p[i]);
      b[3] = Math.max(b[3], r.p[i + 1]);
    }
    roadBox.set(r, b);
  }
  return b;
}
// 점(x, z)에서 길들 위 가장 가까운 지점까지의 거리와 그 지점
function nearestRoadPoint(roads: readonly MapRoad[], x: number, z: number) {
  let d = Infinity,
    qx = x,
    qz = z;
  for (const r of roads)
    for (let i = 2; i < r.p.length; i += 2) {
      const ax = r.p[i - 2],
        az = r.p[i - 1],
        dx = r.p[i] - ax,
        dz = r.p[i + 1] - az,
        L2 = dx * dx + dz * dz,
        t =
          L2 > 0
            ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
            : 0,
        px = ax + dx * t,
        pz = az + dz * t,
        e = Math.hypot(px - x, pz - z);
      if (e < d) {
        d = e;
        qx = px;
        qz = pz;
      }
    }
  return { d, qx, qz };
}

// 건물의 정면: 가장 가까운 보행로(k 2)를 바라보는 벽의 가운데. reach(m) 안에 보행로가 없으면
// 다른 길을, 길이 하나도 없으면 가장 긴 벽을 쓴다. ry는 현관 모형의 +z가 벽 밖을 보게 하는 회전.
// 고리 방향(시계·반시계)과 관계없이 같은 답을 낸다.
export function frontOf(
  b: { p: number[] },
  roads: readonly MapRoad[],
  reach = 80,
): Front {
  const p = b.p,
    n = p.length / 2;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minZ = Math.min(minZ, p[i + 1]);
    maxZ = Math.max(maxZ, p[i + 1]);
  }
  const near = (r: MapRoad) => {
    const [x0, z0, x1, z1] = boxOf(r);
    return (
      x1 >= minX - reach &&
      x0 <= maxX + reach &&
      z1 >= minZ - reach &&
      z0 <= maxZ + reach
    );
  };
  const close = roads.filter(near),
    foot = close.filter((r) => r.k === 2),
    target = foot.length ? foot : close;

  // 벽마다 가운데·바깥 법선·길이
  const edges: { x: number; z: number; nx: number; nz: number; L: number }[] =
    [];
  let longest = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      ax = p[i * 2],
      az = p[i * 2 + 1],
      bx = p[j * 2],
      bz = p[j * 2 + 1],
      L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const x = (ax + bx) / 2,
      z = (az + bz) / 2;
    let nx = (bz - az) / L,
      nz = -(bx - ax) / L;
    // 법선 쪽으로 조금 나간 점이 건물 안이면 반대쪽이 바깥이다
    if (insidePoly(p, x + nx * 0.25, z + nz * 0.25)) {
      nx = -nx;
      nz = -nz;
    }
    edges.push({ x, z, nx, nz, L });
    longest = Math.max(longest, L);
  }
  if (!edges.length) return { x: p[0] ?? 0, z: p[1] ?? 0, ry: 0 };

  const minLen = Math.min(3, longest * 0.5);
  let best = null as (typeof edges)[number] | null,
    bestD = Infinity;
  if (target.length)
    for (const e of edges) {
      if (e.L < minLen) continue;
      const q = nearestRoadPoint(target, e.x, e.z);
      // 길이 벽 앞쪽(바깥)에 있어야 그 길을 보는 벽이다. 벽에 붙은 길은 앞쪽으로 친다.
      const facing =
        q.d < 0.5 ? 1 : (e.nx * (q.qx - e.x) + e.nz * (q.qz - e.z)) / q.d;
      if (facing < 0.2) continue;
      if (q.d < bestD - 1e-6 || (Math.abs(q.d - bestD) <= 1e-6 && best && e.L > best.L)) {
        bestD = q.d;
        best = e;
      }
    }
  if (!best)
    for (const e of edges) if (!best || e.L > best.L + 1e-6) best = e;
  const e = best!;
  return { x: e.x, z: e.z, ry: Math.atan2(e.nx, e.nz) };
}
