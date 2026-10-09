import * as THREE from "three";
import {
  cap,
  circleRing,
  clayBox,
  clayCylinder,
  cleanRing,
  offsetPoly,
  profile,
  rgb,
  roundRing,
  scaleRGB,
  WIN,
  winCode,
  type ClayWriter,
  type RGB,
} from "./field-clay";
import type { MapBox, MapData } from "./field-geom";
// 형(type)만 가져온다: 실행할 때 field-buildings.ts와 서로 부르지 않는다
import type { Obb, Plan, StyledBuilding } from "./field-buildings";

// 랜드마크 자리: 경로 가까운 이름난 건물은 일반 건물 구역에 섞지 않고 한 채씩 따로 세운다.
// 블렌더 모형(public/models/landmarks.json에 적은 GLB)이 오면 코드로 빚은 건물을 숨기고
// 그 모형을 지도 맞춤 상자(boxes)에 맞춰 세운다. 모형이 없거나 못 받으면 코드 건물이 그대로 선다.
// 모양 근거는 hh가 2026-10-07에 준 사진(저장소에 넣지 않음)과 jnu-map.config.json의 style·heights다.

export type LandmarkSlot = {
  key: string;
  osmId: string; // OSM 건물 id
  box?: string; // 지도 자료 boxes의 이름(모형 맞춤)
  external?: boolean; // 다른 곳(field-map.ts)에서 이미 모형을 세운다
  calm?: boolean; // 5·18 사적지: 움직이는 연출 없음
};
export const LANDMARK_SLOTS: readonly LandmarkSlot[] = [
  // 용봉관은 field-map.ts가 블렌더 모형(hall.glb)이나 코드 모형으로 세운다
  { key: "yongbong", osmId: "w290680706", box: "hall", external: true, calm: true },
  { key: "jungbomaru", osmId: "w1120956385", box: "jungbomaru" },
  { key: "minjumaru", osmId: "w290374303", box: "minjumaru" },
  { key: "library", osmId: "w270549104", box: "library" },
  { key: "hq", osmId: "w277767025", box: "hq" },
];

// public/models/landmarks.json 한 줄: 받을 GLB와 그 안 노드 이름, 맞춤 방식.
// fit = footprint면 상자 가로에 맞춰 키우고, real이면 실제 크기 그대로 세운다. yaw는 모형 앞(+z) 보정.
export type LandmarkEntry = {
  key: string;
  file: string;
  node: string;
  yaw?: number;
  fit?: "footprint" | "real";
  optional?: boolean;
};
export type LandmarkManifest = { entries: LandmarkEntry[] };

// 모형을 상자 가운데에, 바닥을 땅에 붙여, 상자 방향(+ yaw)으로 세우는 행렬
export function landmarkMatrix(
  geo: THREE.BufferGeometry,
  box: MapBox,
  e: Pick<LandmarkEntry, "fit" | "yaw">,
) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!,
    s = e.fit === "footprint" ? box.w / Math.max(0.01, bb.max.x - bb.min.x) : 1;
  const pre = new THREE.Matrix4().makeTranslation(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y,
    -(bb.min.z + bb.max.z) / 2,
  );
  return new THREE.Matrix4()
    .compose(
      new THREE.Vector3(box.c[0], 0, box.c[1]),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        box.a + (e.yaw ?? 0),
      ),
      new THREE.Vector3(s, s, s),
    )
    .multiply(pre);
}

export type SlotBuilders = {
  body(p: Plan): void;
  near(p: Plan): void;
  plan(b: StyledBuilding): Plan | null;
};

// 랜드마크 자리 한 채를 빚는다. 모형이 오기 전까지(또는 끝내 없으면) 이것이 선다.
export function slotParts(
  slot: LandmarkSlot,
  pl: Plan,
  w: ClayWriter,
  data: MapData,
  gen: SlotBuilders,
) {
  const box = slot.box ? data.boxes[slot.box] : undefined;
  if (slot.key === "minjumaru") return minjumaru(w, pl, box);
  if (slot.key === "hq") return hq(w, pl, gen);
  if (slot.key === "jungbomaru") {
    gen.body(pl);
    gen.near({ ...pl, parapet: 0 });
    return jungbomaru(w, pl);
  }
  gen.body(pl);
  gen.near(pl);
}

const C = {
  white: rgb("#f6f4ef"),
  whiteShade: rgb("#e7e3da"),
  cream: rgb("#fff6e2"),
  stone: rgb("#d9d0c0"),
  stoneTop: rgb("#e6dfd2"),
  roof: rgb("#eceeee"),
  dome: rgb("#9aa1aa"),
  domeTop: rgb("#b4bac2"),
  slat: rgb("#4b5462"),
  slatDark: rgb("#3a414d"),
};

