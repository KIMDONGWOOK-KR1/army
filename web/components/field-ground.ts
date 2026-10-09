import * as THREE from "three";
import {
  flatPolygon,
  type MapData,
  type MapRoad,
  type Occupancy,
  type Updater,
} from "./field-geom";
import type { CalmZone } from "./field-calm";
import { worldMaterial } from "./field-clay";
import { chainOnBeforeCompile } from "./field-occlusion";

export type { CalmZone };

// 땅·길·물. 멀리서는 포켓몬고 낮 지도(민트 바탕, 회청색 차도, 노란 테)로 깨끗하게 읽히고,
// 캐릭터 둘레(60→120m)로 들어오면 같은 땅에 풀빛이 돌고 잔점·깎은 줄무늬·마사토 알갱이·
// 보도블록 줄눈이 생기는 "캠퍼스 마을"이 된다. 무늬는 큰 그림 없이 셰이더와 코드로 만든
// 128² 값 노이즈로 그리고, 땅 전체가 한 번에 그려진다(그리기 1번 + 물 1번).
// 기준: /mnt/project-files/hoguk/design/field-style-ac-pogo.md 6장.

// 바닥 층의 높이(m). 멀리서도 겹쳐 깜빡이지 않게 층마다 띄운다. 새 층은 이 표에만 더한다.
export const LAYER = {
  wood: 0.05,
  lawn: 0.08,
  pond: 0.1,
  parking: 0.11,
  track: 0.13,
  pitch: 0.16,
  plaza: 0.18,
  rimSand: 0.2, // 마사토 길 테
  rimPave: 0.207, // 보도블록 테(연석)
  edge: 0.214, // 차도·서비스 길 노란 테
  foot: 0.24, // 보행로
  service: 0.26,
  car: 0.28,
  mark: 0.295, // 횡단보도
  blob: 0.315, // 소품·나무 블롭 그늘
  streamStone: 0.33,
  stream: 0.35,
  bedSoil: 0.5, // 돋운 화단 흙
  bedRim: 0.62, // 돋운 화단 테 윗면
} as const;

// 땅 종류(셰이더가 무늬를 고른다)
export const GK = {
  base: 0, // 바탕 풀
  lawn: 1, // 잔디밭(깎은 줄무늬)
  wood: 2, // 숲
  sand: 3, // 마사토 길
  pave: 4, // 보도블록(캠퍼스 밖)
  brick: 5, // 붉은 벽돌 보도(캠퍼스 안 차도 옆)
  road: 6, // 차도·서비스 길
  roadLined: 7, // 가운데 노란 겹줄과 차로 점선이 있는 넓은 차도
  plain: 8, // 무늬 없음(주차장, 트랙, 돌, 테, 횡단보도)
  plaza: 9, // 광장 판석
  pitch: 10, // 운동장 잔디(깎은 줄무늬)
} as const;
const GK_N = 11;

// 멀리(지금 포켓몬고 지도) 색과 가까이(마을) 색. 가까이 색이 없으면 멀리 색 그대로.
export const GROUND_COLORS = {
  base: "#a6dcc6",
  baseB: "#95d3ba",
  baseNear: "#9fd387",
  lawn: "#8ed5a2",
  lawnNear: "#8cc874",
  wood: "#76c27b",
  parking: "#bccad6",
  pitch: "#7fcd78",
  clay: "#d9a879",
  plaza: "#d3e6df",
  plazaNear: "#e4d7bd",
  plazaJoint: "#c9b994",
  sand: "#efdcb0",
  sandRim: "#d2b981",
  sandDark: "#d6bd88",
  sandLight: "#f7ecd0",
  pave: "#e7dfd0",
  paveJoint: "#c9c1b2",
  brick: "#d6a892",
  brickNear: "#c98c72",
  brickJoint: "#e6cfc1",
  car: "#7c8fa6",
  service: "#8b9db3",
  edge: "#f3d987",
  centre: "#ffc53d",
  cream: "#fff6e2",
  speckLight: "#b8e39b",
  speckDark: "#8fc777",
  stone: "#ece2c9",
  stoneSide: "#d9d0c0",
  soil: "#8a6a4e",
  water: "#62c0ef",
};
export const AREA_STYLE: Record<
  string,
  { color: string; y: number; gk: number }
> = {
  wood: { color: GROUND_COLORS.wood, y: LAYER.wood, gk: GK.wood },
  grass: { color: GROUND_COLORS.lawn, y: LAYER.lawn, gk: GK.lawn },
  parking: { color: GROUND_COLORS.parking, y: LAYER.parking, gk: GK.plain },
  track: { color: "#d9845d", y: LAYER.track, gk: GK.plain },
  pitch: { color: GROUND_COLORS.pitch, y: LAYER.pitch, gk: GK.pitch },
  plaza: { color: GROUND_COLORS.plaza, y: LAYER.plaza, gk: GK.plaza },
};
// 민주대로(정문~용봉탑~봉지 보행 대로)는 지도에서 너비 7m인 하나뿐인 보행로다
export const isPromenade = (r: MapRoad) => r.k === 2 && r.w === 7;