// 민주마루: 기단 위 유리·패널 상자를 아주 가늘고 높은 흰 기둥 열주가 두르고, 두꺼운 흰 평지붕판에
// 네모 창 띠가 줄지어 있다. 정면(용봉탑 쪽)에 넓은 돌계단.
function minjumaru(w: ClayWriter, pl: Plan, box?: MapBox) {
  const base = cleanRing(pl.b.p),
    H = pl.H,
    podH = 1.4,
    slabT = 2.6,
    slab0 = H - slabT,
    ring = (o: number, r: number) => {
      const q = offsetPoly(base.x, base.z, o);
      return roundRing(q.x, q.z, { r, seg: 2 });
    };
  // 기단
  const pod = ring(1.6, 1.2);
  profile(w, pod, [
    { o: 0, y: 0, c: scaleRGB(C.stone, 0.92), n: [1, 0] },
    { o: 0, y: podH - 0.12, c: C.stone, n: [1, 0] },
    { o: -0.12, y: podH, c: C.stoneTop, n: [0.3, 1] },
  ]);
  cap(w, pod, -0.12, podH, C.stoneTop);
  // 안쪽 유리·패널 상자
  const glass = ring(-2.4, 1.0);
  profile(w, glass, [
    { o: 0, y: podH, c: C.white, code: winCode(WIN.GLASSBOX), H: slab0 },
    { o: 0, y: slab0, c: C.white },
  ]);
  // 지붕판: 밑면, 네모 창 띠가 든 옆면, 크림 모따기, 윗면
  const slab = ring(1.0, 1.4);
  cap(w, slab, 0, slab0, C.whiteShade, false);
  profile(w, slab, [
    { o: 0, y: slab0, c: C.white, code: winCode(WIN.SLAB, slabT * 10), H: H - 0.25 },
    { o: 0, y: H - 0.25, c: C.white },
    { o: -0.25, y: H, c: C.cream },
  ]);
  cap(w, slab, -0.25, H, C.roof);
  // 열주: 윤곽 변마다 5.8m 안팎 간격, 모서리마다 하나
  const n = base.x.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      ax = base.x[i],
      az = base.z[i],
      dx = base.x[j] - ax,
      dz = base.z[j] - az,
      L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const nx = dz / L,
      nz = -dx / L,
      k = Math.max(1, Math.round(L / 5.8));
    for (let s = 0; s < k; s++) {
      const t = (s / k) * L,
        x = ax + (dx / L) * t - nx * 0.2,
        z = az + (dz / L) * t - nz * 0.2;
      clayCylinder(w, x, z, 0.6, podH, podH + 0.35, 10, C.stoneTop, C.stoneTop, 0.08);
      clayCylinder(w, x, z, 0.42, podH + 0.35, slab0, 10, C.white, C.white, 0);
    }
  }
  // 정면 돌계단: 상자 정면 쪽을 가장 많이 보는 긴 변 가운데
  if (box) {
    const fx = Math.sin(box.a),
      fz = Math.cos(box.a);
    let best = -1,
      score = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        dx = base.x[j] - base.x[i],
        dz = base.z[j] - base.z[i],
        L = Math.hypot(dx, dz);
      if (L < 12) continue;
      const s = (dz / L) * fx + (-dx / L) * fz;
      if (s > score) {
        score = s;
        best = i;
      }
    }
    if (best >= 0) {
      const i = best,
        j = (i + 1) % n,
        dx = base.x[j] - base.x[i],
        dz = base.z[j] - base.z[i],
        L = Math.hypot(dx, dz),
        ux = dx / L,
        uz = dz / L,
        nx = uz,
        nz = -ux,
        mx = (base.x[i] + base.x[j]) / 2,
        mz = (base.z[i] + base.z[j]) / 2,
        sw = Math.min(L * 0.7, 26);
      for (let k = 0; k < 4; k++) {
        const top = podH - 0.35 * k,
          out = 1.6 + 0.9 * k,
          d = out + 0.9;
        clayBox(w, mx + nx * d * 0.5, 0, mz + nz * d * 0.5, ux, uz, sw, top, d, 0.06, C.stone, C.stoneTop);
      }
    }
  }
}

// 대학본부: 서쪽 끝 낮은 원통(회색 골 진 돔 지붕)과 동쪽으로 이어진 흰 판상(가로 띠창).
// 판상 높이는 설정 heights(33m, 확인 중)를 따르고 원통 높이는 사진 짐작(8.5m)이다.
function hq(w: ClayWriter, pl: Plan, gen: SlotBuilders) {
  const base = cleanRing(pl.b.p),
    o = pl.obb;
  const sOf = (x: number, z: number) => (x - o.cx) * o.ux + (z - o.cz) * o.uz;
  // 긴 축에서 가장 서쪽(작은 쪽)에 몰린 꼭짓점으로 원을 맞춘다
  let sMin = Infinity;
  base.x.forEach((x, k) => {
    sMin = Math.min(sMin, sOf(x, base.z[k]));
  });
  const endS = sMin,
    pts: [number, number][] = [];
  base.x.forEach((x, k) => {
    if (sOf(x, base.z[k]) < endS + 34) pts.push([x, base.z[k]]);
  });
  const circ = fitCircle(pts);
  if (!circ || circ.r < 6 || circ.r > 30) {
    gen.body(pl);
    gen.near(pl);
    return;
  }
  // 판상: 원 가운데에서 반지름 0.55만큼 동쪽으로 자른 윤곽
  const cut = sOf(circ.x, circ.z) + circ.r * 0.55,
    poly = clipPoly(base.x, base.z, (x, z) => sOf(x, z) - cut);
  const slabB: StyledBuilding = { ...pl.b, p: poly, holes: undefined, rr: undefined };
  const slab = gen.plan(slabB);
  if (slab) {
    gen.body(slab);
    gen.near(slab);
  }
  // 원통 + 돔
  const R = circ.r,
    Hd = 8.5,
    drum = circleRing(circ.x, circ.z, R, 40),
    rows = 2;
  profile(w, drum, [
    { o: 0.12, y: 0, c: C.stone, n: [1, 0] },
    { o: 0.12, y: 0.55, c: C.stone, n: [0.6, 0.8] },
    { o: 0, y: 0.65, c: C.white, n: [1, 0], code: winCode(WIN.WHITE_RIBBON, rows), H: Hd },
    { o: 0, y: Hd, c: C.white, n: [1, 0] },
    { o: 0.45, y: Hd + 0.25, c: C.cream, n: [0.7, 0.7] },
    { o: 0.45, y: Hd + 0.75, c: C.cream, n: [0.8, 0.6] },
    { o: 0.1, y: Hd + 0.95, c: C.cream, n: [0.3, 1] },
    { o: 0, y: Hd + 0.95, c: C.dome, n: [1, 0.25] },
  ]);
  const rise = R * 0.32,
    domeCode = winCode(WIN.RIBS),
    lv: { o: number; y: number; n: [number, number] }[] = [];
  for (let k = 0; k <= 5; k++) {
    const a = (k / 6) * (Math.PI / 2),
      rr = Math.cos(a),
      yy = Math.sin(a);
    lv.push({ o: -R * (1 - rr * 0.98), y: Hd + 0.95 + rise * yy, n: [rr * rise, yy * R] });
  }
  profile(
    w,
    drum,
    lv.map((l, k) => ({
      o: l.o,
      y: l.y,
      c: k < 5 ? C.dome : C.domeTop,
      n: l.n,
      code: domeCode,
      H: Hd,
    })),
  );
  cap(w, drum, lv[lv.length - 1].o, lv[lv.length - 1].y, C.domeTop);
}