// 풀을 깎은 줄무늬 방향: 민주대로 축(정문 → 용봉탑)
const MOW = new THREE.Vector2(0.348, -0.938);

// ── 캠퍼스 안팎 ───────────────────────────────────────────────
// 용봉로(캠퍼스 남쪽 경계를 따라 동서로 길게 달리는 너비 14m 차도) 북쪽을 캠퍼스로 본다.
// 지도에서 300m 넘게 동서로 뻗은 넓은 차도들을 이어 x마다 경계 z를 잡고, 그 범위 밖은 z < 0.
export function campusTest(roads: readonly MapRoad[]) {
  const pts: [number, number][] = [];
  for (const r of roads) {
    if (r.k !== 0 || r.w < 14) continue;
    let minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < r.p.length; i += 2) {
      minX = Math.min(minX, r.p[i]);
      maxX = Math.max(maxX, r.p[i]);
    }
    if (maxX - minX < 300) continue;
    for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return (x: number, z: number) => {
    if (pts.length < 2 || x < pts[0][0] || x > pts[pts.length - 1][0])
      return z < 0;
    let i = 1;
    while (i < pts.length - 1 && pts[i][0] < x) i++;
    const [ax, az] = pts[i - 1],
      [bx, bz] = pts[i],
      t = bx > ax ? (x - ax) / (bx - ax) : 0;
    return z < az + (bz - az) * t - 4;
  };
}

// ── 선분 찾기 격자 ────────────────────────────────────────────
// 길·물길 중심선 선분을 32m 칸에 나눠 담아 가까운 선분을 빨리 찾는다.
export type Seg = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  w: number;
  k: number;
  i: number; // 몇 번째 길
};
export class SegGrid {
  private cells = new Map<number, Seg[]>();
  constructor(private size = 32) {}
  private key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  add(s: Seg) {
    const pad = s.w / 2 + 1,
      i0 = Math.floor((Math.min(s.ax, s.bx) - pad) / this.size),
      i1 = Math.floor((Math.max(s.ax, s.bx) + pad) / this.size),
      j0 = Math.floor((Math.min(s.az, s.bz) - pad) / this.size),
      j1 = Math.floor((Math.max(s.az, s.bz) + pad) / this.size);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(s);
      }
  }
  // (x, z)에서 r 안의 선분마다 fn(선분, 중심선까지 거리, 선분 위 t)
  near(
    x: number,
    z: number,
    r: number,
    fn: (s: Seg, d: number, t: number) => void,
  ) {
    const i0 = Math.floor((x - r) / this.size),
      i1 = Math.floor((x + r) / this.size),
      j0 = Math.floor((z - r) / this.size),
      j1 = Math.floor((z + r) / this.size);
    const seen = new Set<Seg>();
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (const s of this.cells.get(this.key(i, j)) ?? []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const dx = s.bx - s.ax,
            dz = s.bz - s.az,
            L2 = dx * dx + dz * dz,
            t =
              L2 > 0
                ? Math.max(
                    0,
                    Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2),
                  )
                : 0,
            d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
          if (d <= r + s.w / 2) fn(s, d, t);
        }
  }
}
export function roadGrid(roads: readonly MapRoad[], size = 32) {
  const g = new SegGrid(size);
  roads.forEach((r, i) => {
    for (let k = 2; k < r.p.length; k += 2)
      g.add({
        ax: r.p[k - 2],
        az: r.p[k - 1],
        bx: r.p[k],
        bz: r.p[k + 1],
        w: r.w,
        k: r.k,
        i,
      });
  });
  return g;
}

// ── 보행로 재질 ───────────────────────────────────────────────
// 차도 옆을 나란히 따라가는 보행로는 보도(캠퍼스 안 붉은 벽돌, 밖은 보도블록),
// 나머지 캠퍼스 보행로와 민주대로는 마사토 다짐길, 캠퍼스 밖 보행로는 보도블록이다.
export type FootMaterial = "sand" | "pave" | "brick";
export function footMaterials(
  roads: readonly MapRoad[],
  campus: (x: number, z: number) => boolean,
  grid = roadGrid(roads),
): (FootMaterial | null)[] {
  return roads.map((r) => {
    if (r.k !== 2) return null;
    if (isPromenade(r)) return "sand";
    let n = 0,
      side = 0,
      inCampus = 0;
    for (let k = 2; k < r.p.length; k += 2) {
      const ax = r.p[k - 2],
        az = r.p[k - 1],
        bx = r.p[k],
        bz = r.p[k + 1],
        L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L,
        uz = (bz - az) / L;
      for (let s = 0.5 * Math.min(4, L); s < L; s += 4) {
        const x = ax + ux * s,
          z = az + uz * s;
        n++;
        if (campus(x, z)) inCampus++;
        let along = false;
        grid.near(x, z, 9, (g, d) => {
          if (along || g.k !== 0) return;
          const gl = Math.hypot(g.bx - g.ax, g.bz - g.az) || 1,
            cos = Math.abs(((g.bx - g.ax) * ux + (g.bz - g.az) * uz) / gl);
          if (cos > 0.8 && d < g.w / 2 + 6.5) along = true;
        });
        if (along) side++;
      }
    }
    if (n === 0) return campus(r.p[0], r.p[1]) ? "sand" : "pave";
    const c = inCampus / n > 0.5;
    if (side / n >= 0.6) return c ? "brick" : "pave";
    return c ? "sand" : "pave";
  });
}