// 정보마루: 1층 통유리 위로 둥근 끝의 흰 가로 띠(중간층·지붕)가 겹치고, 띠 사이는 테라코타 세로 핀.
// 지붕 위에는 어두운 살창 차양.
function jungbomaru(w: ClayWriter, pl: Plan) {
  const base = cleanRing(pl.b.p),
    q = offsetPoly(base.x, base.z, 0.75),
    band = roundRing(q.x, q.z, { r: 3.2, seg: 3 }),
    H = pl.H,
    Pf = (H - 0.6) / Math.max(1, pl.rows),
    mid = 0.6 + Pf * Math.floor(pl.rows * 0.5 + 0.5);
  const slabBand = (y0: number, y1: number) =>
    profile(w, band, [
      { o: -0.75, y: y0, c: C.whiteShade, n: [0, -1] },
      { o: -0.1, y: y0 + 0.02, c: C.whiteShade, n: [0.5, -0.86] },
      { o: 0, y: y0 + 0.2, c: C.white, n: [1, -0.2] },
      { o: 0, y: y1 - 0.2, c: C.white, n: [1, 0.2] },
      { o: -0.1, y: y1, c: C.white, n: [0.5, 0.86] },
      { o: -0.75, y: y1 + 0.02, c: C.white, n: [0, 1] },
    ]);
  slabBand(mid - 0.05, mid + 0.95);
  // 지붕 띠: 위로 0.45m 올라와 낮은 난간처럼 지붕을 감싼다
  profile(w, band, [
    { o: -0.75, y: H - 1.35, c: C.whiteShade, n: [0, -1] },
    { o: -0.1, y: H - 1.33, c: C.whiteShade, n: [0.5, -0.86] },
    { o: 0, y: H - 1.15, c: C.white, n: [1, -0.2] },
    { o: 0, y: H + 0.25, c: C.white, n: [1, 0.2] },
    { o: -0.15, y: H + 0.45, c: C.cream, n: [0.4, 1] },
    { o: -0.9, y: H + 0.45, c: C.cream, n: [-0.3, 1] },
    { o: -1.0, y: H + 0.3, c: scaleRGB(C.roof, 0.9), n: [-1, 0] },
    { o: -1.0, y: H + 0.05, c: scaleRGB(C.roof, 0.9), n: [-1, 0] },
  ]);
  // 살창 차양: 가장 긴 곧은 변을 따라 안쪽에 띄운 어두운 판, 윗면은 살 줄무늬
  let best: { x: number[]; z: number[]; nx: number[]; nz: number[]; L: number } | null = null;
  for (const run of pl.rings[0]) if (run.x.length === 2 && (!best || run.L > best.L)) best = run;
  if (!best || best.L < 20) return;
  const L = best.L * 0.55,
    ux = (best.x[1] - best.x[0]) / best.L,
    uz = (best.z[1] - best.z[0]) / best.L,
    nx = best.nx[0],
    nz = best.nz[0],
    cx = (best.x[0] + best.x[1]) / 2 - nx * 6,
    cz = (best.z[0] + best.z[1]) / 2 - nz * 6,
    D = 7,
    y0 = H + 1.6,
    y1 = y0 + 0.45;
  // 다리
  for (const s of [-0.45, 0, 0.45])
    for (const t of [-0.4, 0.4])
      clayBox(w, cx + ux * L * s + nx * D * t, H, cz + uz * L * s + nz * D * t, ux, uz, 0.45, y0 - H, 0.45, 0.08, C.slatDark);
  clayBox(w, cx, y0, cz, ux, uz, L, 0.3, D, 0.1, C.slatDark, C.slatDark);
  slats(w, cx, cz, ux, uz, L, D, y0 + 0.3, y1, C.slat, C.slatDark);
}

// 살 줄무늬 윗면: 짧은 축(깊이 D) 방향 살을 L 방향으로 0.7m마다 번갈아 칠한다
function slats(
  w: ClayWriter,
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  L: number,
  D: number,
  y0: number,
  y1: number,
  a: RGB,
  b: RGB,
) {
  const vx = -uz,
    vz = ux,
    n = Math.max(2, Math.round(L / 0.7));
  for (let k = 0; k < n; k++) {
    const s0 = -L / 2 + (k / n) * L,
      s1 = -L / 2 + ((k + 1) / n) * L,
      y = k % 2 ? y1 : y0 + (y1 - y0) * 0.4,
      c = k % 2 ? a : b,
      pts = [
        [s0, -D / 2],
        [s1, -D / 2],
        [s1, D / 2],
        [s0, D / 2],
      ].map(([s, t]) => w.v(cx + ux * s + vx * t, y, cz + uz * s + vz * t, 0, 1, 0, c));
    w.q(pts[0], pts[1], pts[2], pts[3]);
  }
}

// 점들에 맞는 원(최소제곱, Kåsa)
export function fitCircle(pts: [number, number][]) {
  if (pts.length < 3) return null;
  let mx = 0,
    mz = 0;
  for (const [x, z] of pts) {
    mx += x;
    mz += z;
  }
  mx /= pts.length;
  mz /= pts.length;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const [x, z] of pts) {
    const u = x - mx,
      v = z - mz;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const bu = 0.5 * (suuu + suvv),
    bv = 0.5 * (svvv + svuu),
    uc = (bu * svv - bv * suv) / det,
    vc = (bv * suu - bu * suv) / det,
    r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  return { x: mx + uc, z: mz + vc, r };
}

// 다각형에서 f(x, z) ≥ 0인 쪽만 남긴다(서덜랜드-호지먼)
export function clipPoly(
  xs: number[],
  zs: number[],
  f: (x: number, z: number) => number,
) {
  const out: number[] = [],
    n = xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n,
      a = f(xs[i], zs[i]),
      b = f(xs[j], zs[j]);
    if (a >= 0) out.push(xs[i], zs[i]);
    if (a >= 0 !== b >= 0) {
      const t = a / (a - b);
      out.push(xs[i] + (xs[j] - xs[i]) * t, zs[i] + (zs[j] - zs[i]) * t);
    }
  }
  return out;
}

export type { Obb };