// ── 땅 덩어리 쌓기 ────────────────────────────────────────────
// 색인 없는 삼각형 묶음. 꼭짓점마다 색(멀리 색), 법선, 땅 종류 gk, 무늬 좌표 gp를 담는다.
// gp: 길은 (길 따라 거리, 중심선에서 옆으로 거리), 면은 세계 (x, z).
const _c = new THREE.Color();
export class GroundBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  gk: number[] = [];
  gp: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;
  private k = 0;
  private nx = 0;
  private ny = 1;
  private nz = 0;
  get triangles() {
    return this.pos.length / 9;
  }
  paint(color: string | THREE.Color, gk: number) {
    if (typeof color === "string") _c.set(color);
    else _c.copy(color);
    this.r = _c.r;
    this.g = _c.g;
    this.b = _c.b;
    this.k = gk;
    this.nx = 0;
    this.ny = 1;
    this.nz = 0;
    return this;
  }
  normal(x: number, y: number, z: number) {
    const L = Math.hypot(x, y, z) || 1;
    this.nx = x / L;
    this.ny = y / L;
    this.nz = z / L;
    return this;
  }
  vert(x: number, y: number, z: number, u = x, v = z) {
    this.pos.push(x, y, z);
    this.nor.push(this.nx, this.ny, this.nz);
    this.col.push(this.r, this.g, this.b);
    this.gk.push(this.k);
    this.gp.push(u, v);
  }
  // 위를 보는 삼각형 하나(감긴 방향이 아래면 뒤집는다). uv는 무늬 좌표.
  up(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    y: number,
    uv?: number[],
  ) {
    const flip = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0;
    const u = uv ?? [ax, az, bx, bz, cx, cz];
    this.vert(ax, y, az, u[0], u[1]);
    if (flip) {
      this.vert(cx, y, cz, u[4], u[5]);
      this.vert(bx, y, bz, u[2], u[3]);
    } else {
      this.vert(bx, y, bz, u[2], u[3]);
      this.vert(cx, y, cz, u[4], u[5]);
    }
  }
  // 위를 보는 평평한 형상(flatPolygon 등)을 그대로 옮긴다
  flat(g: THREE.BufferGeometry) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++)
      this.vert(p.getX(i), p.getY(i), p.getZ(i));
    g.dispose();
  }
  // 꺾은선을 너비 w의 띠로 깐다. 꺾이는 곳은 바깥쪽 틈만 부채꼴로 메우고(안쪽은 이미 겹친다),
  // 끝은 반원으로 둥글게 막는다.
  ribbon(p: number[], w: number, y: number) {
    const n = p.length / 2,
      h = w / 2;
    if (n < 2) return;
    const s = [0];
    for (let i = 1; i < n; i++)
      s.push(
        s[i - 1] +
          Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]),
      );
    const dir: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = p[i * 2 + 2] - p[i * 2],
        dz = p[i * 2 + 3] - p[i * 2 + 1],
        L = Math.hypot(dx, dz) || 1;
      dir.push([dx / L, dz / L]);
    }
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i * 2],
        az = p[i * 2 + 1],
        bx = p[i * 2 + 2],
        bz = p[i * 2 + 3],
        [ux, uz] = dir[i],
        nx = -uz * h,
        nz = ux * h;
      if (s[i + 1] - s[i] < 1e-4) continue;
      this.up(ax + nx, az + nz, bx + nx, bz + nz, ax - nx, az - nz, y, [
        s[i], h, s[i + 1], h, s[i], -h,
      ]);
      this.up(ax - nx, az - nz, bx + nx, bz + nz, bx - nx, bz - nz, y, [
        s[i], -h, s[i + 1], h, s[i + 1], -h,
      ]);
    }
    const fan = (
      cx: number,
      cz: number,
      a0: number,
      sweep: number,
      steps: number,
      along: number,
    ) => {
      for (let k = 0; k < steps; k++) {
        const t0 = a0 + (sweep * k) / steps,
          t1 = a0 + (sweep * (k + 1)) / steps;
        this.up(
          cx,
          cz,
          cx + Math.cos(t0) * h,
          cz + Math.sin(t0) * h,
          cx + Math.cos(t1) * h,
          cz + Math.sin(t1) * h,
          y,
          [along, 0, along, h, along, h],
        );
      }
    };
    const fine = w >= 5 ? Math.PI / 8 : Math.PI / 5;
    for (let i = 1; i < n - 1; i++) {
      const [ux, uz] = dir[i - 1],
        [vx, vz] = dir[i],
        cross = ux * vz - uz * vx,
        dot = ux * vx + uz * vz,
        turn = Math.atan2(Math.abs(cross), dot);
      if (turn < 0.06) continue;
      // +n 쪽으로 꺾이면 바깥 틈은 −n 쪽, 반대면 +n 쪽에 생긴다.
      // 틈은 side·n(u)에서 side·n(v)까지, u→v와 같은 방향으로 turn만큼 돈다.
      const side = vx * -uz + vz * ux > 0 ? -1 : 1,
        a0 = Math.atan2(ux * side, -uz * side),
        sweep = (cross > 0 ? 1 : -1) * turn;
      fan(
        p[i * 2],
        p[i * 2 + 1],
        a0,
        sweep,
        Math.max(1, Math.ceil(turn / fine)),
        s[i],
      );
    }
    // 끝 반원: 앞쪽(+n)에서 뒤로 돌아 −n까지
    const cap = (i: number, ux: number, uz: number, back: boolean) => {
      const a0 = Math.atan2(ux, -uz); // +n 방향
      fan(
        p[i * 2],
        p[i * 2 + 1],
        a0,
        back ? Math.PI : -Math.PI,
        w >= 5 ? 4 : 3,
        s[i],
      );
    };
    cap(0, dir[0][0], dir[0][1], true);
    cap(n - 1, dir[n - 2][0], dir[n - 2][1], false);
  }
  // 삼각형 차례를 뒤집어 담는다: 나중에 깐 위층(길·줄·횡단보도)이 먼저 그려져 깊이를 채우면
  // 그 밑 바탕·잔디 조각은 셰이더를 돌기 전에 깊이 시험에서 버려진다.
  geometry() {
    const g = new THREE.BufferGeometry();
    const put = (name: string, a: number[], n: number) =>
      g.setAttribute(name, new THREE.BufferAttribute(reverseTriangles(a, n), n));
    put("position", this.pos, 3);
    put("normal", this.nor, 3);
    put("color", this.col, 3);
    put("gk", this.gk, 1);
    put("gp", this.gp, 2);
    this.pos = this.nor = this.col = this.gk = this.gp = [];
    return g;
  }
}

// 꼭짓점 n개 성분 배열 a를 삼각형(꼭짓점 셋) 단위로 거꾸로 늘어놓는다(삼각형 안 차례는 그대로)
export function reverseTriangles(a: ArrayLike<number>, n: number) {
  const block = 3 * n,
    T = Math.floor(a.length / block),
    out = new Float32Array(T * block);
  for (let t = 0; t < T; t++) {
    const from = t * block,
      to = (T - 1 - t) * block;
    for (let i = 0; i < block; i++) out[to + i] = a[from + i];
  }
  return out;
}

// ── 돋운 화단 ─────────────────────────────────────────────────
// 모서리를 두 번 깎아(Chaikin) 둥근 테를 두른 화단. 테 윗면은 돌색, 안쪽은 흙.
export function chaikin(p: number[], iter = 2) {
  let q = p;
  for (let it = 0; it < iter; it++) {
    const out: number[] = [],
      n = q.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        ax = q[i * 2],
        az = q[i * 2 + 1],
        bx = q[j * 2],
        bz = q[j * 2 + 1];
      out.push(
        ax * 0.75 + bx * 0.25,
        az * 0.75 + bz * 0.25,
        ax * 0.25 + bx * 0.75,
        az * 0.25 + bz * 0.75,
      );
    }
    q = out;
  }
  return q;
}
// 고리를 d만큼 안쪽으로 줄인다(꼭짓점을 이등분선 방향으로 옮긴다)
export function inset(p: number[], d: number) {
  const n = p.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  const sgn = area > 0 ? 1 : -1,
    out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n,
      b = (i + 1) % n,
      e1x = p[i * 2] - p[a * 2],
      e1z = p[i * 2 + 1] - p[a * 2 + 1],
      e2x = p[b * 2] - p[i * 2],
      e2z = p[b * 2 + 1] - p[i * 2 + 1],
      l1 = Math.hypot(e1x, e1z) || 1,
      l2 = Math.hypot(e2x, e2z) || 1,
      // 안쪽 법선(넓이 부호로 방향을 맞춘다)
      n1x = (-e1z / l1) * sgn,
      n1z = (e1x / l1) * sgn,
      n2x = (-e2z / l2) * sgn,
      n2z = (e2x / l2) * sgn,
      bx = n1x + n2x,
      bz = n1z + n2z,
      bl = Math.hypot(bx, bz) || 1,
      cos = Math.max(0.35, (bx / bl) * n1x + (bz / bl) * n1z);
    out.push(p[i * 2] + (bx / bl) * (d / cos), p[i * 2 + 1] + (bz / bl) * (d / cos));
  }
  return out;
}
function bed(gb: GroundBuilder, p: number[]) {
  const outer = chaikin(p, 2),
    lip = inset(outer, 0.14),
    top = inset(outer, 0.42),
    n = outer.length / 2;
  let cxm = 0,
    czm = 0;
  for (let k = 0; k < n; k++) {
    cxm += outer[k * 2] / n;
    czm += outer[k * 2 + 1] / n;
  }
  // 벽 띠: 고리 a(높이 ya) → 고리 b(높이 yb)
  const band = (
    a: number[],
    ya: number,
    b: number[],
    yb: number,
    color: string,
  ) => {
    gb.paint(color, GK.plain);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        ax = a[i * 2],
        az = a[i * 2 + 1],
        bx = a[j * 2],
        bz = a[j * 2 + 1],
        cx = b[i * 2],
        cz = b[i * 2 + 1],
        dx = b[j * 2],
        dz = b[j * 2 + 1];
      // 면 법선: (B−A) × (C−A)
      const ux = bx - ax,
        uy = 0,
        uz = bz - az,
        vx = cx - ax,
        vy = yb - ya,
        vz = cz - az;
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      // 바깥(위)을 보게: 화단 가운데에서 멀어지는 쪽 + 위
      const mx = (ax + bx) / 2,
        mz = (az + bz) / 2;
      const outward = (mx - cxm) * nx + (mz - czm) * nz + ny * 0.01;
      const flip = (ya > yb ? -1 : 1) * (outward < 0 ? -1 : 1) < 0;
      if (flip) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      gb.normal(nx, ny, nz);
      const tri = (
        p1: [number, number, number],
        p2: [number, number, number],
        p3: [number, number, number],
      ) => {
        // 법선 쪽에서 보아 반시계가 되도록
        const e1 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]],
          e2 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]],
          c = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
        const ok = c[0] * nx + c[1] * ny + c[2] * nz >= 0;
        gb.vert(...p1);
        if (ok) {
          gb.vert(...p2);
          gb.vert(...p3);
        } else {
          gb.vert(...p3);
          gb.vert(...p2);
        }
      };
      tri([ax, ya, az], [bx, ya, bz], [cx, yb, cz]);
      tri([cx, yb, cz], [bx, ya, bz], [dx, yb, dz]);
    }
  };
  band(outer, LAYER.wood, outer, LAYER.bedSoil, GROUND_COLORS.stoneSide);
  band(outer, LAYER.bedSoil, lip, LAYER.bedRim, GROUND_COLORS.stone);
  band(lip, LAYER.bedRim, top, LAYER.bedRim, GROUND_COLORS.stone);
  band(top, LAYER.bedRim, top, LAYER.bedSoil + 0.02, GROUND_COLORS.stoneSide);
  gb.paint(GROUND_COLORS.soil, GK.plain);
  gb.flat(flatPolygon(top, [], LAYER.bedSoil + 0.02));
}

// ── 횡단보도 ──────────────────────────────────────────────────
// 차도·서비스 길 위 횡단보도 자리마다 크림색 막대를 차가 다니는 방향과 나란히 깐다.
// 막대 0.9m, 사이 0.9m, 막대 길이 4m, 길 양끝 0.6m는 비운다.
export function crosswalkBars(
  pois: MapData["pois"],
  grid: SegGrid,
): { x: number; z: number; ux: number; uz: number; n: number }[] {
  const out: { x: number; z: number; ux: number; uz: number; n: number }[] =
    [];
  for (const c of pois ?? []) {
    if (c.k !== "crossing") continue;
    let best: Seg | null = null,
      bestD = Infinity;
    grid.near(c.x, c.z, 6, (s, d) => {
      if (s.k <= 1 && d < bestD) {
        bestD = d;
        best = s;
      }
    });
    if (!best) continue;
    const s = best as Seg,
      L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1,
      ux = (s.bx - s.ax) / L,
      uz = (s.bz - s.az) / L,
      n = Math.max(1, Math.floor((s.w - 1.2 + 0.9) / 1.8));
    out.push({ x: c.x, z: c.z, ux, uz, n });
  }
  return out;
}

// ── 노이즈 그림(코드로 만든 128² RGBA, 밉맵) ─────────────────
// R: 부드러운 4옥타브 값 노이즈(한 바퀴에 8칸), G·A: 칸마다 난수(겹쳐 쓰면 잔 알갱이)
let noiseTex: THREE.DataTexture | null = null;
export function groundNoise() {
  if (noiseTex) return noiseTex;
  const N = 128,
    data = new Uint8Array(N * N * 4);
  let seed = 518;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lattice = (cells: number) => {
    const v = new Float32Array(cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    return (x: number, y: number) => {
      const fx = (x / N) * cells,
        fy = (y / N) * cells,
        x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        tx = fx - x0,
        ty = fy - y0,
        sx = tx * tx * (3 - 2 * tx),
        sy = ty * ty * (3 - 2 * ty),
        at = (i: number, j: number) =>
          v[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx,
        b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const oct = [lattice(8), lattice(16), lattice(32), lattice(64)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let f = 0,
        amp = 0.5,
        sum = 0;
      for (const o of oct) {
        f += o(x, y) * amp;
        sum += amp;
        amp *= 0.5;
      }
      const i = (y * N + x) * 4;
      data[i] = Math.round((f / sum) * 255);
      data[i + 1] = Math.round(rnd() * 255);
      data[i + 2] = data[i];
      data[i + 3] = Math.round(rnd() * 255);
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  t.userData.shared = true;
  noiseTex = t;
  return t;
}

// ── 땅 재질(셰이더 무늬) ──────────────────────────────────────
// 조용한 구역(정문·용봉관 등) 안 차도 가운데 줄은 노랑 대신 크림으로 칠한다.
const lin = (hex: string) => new THREE.Color(hex);
const ratio = (near: string, far: string) => {
  const a = lin(near),
    b = lin(far);
  return new THREE.Vector3(a.r / b.r, a.g / b.g, a.b / b.b);
};
export function groundMaterial(calm: CalmZone[], phone = false) {
  const G = GROUND_COLORS;
  const tint = Array.from({ length: GK_N }, () => new THREE.Vector3(1, 1, 1));
  tint[GK.base] = ratio(G.baseNear, G.base);
  tint[GK.lawn] = ratio(G.lawnNear, G.lawn);
  tint[GK.pitch] = ratio(G.lawnNear, G.lawn);
  tint[GK.plaza] = ratio(G.plazaNear, G.plaza);
  tint[GK.brick] = ratio(G.brickNear, G.brick);
  const calmV = Array.from({ length: 6 }, (_, i) =>
    calm[i]
      ? new THREE.Vector4(calm[i].x, calm[i].z, calm[i].r, 0)
      : new THREE.Vector4(1e6, 1e6, 0, 0),
  );
  const uniforms = {
    uHero: { value: new THREE.Vector2() },
    uNoise: { value: groundNoise() },
    uNearTint: { value: tint },
    uCalm: { value: calmV },
    uBaseB: { value: lin(G.baseB) },
    uSpeckL: { value: lin(G.speckLight) },
    uSpeckD: { value: lin(G.speckDark) },
    uSandD: { value: lin(G.sandDark) },
    uSandL: { value: lin(G.sandLight) },
    uPaveJ: { value: lin(G.paveJoint) },
    uBrickJ: { value: lin(G.brickJoint) },
    uPlazaJ: { value: lin(G.plazaJoint) },
    uCentre: { value: lin(G.centre) },
    uCream: { value: lin(G.cream) },
  };
  // 폰은 Lambert: 화면 대부분을 덮는 땅이라 조각 셰이더 값이 가장 크게 든다
  const m = worldMaterial(phone, 0.92);
  m.userData.ground = uniforms;
  chainOnBeforeCompile(m, "ground-v2", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float gk;
attribute vec2 gp;
varying float vGk;
varying vec2 vGp;
varying vec2 vGw;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vGk = gk;
vGp = gp;
vGw = (modelMatrix * vec4(transformed, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec2 uHero;
uniform sampler2D uNoise;
uniform vec3 uNearTint[${GK_N}];
uniform vec4 uCalm[6];
uniform vec3 uBaseB, uSpeckL, uSpeckD, uSandD, uSandL, uPaveJ, uBrickJ, uPlazaJ, uCentre, uCream;
varying float vGk;
varying vec2 vGp;
varying vec2 vGw;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 줄눈: 칸(size m) 경계에서 joint m 안이면 1. 칸마다 난수 rnd. px는 화소 하나의 크기(m).
float gJoint(vec2 p, vec2 size, float joint, float bond, float px, out float rnd) {
  vec2 q = p / size;
  q.x += bond * floor(q.y);
  vec2 cell = floor(q);
  rnd = gHash(cell);
  vec2 f = (q - cell) * size;
  vec2 d = min(f, size - f);
  float e = min(d.x, d.y);
  float line = 1.0 - smoothstep(joint * 0.5 - px * 0.5, joint * 0.5 + px * 0.5, e);
  return line * (1.0 - smoothstep(joint * 0.6, joint * 1.8, px));
}
// 가로 띠 [a, b] 안이면 1(경계는 화소 크기만큼 부드럽게)
float gBand(float v, float a, float b, float px) {
  return smoothstep(a - px, a + px, v) * (1.0 - smoothstep(b - px, b + px, v));
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // 도함수는 갈래 밖에서 한 번에 구한다(갈래 안 도함수는 값이 정해지지 않는다)
  vec2 fwW = fwidth(vGw);
  vec2 fwP = fwidth(vGp);
  vec2 dxW = dFdx(vGw);
  vec2 dyW = dFdy(vGw);
  int k = int(vGk + 0.5);
  float hd = length(vGw - uHero);
  float nearK = 1.0 - smoothstep(60.0, 120.0, hd);
  // 무늬 그림은 캐릭터 120m 안(nearK > 0)에서만 읽는다. 먼 땅에서는 세 값 모두 nearK·det가
  // 0이라 쓰이지 않는다. 밉맵 기울기는 갈래 밖 도함수로 넘긴다(textureGrad).
  float nBig = 0.5, nMid = 0.5, nFine = 0.5;
  if (nearK > 0.0) {
    nBig = textureGrad(uNoise, vGw / 72.0, dxW / 72.0, dyW / 72.0).r;
    nMid = textureGrad(uNoise, vGw / 204.8 + 0.37, dxW / 204.8, dyW / 204.8).a;
    nFine = textureGrad(uNoise, vGw / 44.8, dxW / 44.8, dyW / 44.8).g;
  }
  float camD = length(vViewPosition);
  float det = nearK * (1.0 - smoothstep(90.0, 170.0, camD));
  float tileK = (1.0 - smoothstep(60.0, 100.0, hd)) * (1.0 - smoothstep(90.0, 160.0, camD));
  vec3 c = diffuseColor.rgb;
  if (k == 0) {
    float m = 0.5 + 0.5 * sin(vGw.x * 0.03 + vGw.y * 0.02) * sin(vGw.y * 0.025 - vGw.x * 0.01);
    c = mix(c, uBaseB, m * (1.0 - nearK));
  }
  c *= mix(vec3(1.0), uNearTint[k], nearK);
  if (k <= 2 || k == 10) {
    // 큰 얼룩과 잔점(숲은 나무가 덮으므로 얼룩만)
    c *= 1.0 + nearK * (nBig - 0.5) * 0.16;
    float sp = k == 2 ? 0.0 : det;
    c = mix(c, uSpeckL, sp * 0.5 * smoothstep(0.8, 0.9, nMid));
    c = mix(c, uSpeckD, sp * 0.4 * (1.0 - smoothstep(0.1, 0.2, nMid)));
    if (k == 1 || k == 10) {
      float t = dot(vGw, vec2(${MOW.x}, ${MOW.y})) / 12.0;
      float fw = (abs(${MOW.x}) * fwW.x + abs(${MOW.y}) * fwW.y) / 12.0;
      float tri = abs(fract(t) - 0.5) * 2.0;
      float band = smoothstep(0.5 - fw * 2.0, 0.5 + fw * 2.0, tri);
      c *= 1.0 + (band - 0.5) * 0.06 * (0.4 + 0.6 * nearK);
    }
  } else if (k == 3) {
    // 마사토 알갱이
    c = mix(c, uSandD, det * 0.35 * (1.0 - smoothstep(0.16, 0.24, nFine)));
    c = mix(c, uSandL, det * 0.5 * smoothstep(0.84, 0.92, nFine));
    c *= 1.0 + det * (nBig - 0.5) * 0.08;
  } else if (k == 4 || k == 5) {
    // 보도블록(0.9m 정사각) · 붉은 벽돌(0.9×0.45m 엇갈림)
    float px = max(fwP.x, fwP.y);
    float rnd;
    float j = k == 4
      ? gJoint(vGp, vec2(0.9, 0.9), 0.07, 0.0, px, rnd)
      : gJoint(vGp, vec2(0.9, 0.45), 0.06, 0.5, px, rnd);
    c *= 1.0 + tileK * (rnd - 0.5) * (k == 4 ? 0.06 : 0.1);
    c = mix(c, k == 4 ? uPaveJ : uBrickJ, j * tileK);
  } else if (k == 7) {
    // 가운데 노란 겹줄(조용한 구역은 크림)과 3.3m마다 차로 점선
    float a = abs(vGp.y);
    float calm = 0.0;
    for (int i = 0; i < 6; i++) calm = max(calm, 1.0 - step(uCalm[i].z, length(vGw - uCalm[i].xy)));
    float yel = gBand(a, 0.1, 0.35, fwP.y);
    float dash = gBand(fract(vGp.x / 8.0) * 8.0, 0.0, 3.0, fwP.x);
    float lane = gBand(a, 3.15, 3.45, fwP.y) * dash;
    float fade = det * (1.0 - smoothstep(0.12, 0.3, fwP.y));
    c = mix(c, mix(uCentre, uCream, calm), yel * fade);
    c = mix(c, uCream, lane * fade);
  } else if (k == 9) {
    // 광장 판석 1.8×0.9m 엇갈림
    float px = max(fwW.x, fwW.y);
    float rnd;
    float j = gJoint(vGw, vec2(1.8, 0.9), 0.08, 0.5, px, rnd);
    c *= 1.0 + det * (rnd - 0.5) * 0.06;
    c = mix(c, uPlazaJ, j * det);
  }
  diffuseColor.rgb = c;
}`,
      );
  });
  return m;
}

// ── 땅 깔기 ───────────────────────────────────────────────────
export type Ground = {
  update: Updater;
  // 보행로마다 재질(차도·서비스 길은 null)
  foot: (FootMaterial | null)[];
  campus: (x: number, z: number) => boolean;
  grid: SegGrid;
  triangles: number;
  // 땅을 마지막으로 그린 화면 카메라(update에 카메라를 넘기지 않는 호출의 화면 밖 판정용)
  camera: () => THREE.Camera | null;
};
export function buildGround(
  scene: THREE.Object3D,
  data: MapData,
  occ: Occupancy,
  calm: CalmZone[],
  phone = false,
): Ground {
  const G = GROUND_COLORS,
    gb = new GroundBuilder(),
    water = new GroundBuilder(),
    campus = campusTest(data.roads),
    grid = roadGrid(data.roads),
    foot = footMaterials(data.roads, campus, grid);

  // 넓은 바탕(3.2km): 얼룩과 풀빛은 셰이더가 그린다
  gb.paint(G.base, GK.base);
  const E = 1600;
  gb.up(-E, -E, E, -E, -E, E, 0);
  gb.up(-E, E, E, -E, E, E, 0);

  for (const a of data.areas) {
    if (a.k === "water") {
      water.paint(G.water, GK.plain);
      water.flat(flatPolygon(a.p, a.holes, LAYER.pond));
      gb.paint(G.stone, GK.plain);
      gb.ribbon([...a.p, a.p[0], a.p[1]], 1.6, LAYER.pond + 0.02);
      occ.polygon(a.p, 2);
      continue;
    }
    if (a.k === "flower") {
      bed(gb, a.p);
      occ.polygon(a.p, 1);
      continue;
    }
    const s = AREA_STYLE[a.k];
    if (!s) continue;
    const clay = a.k === "pitch" && a.surface && !/grass|turf/.test(a.surface);
    gb.paint(clay ? G.clay : s.color, clay ? GK.plain : s.gk);
    gb.flat(flatPolygon(a.p, a.holes, s.y));
    if (a.k !== "wood" && a.k !== "grass") occ.polygon(a.p);
  }

  // 길: 테 → 길 바닥 차례로 깐다(높이 표 LAYER)
  data.roads.forEach((r, i) => {
    const f = foot[i];
    if (r.k === 2) {
      if (f === "sand") {
        gb.paint(G.sandRim, GK.plain);
        gb.ribbon(r.p, r.w + 0.7, LAYER.rimSand);
        gb.paint(G.sand, GK.sand);
      } else {
        gb.paint(G.paveJoint, GK.plain);
        gb.ribbon(r.p, r.w + 0.6, LAYER.rimPave);
        gb.paint(f === "brick" ? G.brick : G.pave, f === "brick" ? GK.brick : GK.pave);
      }
      gb.ribbon(r.p, r.w, LAYER.foot);
    } else {
      gb.paint(G.edge, GK.plain);
      gb.ribbon(r.p, r.w + (r.k === 0 ? 1.5 : 1.1), LAYER.edge);
      gb.paint(
        r.k === 0 ? G.car : G.service,
        r.k === 0 && r.w >= 12 ? GK.roadLined : GK.road,
      );
      gb.ribbon(r.p, r.w, r.k === 0 ? LAYER.car : LAYER.service);
    }
    occ.line(r.p, r.w + 3);
  });

  // 횡단보도
  gb.paint(G.cream, GK.plain);
  for (const c of crosswalkBars(data.pois, grid)) {
    const vx = -c.uz,
      vz = c.ux; // 길을 가로지르는 방향
    for (let b = 0; b < c.n; b++) {
      const o = (b - (c.n - 1) / 2) * 1.8,
        cx = c.x + vx * o,
        cz = c.z + vz * o,
        hx = c.ux * 2,
        hz = c.uz * 2,
        wx = vx * 0.45,
        wz = vz * 0.45;
      gb.up(cx - hx - wx, cz - hz - wz, cx + hx - wx, cz + hz - wz, cx - hx + wx, cz - hz + wz, LAYER.mark);
      gb.up(cx - hx + wx, cz - hz + wz, cx + hx - wx, cz + hz - wz, cx + hx + wx, cz + hz + wz, LAYER.mark);
    }
  }

  // 물길: 돌 테두리 위로 좁은 물
  for (const st of data.streams) {
    gb.paint(G.stone, GK.plain);
    gb.ribbon(st.p, st.w + 0.9, LAYER.streamStone);
    water.paint(G.water, GK.plain);
    water.ribbon(st.p, st.w, LAYER.stream);
    occ.line(st.p, st.w + 2);
  }

  const triangles = gb.triangles + water.triangles;
  const material = groundMaterial(calm, phone),
    uniforms = material.userData.ground as { uHero: { value: THREE.Vector2 } };
  const land = new THREE.Mesh(gb.geometry(), material);
  land.name = "ground";
  land.receiveShadow = true;
  const wgeo = water.geometry();
  wgeo.deleteAttribute("gk");
  wgeo.deleteAttribute("gp");
  const pond = new THREE.Mesh(
    wgeo,
    phone
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.15,
          metalness: 0.05,
        }),
  );
  pond.name = "water";
  pond.receiveShadow = true;
  // 땅·물은 건물·나무·소품 다음에 그린다(불투명 차례 1): 앞에 선 것이 깊이를 채운 자리의
  // 땅 조각은 셰이더를 돌지 않는다. 꼭짓점 배열은 버리지 않는다(문맥을 잃었다 되찾으면 다시 올린다).
  for (const m of [land, pond]) {
    m.geometry.computeBoundingSphere();
    m.renderOrder = 1;
  }
  scene.add(land, pond);
  // 땅은 늘 화면에 있으므로, 땅을 그릴 때의 카메라를 기억해 둔다(그림자 패스는 땅을 그리지 않는다)
  let eye: THREE.Camera | null = null;
  land.onBeforeRender = (_r, _s, cam) => {
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) eye = cam;
  };
  if (process.env.NODE_ENV !== "production")
    console.info("field ground triangles", triangles);
  return {
    update: (x, z) => uniforms.uHero.value.set(x, z),
    foot,
    campus,
    grid,
    triangles,
    camera: () => eye,
  };
}
