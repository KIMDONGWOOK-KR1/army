import * as THREE from "three";
import {
  cap,
  chunkGeometry,
  ClayWriter,
  clayBox,
  clayCylinder,
  clayLift,
  clayMaterial,
  cleanRing,
  isPhoneView,
  mixRGB,
  profile,
  rgb,
  roundRing,
  scaleRGB,
  WIN,
  winCode,
  worldMaterial,
  type ClayChunk,
  type Level,
  type RGB,
  type Ring,
} from "./field-clay";
import {
  frontOf,
  hash,
  insidePoly,
  type FieldCtx,
  type Front,
  type MapBuilding,
  type MapData,
  type MapRoad,
  type Updater,
} from "./field-geom";
import {
  LANDMARK_SLOTS,
  landmarkMatrix,
  slotParts,
  type LandmarkSlot,
} from "./field-landmark-slots";
import { loadLandmarks } from "./field-assets";
import { calmZones, type CalmZone } from "./field-calm";
import { seeThrough } from "./field-occlusion";

// 지도 윤곽(OSM)으로 세우는 일반 건물: 모서리가 둥근 점토 덩어리.
// 멀리서는 포켓몬고 지도처럼 연한 지붕과 단정한 몸체로, 캐릭터 둘레에서는 받침·난간·현관·차양·
// 옥상 상자가 덧붙고 바닥에 접지 그늘이 깔려 손으로 빚은 작은 캠퍼스 마을이 된다.
// 몸체는 128m 구역마다 한 덩어리로 늘 그리고(화면 밖 구역은 그리지 않는다), 덧붙임은 캐릭터
// 둘레 64m 안 건물 것만 프레임마다 4ms 안에서 조금씩 만들어 한 덩어리로 잇는다(몸체는 갈아 끼우지
// 않으므로 멀어져도 튀지 않고, 받침·난간 같은 작은 것만 나타났다 사라진다).
// 창은 기하 없이 벽 셰이더(field-clay.ts)가 그린다. 용봉관·정보마루·민주마루·중앙도서관·대학본부는
// 따로 세우는 랜드마크 자리(field-landmark-slots.ts)다.

// 캠퍼스 평지붕 색
export const ROOF_COLOR = "#e4eaf6";

// 실제 높이(m) → 그리는 벽 높이(m). 24m까지는 0.9배, 그 위는 0.35배로 눌러 먼 아파트가 낮은
// 스카이라인으로 남게 한다(정확도 우선, 2026-10-07 결정). 가장 낮아도 3.2m.
export const renderHeight = (h: number) =>
  Math.max(3.2, h <= 24 ? 0.9 * h : 21.6 + 0.35 * (h - 24));

// 굽기 설정 style·campus로 더한 값
export type StyledBuilding = MapBuilding & {
  m?: "brick" | "white" | "glass" | "bands";
  win?: "ribbon";
  rr?: [number, number];
};
export type StyledMap = MapData & { campus?: number[] };

export type Kind =
  | "campus"
  | "brick"
  | "white"
  | "bands"
  | "glass"
  | "house"
  | "shop"
  | "apartment"
  | "small"
  | "greenhouse";
export type RoofKind = "flat" | "hip" | "pillow" | "gable";

// 건물의 주축 상자(주성분 방향): 가운데, 긴 축 방향(ux, uz), 반 길이 a ≥ b
export type Obb = { cx: number; cz: number; ux: number; uz: number; a: number; b: number };

export type Plan = {
  b: StyledBuilding;
  kind: Kind;
  roof: RoofKind;
  H: number; // 벽 꼭대기(m)
  rows: number; // 창 줄 수(층)
  code: number; // 벽 무늬(aWin.w)
  wall: RGB;
  roofC: RGB;
  trim: RGB; // 지붕 가장자리·난간 갓돌
  plinth: RGB;
  parapet: number; // 가까이 덧붙이는 난간 높이(0 = 없음)
  rings: Ring[]; // [바깥, …구멍]
  r: number; // 평면 모서리 반지름
  rt: number; // 윗모서리 모따기
  obb: Obb;
  area: number;
  fill: number; // 넓이 ÷ 주축 상자 넓이
  convex: number; // 넓이 ÷ 볼록 껍질 넓이
  calm: boolean; // 5·18 조용한 구역 안
  campus: boolean; // 캠퍼스 경계 안
  h: number; // 이 건물 hash
};

// ── 색 ──────────────────────────────────────────────
const P = {
  // 캠퍼스 벽: 크림 #ebe2cf와 회백 #dfe4ea 반반(스타일 시트 6번 색, 비율은 리뷰 2026-10-07)
  campus: [rgb("#ebe2cf"), rgb("#dfe4ea")],
  brick: rgb("#c8805f"),
  white: rgb("#f2f0ea"),
  bands: rgb("#f6f4ee"),
  glass: rgb("#8fbfd9"),
  house: [
    rgb("#c8805f"),
    rgb("#c8805f"),
    rgb("#c8805f"),
    rgb("#f3cfb5"),
    rgb("#f3cfb5"),
    rgb("#f4e4ad"),
    rgb("#f4e4ad"),
    rgb("#d2e0f0"),
    rgb("#f3ead6"),
    rgb("#f3ead6"),
  ],
  apart: rgb("#f3ead6"),
  smallIn: rgb("#ece6da"),
  smallOut: rgb("#f3ead6"),
  greenhouse: rgb("#cfeee6"),
  roof: rgb(ROOF_COLOR),
  roofWhite: rgb("#eceeee"),
  roofGreen: rgb("#5fa68f"),
  roofGrey: rgb("#c9ccd3"),
  terracotta: rgb("#d8785a"),
  slate: rgb("#6f87aa"),
  pillow: [rgb("#e39a7c"), rgb("#8fc9b0"), rgb("#b9c4d8")],
  cream: rgb("#fff6e2"),
  trimWhite: rgb("#fbf7ee"),
  granite: rgb("#d9d0c0"),
  stepStone: rgb("#e2dacb"),
  doorGlass: rgb("#3f5f8e"),
  under: rgb("#e3d6bd"),
  tank: rgb("#6f87aa"),
};

// ── 윤곽 재기 ───────────────────────────────────────
export function obbOf(p: number[]): Obb {
  const n = p.length / 2;
  let mx = 0,
    mz = 0;
  for (let i = 0; i < p.length; i += 2) {
    mx += p[i];
    mz += p[i + 1];
  }
  mx /= n;
  mz /= n;
  let sxx = 0,
    szz = 0,
    sxz = 0;
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - mx,
      dz = p[i + 1] - mz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ux = Math.cos(ang),
    uz = Math.sin(ang),
    a0 = Infinity,
    a1 = -Infinity,
    b0 = Infinity,
    b1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - mx,
      dz = p[i + 1] - mz,
      s = dx * ux + dz * uz,
      t = -dx * uz + dz * ux;
    a0 = Math.min(a0, s);
    a1 = Math.max(a1, s);
    b0 = Math.min(b0, t);
    b1 = Math.max(b1, t);
  }
  let a = (a1 - a0) / 2,
    b = (b1 - b0) / 2;
  const cx = mx + ux * ((a0 + a1) / 2) - uz * ((b0 + b1) / 2),
    cz = mz + uz * ((a0 + a1) / 2) + ux * ((b0 + b1) / 2);
  if (b > a) {
    [a, b] = [b, a];
    [ux, uz] = [-uz, ux];
  }
  return { cx, cz, ux, uz, a, b };
}
function polyArea(p: number[]) {
  let s = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    s += p[j] * p[i + 1] - p[i] * p[j + 1];
  return Math.abs(s) / 2;
}
function hullArea(p: number[]) {
  const pts: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [],
    upper: [number, number][] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
  return polyArea(hull);
}
// 점에서 꺾은선들까지 가장 가까운 거리
export function distToLines(lines: readonly number[][], x: number, z: number) {
  let d = Infinity;
  for (const p of lines)
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2],
        az = p[i - 1],
        dx = p[i] - ax,
        dz = p[i + 1] - az,
        L2 = dx * dx + dz * dz,
        t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
  return d;
}

// ── 분류 ────────────────────────────────────────────
const SHED = new Set(["roof", "kiosk", "shed", "garage", "garages", "hut", "cabin", "toilets", "carport", "service"]);
const CAMPUS_T = new Set(["university", "college", "school", "public", "office", "dormitory", "kindergarten", "government", "hospital", "civic"]);

// 건물 분류. 확인한 재질(m)이 먼저, 그다음 모양과 OSM building 값, 캠퍼스 안팎, 차도 가까움 차례로 본다.
export function classify(
  b: StyledBuilding,
  area: number,
  inCampus: boolean,
  nearCar: boolean,
): Kind {
  if (b.m) return b.m;
  if (b.t === "greenhouse") return "greenhouse";
  if (SHED.has(b.t ?? "") || area < 40 || b.h <= 4.5) return "small";
  if (b.t === "apartments" || (b.h >= 28 && !inCampus)) return "apartment";
  if (CAMPUS_T.has(b.t ?? "") || inCampus) return "campus";
  if (b.t === "commercial" || b.t === "retail" || nearCar) return "shop";
  return "house";
}

// 둥근 단층 건물: 넓이 200m² 넘고, 볼록하고(볼록 껍질 대비 0.95 넘음), 주축 상자를 원처럼
// 덜 채운다(π/4 ≈ 0.79 안팎, 0.86 아래). 작은 창고처럼 칠하지 않는다.
export const roundPavilion = (area: number, fill: number, convex: number) =>
  area >= 200 && convex > 0.95 && fill < 0.86;

// 창 줄 수: 층수를 알면 층수, 모르면 실제 높이 ÷ 3.4. 줄 간격이 너무 좁아지지 않게 줄인다.
function rowsOf(b: MapBuilding, kind: Kind, H: number) {
  if (kind === "apartment") return Math.max(3, b.lv ?? Math.round(b.h / 2.9));
  let r = b.lv ?? Math.max(1, Math.round(b.h / 3.4));
  if (kind === "house" || kind === "shop") r = Math.min(r, 4);
  return Math.max(1, Math.min(r, Math.floor((H - 1.1) / 2.2)));
}

export type PlanCtx = {
  campus: number[] | null;
  carRoads: readonly MapRoad[];
  calm: CalmZone[]; // 5·18 조용한 구역(차양 강조색·상가 표지를 쓰지 않는다)
};
export function planCtx(data: StyledMap): PlanCtx {
  return {
    campus: data.campus && data.campus.length >= 6 ? data.campus : null,
    carRoads: data.roads.filter((r) => r.k === 0),
    calm: calmZones(data),
  };
}

// 건물 하나를 어떻게 빚을지 정한다(형상은 아직 만들지 않는다).
export function planBuilding(b: StyledBuilding, ctx: PlanCtx): Plan | null {
  const outer = cleanRing(b.p, false, b.rr ? b.rr[0] : -1);
  if (outer.x.length < 3 || outer.area < 1) return null;
  const obb = obbOf(b.p),
    area = outer.area,
    fill = area / Math.max(1e-6, 4 * obb.a * obb.b),
    convex = area / Math.max(1e-6, hullArea(b.p)),
    h = hash(b.id),
    cx = obb.cx,
    cz = obb.cz;
  const inCampus = ctx.campus ? insidePoly(ctx.campus, cx, cz) : cz < 0;
  const nearCar = !inCampus && distToLines(ctx.carRoads.map((r) => r.p), cx, cz) < 25 + obb.b;
  const kind = classify(b, area, inCampus, nearCar);
  const H = renderHeight(b.h),
    rows = rowsOf(b, kind, H),
    k = 0.97 + ((h >>> 8) % 7) / 100;
  let wall: RGB,
    roofC: RGB = scaleRGB(P.roof, 0.97 + ((h >>> 4) % 7) / 100),
    trim: RGB = P.cream,
    plinth: RGB = P.granite,
    style: number = WIN.CAMPUS,
    roof: RoofKind = "flat",
    parapet = 0.45;
  switch (kind) {
    case "campus":
      wall = scaleRGB(P.campus[h % 10 < 5 ? 0 : 1], k);
      break;
    case "brick":
      wall = scaleRGB(P.brick, 0.98 + (h % 5) / 100);
      trim = P.trimWhite;
      style = b.win === "ribbon" ? WIN.BRICK_RIBBON : WIN.BRICK;
      break;
    case "white":
      wall = P.white;
      trim = P.trimWhite;
      roofC = P.roofWhite;
      style = b.win === "ribbon" ? WIN.WHITE_RIBBON : WIN.CAMPUS;
      break;
    case "bands":
      wall = P.bands;
      trim = P.trimWhite;
      roofC = P.roofWhite;
      style = WIN.BANDS;
      break;
    case "glass":
      wall = P.glass;
      trim = P.trimWhite;
      style = WIN.CURTAIN;
      parapet = 0.25;
      break;
    case "apartment":
      wall = scaleRGB(P.apart, k);
      style = WIN.APART;
      parapet = 0.6;
      break;
    case "greenhouse":
      wall = P.greenhouse;
      roofC = P.greenhouse;
      trim = P.trimWhite;
      style = WIN.GREENHOUSE;
      roof = "gable";
      parapet = 0;
      break;
    case "small":
      wall = scaleRGB(inCampus ? P.smallIn : P.smallOut, k);
      roofC = inCampus ? roofC : P.pillow[h % 3];
      plinth = scaleRGB(wall, 0.82);
      if (roundPavilion(area, fill, convex)) {
        // 둥근 단층 건물(정문 동쪽 원형 건물 w1374639828 등): 캠퍼스 낱창 한 줄과 크림 난간 테
        style = WIN.CAMPUS;
        roof = "flat";
        parapet = 0.45;
        break;
      }
      style = area >= 80 ? WIN.HOUSE : WIN.PLAIN; // 단층 큰 것은 작은 낱창 한 줄
      roof = convex > 0.9 && area < 150 ? "pillow" : "flat";
      parapet = 0;
      break;
    default: {
      // 주택·상가: 벽은 파스텔(30%는 벽돌), 지붕은 초록 방수 옥상 70% / 회색 30%,
      // 반듯한 작은 집 40%는 모임지붕(테라코타·청회)
      wall = scaleRGB(P.house[h % 10], k);
      plinth = scaleRGB(wall, 0.8);
      roofC = (h >>> 3) % 10 < 7 ? P.roofGreen : P.roofGrey;
      style = kind === "shop" ? WIN.SHOP : WIN.HOUSE;
      parapet = kind === "shop" ? 0.35 : 0.4;
      const hv = (h >>> 5) % 10;
      if (kind === "house" && area < 160 && fill >= 0.85 && hv < 4) {
        roof = "hip";
        roofC = hv % 2 ? P.terracotta : P.slate;
        parapet = 0;
      } else if (kind === "house" && area < 120 && convex > 0.92 && hv === 4) {
        roof = "pillow";
        roofC = P.pillow[h % 3];
        parapet = 0;
      }
    }
  }
  const rc = Math.min(1.6, Math.max(0.4, 0.12 * obb.b)); // 0.06 × 짧은 변
  let rt = Math.min(0.8, Math.max(0.25, 0.05 * H), rc * 0.85);
  if (roof !== "flat") rt = 0;
  const big = b.rr
    ? { i: outer.orig.indexOf(b.rr[0]), r: b.rr[1], seg: 7 }
    : undefined;
  const rings: Ring[] = [
    roundRing(outer.x, outer.z, { r: rc, seg: 2, big: big && big.i >= 0 ? big : undefined }),
  ];
  for (const hole of b.holes ?? []) {
    const c = cleanRing(hole, true);
    if (c.x.length >= 3) rings.push(roundRing(c.x, c.z, { r: Math.min(rc, 0.8), seg: 2 }));
  }
  const calm = ctx.calm.some((c) => Math.hypot(c.x - cx, c.z - cz) < c.r + obb.a);
  return {
    b,
    kind,
    roof,
    H,
    rows,
    code: winCode(style, rows),
    wall,
    roofC,
    trim,
    plinth,
    parapet,
    rings,
    r: rc,
    rt,
    obb,
    area,
    fill,
    convex,
    calm,
    campus: inCampus,
    h,
  };
}

// ── 몸체(멀리서도 늘 그린다) ─────────────────────────
export function bodyParts(w: ClayWriter, pl: Plan) {
  const { H, rt, wall, roofC, trim, code } = pl,
    [outer, ...holes] = pl.rings;
  if (pl.roof === "flat") {
    for (const ring of pl.rings)
      profile(w, ring, [
        { o: 0, y: 0, c: wall, code, H },
        { o: 0, y: H - rt, c: wall },
        { o: -rt, y: H, c: trim },
      ]);
    cap(w, outer, -rt, H, roofC, true, holes);
    return;
  }
  for (const ring of pl.rings)
    profile(w, ring, [
      { o: 0, y: 0, c: wall, code, H },
      { o: 0, y: H, c: wall },
    ]);
  if (pl.roof === "pillow") {
    const d = Math.min(1.1, 0.3 * pl.obb.b),
      hp = 0.9 + ((pl.h >>> 6) % 5) / 10;
    profile(w, outer, [
      { o: 0, y: H, c: roofC, n: [1, 0.15] },
      { o: -0.38 * d, y: H + 0.62 * hp, c: roofC, n: [0.72, 0.7] },
      { o: -d, y: H + hp, c: scaleRGB(roofC, 1.05), n: [0.18, 1] },
    ]);
    cap(w, outer, -d, H + hp, scaleRGB(roofC, 1.05));
    return;
  }
  pitchedRoof(w, pl, pl.roof === "hip");
}

// 주축 상자 위에 얹는 모임지붕(hip, 경사 30°) 또는 맞배지붕(gable, 온실 25°)
function pitchedRoof(w: ClayWriter, pl: Plan, hip: boolean) {
  const { cx, cz, ux, uz } = pl.obb,
    eave = hip ? 0.4 : 0.2,
    A = pl.obb.a + eave,
    B = pl.obb.b + eave,
    th = hip ? 0.3 : 0.15,
    y0 = pl.H,
    y1 = y0 + th,
    rise = hip ? Math.min(0.577 * B, 3.2) : Math.tan((25 * Math.PI) / 180) * B,
    yr = y1 + rise,
    rl = hip ? Math.max(0, A - B) : A,
    vx = -uz,
    vz = ux;
  const at = (s: number, t: number, y: number) =>
    [cx + ux * s + vx * t, y, cz + uz * s + vz * t] as const;
  const fascia = hip ? P.cream : P.trimWhite,
    roofLo = scaleRGB(pl.roofC, 0.94),
    roofHi = scaleRGB(pl.roofC, 1.06);
  // 처마 끝 띠와 처마 밑
  const corners: [number, number][] = [
    [-A, -B],
    [A, -B],
    [A, B],
    [-A, B],
  ];
  for (let k = 0; k < 4; k++) {
    const [s0, t0] = corners[k],
      [s1, t1] = corners[(k + 1) % 4],
      ms = (s0 + s1) / 2,
      mt = (t0 + t1) / 2,
      l = Math.hypot(ms, mt) || 1,
      nx = (ux * ms + vx * mt) / l,
      nz = (uz * ms + vz * mt) / l;
    const p0 = at(s0, t0, y0),
      p1 = at(s1, t1, y0),
      p2 = at(s1, t1, y1),
      p3 = at(s0, t0, y1);
    const a = w.v(p0[0], p0[1], p0[2], nx, 0, nz, fascia),
      b = w.v(p1[0], p1[1], p1[2], nx, 0, nz, fascia),
      c = w.v(p2[0], p2[1], p2[2], nx, 0, nz, fascia),
      d = w.v(p3[0], p3[1], p3[2], nx, 0, nz, fascia);
    w.q(a, b, c, d);
  }
  const under = corners.map(([s, t]) => {
    const p = at(s, t, y0);
    return w.v(p[0], p[1], p[2], 0, -1, 0, P.under);
  });
  w.q(under[0], under[1], under[2], under[3]);
  // 지붕면: 면마다 평평한 법선
  const face = (pts: (readonly [number, number, number])[], cols: RGB[]) => {
    const [a, b, c] = pts,
      ux1 = b[0] - a[0],
      uy1 = b[1] - a[1],
      uz1 = b[2] - a[2],
      vx1 = c[0] - a[0],
      vy1 = c[1] - a[1],
      vz1 = c[2] - a[2];
    let nx = uy1 * vz1 - uz1 * vy1,
      ny = uz1 * vx1 - ux1 * vz1,
      nz = ux1 * vy1 - uy1 * vx1;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const ids = pts.map((p, k) => w.v(p[0], p[1], p[2], nx, ny, nz, cols[k]));
    w.t(ids[0], ids[1], ids[2]);
    if (ids.length === 4) w.t(ids[0], ids[2], ids[3]);
  };
  const r0 = at(-rl, 0, yr),
    r1 = at(rl, 0, yr),
    c0 = at(-A, -B, y1),
    c1 = at(A, -B, y1),
    c2 = at(A, B, y1),
    c3 = at(-A, B, y1);
  face([c0, c1, r1, r0], [roofLo, roofLo, roofHi, roofHi]);
  face([c2, c3, r0, r1], [roofLo, roofLo, roofHi, roofHi]);
  if (hip) {
    face([c3, c0, r0], [roofLo, roofLo, roofHi]);
    face([c1, c2, r1], [roofLo, roofLo, roofHi]);
  } else {
    // 맞배 끝의 세모 벽(유리)
    for (const [p, q, r] of [
      [c3, c0, r0],
      [c1, c2, r1],
    ]) {
      const s = p === c3 ? -1 : 1,
        ids = [p, q, r].map((v) => w.v(v[0], v[1], v[2], ux * s, 0, uz * s, pl.wall));
      w.t(ids[0], ids[1], ids[2]);
    }
  }
}

// ── 덧붙임(캐릭터 가까이에서만) ──────────────────────
export type NearCtx = {
  roads: readonly MapRoad[];
  carRoads: readonly MapRoad[];
  legs: readonly number[][];
  entrances: Map<string, Front>;
};

const CAMPUS_LIKE = new Set<Kind>(["campus", "brick", "white", "bands", "glass", "apartment"]);

export function nearParts(w: ClayWriter, pl: Plan, ctx: NearCtx) {
  const { H, rt, wall, roofC, trim } = pl,
    [outer, ...holes] = pl.rings;
  // 받침: 바깥으로 0.14m 내민 화강석·벽색 띠
  if (pl.kind !== "small" && pl.kind !== "greenhouse")
    for (const ring of pl.rings)
      profile(w, ring, [
        { o: 0.14, y: 0, c: pl.plinth, n: [1, 0] },
        { o: 0.14, y: 0.5, c: pl.plinth, n: [0.85, 0.5] },
        { o: 0.02, y: 0.62, c: scaleRGB(pl.plinth, 1.04), n: [0.3, 1] },
      ]);
  // 난간: 벽 꼭대기에서 바깥으로 말려 나와 갓돌을 두르고 안쪽 옥상판으로 내려간다
  if (pl.roof === "flat" && pl.parapet > 0) {
    const ph = pl.parapet,
      base = H - rt - 0.06,
      inner = -Math.min(0.26, pl.r * 0.6),
      roofIn = scaleRGB(roofC, 0.9),
      // 6단(띠 5개): 말려 나오는 아랫면, 바깥 면, 둥근 갓돌, 안쪽 면
      lv: Level[] = [
        { o: 0.02, y: base, c: wall, n: [0.6, -0.8] },
        { o: 0.26, y: Math.min(base + 0.22, H + ph - 0.24), c: wall, n: [1, -0.1] },
        { o: 0.26, y: H + ph - 0.12, c: trim, n: [0.85, 0.52] },
        { o: 0.08, y: H + ph, c: trim, n: [0.1, 1] },
        { o: inner, y: H + ph - 0.1, c: roofIn, n: [-0.9, 0.4] },
        { o: inner, y: H + 0.18, c: roofIn, n: [-1, 0] },
      ];
    for (const ring of pl.rings) profile(w, ring, lv);
    cap(w, outer, inner, H + 0.18, roofC, true, holes);
    // 옥상 계단실·물탱크
    const { cx, cz, ux, uz, a } = pl.obb;
    if (CAMPUS_LIKE.has(pl.kind) && pl.area > 800 && pl.kind !== "bands") {
      const big = pl.kind === "apartment",
        s = big ? 4 : 2.6;
      clayBox(w, cx + ux * a * 0.25, H + 0.18, cz + uz * a * 0.25, ux, uz, s, big ? 2.4 : 1.7, s, 0.3, wall, roofC);
    } else if (pl.kind === "house" && (pl.h >>> 9) % 10 < 3 && pl.obb.b > 2.2)
      clayCylinder(w, cx - ux * a * 0.3, cz - uz * a * 0.3, 0.8, H + 0.18, H + 1.5, 10, P.tank, scaleRGB(P.tank, 1.12), 0.12);
  }
  // 현관
  if (CAMPUS_LIKE.has(pl.kind) && pl.area >= 120) {
    const f = ctx.entrances.get(pl.b.id) ?? frontOf(pl.b, ctx.roads);
    campusDoor(w, pl, f, ctx);
  } else if (pl.kind === "shop" && pl.area >= 40) shopFront(w, pl, ctx);
  else if (pl.kind === "house" && pl.area >= 40)
    houseDoor(w, pl, ctx.entrances.get(pl.b.id) ?? frontOf(pl.b, ctx.roads, 40), ctx);
}

// 문 자리(벽 위 한 점과 바깥 방향)에서 바깥으로 s, 벽을 따라 t만큼 간 점
const along = (f: Front, s: number, t: number) => {
  const nx = Math.sin(f.ry),
    nz = Math.cos(f.ry);
  return [f.x + nx * s + nz * t, f.z + nz * s - nx * t] as const;
};
// 시연 경로 중심선 2m 안에는 차양·계단을 두지 않는다
const clearOfRoute = (ctx: NearCtx, x: number, z: number, r: number) =>
  distToLines(ctx.legs, x, z) > 2 + r;

function campusDoor(w: ClayWriter, pl: Plan, f: Front, ctx: NearCtx) {
  const nx = Math.sin(f.ry),
    nz = Math.cos(f.ry),
    tx = nz,
    tz = -nx,
    dw = 3.2,
    dh = Math.min(4.0, pl.H * 0.45),
    frame = pl.kind === "brick" ? P.trimWhite : P.cream;
  const box = (s: number, t: number, y0: number, sx: number, sy: number, sz: number, c: RGB, top: RGB = c) => {
    const [x, z] = along(f, s, t);
    clayBox(w, x, y0, z, tx, tz, sx, sy, sz, 0.08, c, top);
  };
  box(0.02, 0, 0.5, dw, dh, 0.3, P.doorGlass);
  box(0.12, -(dw / 2 + 0.15), 0.5, 0.3, dh + 0.1, 0.42, frame);
  box(0.12, dw / 2 + 0.15, 0.5, 0.3, dh + 0.1, 0.42, frame);
  box(0.12, 0, 0.5 + dh, dw + 0.6, 0.3, 0.42, frame);
  const [cxp, czp] = along(f, 1.1, 0);
  if (clearOfRoute(ctx, cxp, czp, 1.5)) {
    box(1.1, 0, 0.6 + dh + 0.4, dw + 1.6, 0.35, 2.1, P.under, P.cream);
    box(1.0, 0, 0, dw + 2.0, 0.25, 2.0, P.stepStone);
    box(0.55, 0, 0.25, dw + 2.0, 0.25, 1.1, P.stepStone);
  }
}

function houseDoor(w: ClayWriter, pl: Plan, f: Front, ctx: NearCtx) {
  const nx = Math.sin(f.ry),
    nz = Math.cos(f.ry),
    tx = nz,
    tz = -nx,
    door = pl.roof === "hip" ? pl.roofC : P.slate;
  const box = (s: number, t: number, y0: number, sx: number, sy: number, sz: number, c: RGB, top: RGB = c) => {
    const [x, z] = along(f, s, t);
    clayBox(w, x, y0, z, tx, tz, sx, sy, sz, 0.08, c, top);
  };
  box(0.08, 0, 0.45, 1.8, Math.min(3.0, pl.H * 0.5), 0.3, door);
  const [cxp, czp] = along(f, 0.6, 0);
  if (clearOfRoute(ctx, cxp, czp, 1))
    box(0.6, 0, Math.min(3.0, pl.H * 0.5) + 0.65, 2.6, 0.24, 1.1, P.under, P.cream);
}

// 상가: 차도를 보는 벽 전체에 줄무늬 차양과 빈 크림 간판 띠(실제 상호·글자는 넣지 않는다)
function shopFront(w: ClayWriter, pl: Plan, ctx: NearCtx) {
  const ring = pl.rings[0];
  let best = -1,
    score = -Infinity;
  ring.forEach((run, k) => {
    if (run.x.length !== 2 || run.L < 3.5) return;
    const mx = (run.x[0] + run.x[1]) / 2,
      mz = (run.z[0] + run.z[1]) / 2,
      d = distToLines(ctx.carRoads.map((r) => r.p), mx + run.nx[0] * 3, mz + run.nz[0] * 3),
      s = run.L * 0.2 - d;
    if (s > score) {
      score = s;
      best = k;
    }
  });
  if (best < 0 || pl.H < 5) return;
  const run = ring[best],
    nx = run.nx[0],
    nz = run.nz[0],
    dx = (run.x[1] - run.x[0]) / run.L,
    dz = (run.z[1] - run.z[0]) / run.L,
    m = 0.4,
    L = run.L - 2 * m,
    x0 = run.x[0] + dx * m,
    z0 = run.z[0] + dz * m,
    depth = 1.4,
    yTop = 3.35,
    yLow = yTop - depth * Math.tan((15 * Math.PI) / 180),
    acc = pl.calm ? 4 : (pl.h >>> 11) % 4,
    code = winCode(WIN.AWNING, acc);
  const midX = x0 + dx * L * 0.5 + nx * depth,
    midZ = z0 + dz * L * 0.5 + nz * depth;
  if (!clearOfRoute(ctx, midX, midZ, 0.5)) return;
  const pt = (u: number, out: number, y: number) => [x0 + dx * u + nx * out, y, z0 + dz * u + nz * out] as const;
  const quad = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    n: readonly number[],
    ua: number,
    ub: number,
    col: RGB,
    cd: number,
  ) => {
    const ids = [
      [a, ua],
      [b, ub],
      [c, ub],
      [d, ua],
    ].map(([p, u]) => {
      const q = p as readonly number[];
      return w.v(q[0], q[1], q[2], n[0], n[1], n[2], col, u as number, L, 0, cd);
    });
    w.q(ids[0], ids[1], ids[2], ids[3]);
  };
  const slope = [nx * 0.26, 0.97, nz * 0.26];
  // 윗면(바깥으로 15° 처짐), 앞 드림, 밑면
  quad(pt(0, 0.05, yTop), pt(L, 0.05, yTop), pt(L, depth, yLow), pt(0, depth, yLow), slope, 0, L, P.cream, code);
  quad(pt(0, depth, yLow), pt(L, depth, yLow), pt(L, depth, yLow - 0.32), pt(0, depth, yLow - 0.32), [nx, 0, nz], 0, L, P.cream, code);
  quad(pt(0, depth, yLow - 0.32), pt(L, depth, yLow - 0.32), pt(L, 0.05, yTop - 0.3), pt(0, 0.05, yTop - 0.3), [0, -1, 0], 0, L, P.under, WIN.NONE);
  // 차양 끝 옆판
  for (const u of [0, L]) {
    const s = u === 0 ? -1 : 1,
      n = [dx * s, 0, dz * s],
      a = pt(u, 0.05, yTop),
      b = pt(u, depth, yLow),
      c = pt(u, depth, yLow - 0.32),
      d = pt(u, 0.05, yTop - 0.3),
      ids = [a, b, c, d].map((p) => w.v(p[0], p[1], p[2], n[0], n[1], n[2], P.cream));
    w.q(ids[0], ids[1], ids[2], ids[3]);
  }
  // 빈 간판 띠
  if (pl.H > 5.2) {
    const mx = x0 + dx * L * 0.5 + nx * 0.1,
      mz = z0 + dz * L * 0.5 + nz * 0.1;
    clayBox(w, mx, yTop + 0.25, mz, dx, dz, L * 0.9, 0.9, 0.24, 0.08, P.cream);
  }
}

// ── 접지 그늘 띠(캐릭터 가까이만) ─────────────────────
export class SkirtWriter {
  p: number[] = [];
  c: number[] = [];
  i: number[] = [];
}
const SKIRT = { width: 1.6, alpha: 0.22, y: 0.31 };
const SHADOW_TINT = rgb("#1f2a44");
export function skirtParts(s: SkirtWriter, pl: Plan) {
  const ring = pl.rings[0],
    w = pl.roof === "flat" ? SKIRT.width : SKIRT.width * 0.8;
  let prevIn = -1,
    prevOut = -1,
    firstIn = -1,
    firstOut = -1;
  for (const run of ring)
    for (let k = 0; k < run.x.length; k++) {
      if (k === 0 && prevIn >= 0) continue; // 줄기 끝점은 다음 줄기 첫 점과 같다
      const base = s.p.length / 3;
      s.p.push(run.x[k], SKIRT.y, run.z[k], run.x[k] + run.nx[k] * w, SKIRT.y, run.z[k] + run.nz[k] * w);
      s.c.push(...SHADOW_TINT, SKIRT.alpha, ...SHADOW_TINT, 0);
      if (prevIn >= 0) s.i.push(prevIn, base, prevOut, prevOut, base, base + 1);
      else {
        firstIn = base;
        firstOut = base + 1;
      }
      prevIn = base;
      prevOut = base + 1;
    }
  if (prevIn >= 0 && firstIn >= 0 && prevIn !== firstIn)
    s.i.push(prevIn, firstIn, prevOut, prevOut, firstIn, firstOut);
}

// ── 구역과 캐시 ─────────────────────────────────────
export const TILE = 128; // 몸체 구역 한 변(m)
const NEAR_ON = 64, // 건물 윤곽 상자까지 이보다 가까우면 덧붙임을 켠다
  NEAR_OFF = 78, // 이보다 멀어지면 끈다(히스테리시스)
  PREFETCH = 96, // 이 안의 건물은 덧붙임을 미리 만들어 둔다
  EVICT = 180, // 이보다 먼 건물의 덧붙임 조각은 버린다(메모리)
  MOVE_M = 3, // 캐릭터가 이만큼 움직이면 고르기를 다시 한다
  SLICE_MS = 4; // 프레임마다 덧붙임을 만드는 데 쓰는 시간

type SkirtData = { p: Float32Array; c: Uint8Array; i: number[] };
type TileRec = { i: number; j: number; plans: Plan[]; body: THREE.BufferGeometry | null };
// 건물 하나의 가까이 덧붙임 조각(만들기 전에는 null)
type NearRec = {
  pl: Plan;
  near: ClayChunk | null;
  skirt: SkirtData | null;
  d: number;
  part?: ClayChunk | null; // 걸음으로 나눠 만들 때 먼저 만든 덧붙임 조각
};
type SlotRec = {
  slot: LandmarkSlot;
  plan: Plan;
  geo: THREE.BufferGeometry;
  skirt: SkirtData;
};
type Cache = {
  tiles: TileRec[];
  recs: NearRec[];
  slots: SlotRec[];
  nearCtx: NearCtx;
  stats: { bodyTris: number; buildMs: number };
};
const caches = new WeakMap<MapData, Cache>();

const shared = (g: THREE.BufferGeometry) => {
  g.userData.shared = true; // 화면을 다시 열 때도 쓰므로 정리할 때 지우지 않는다
  return g;
};
function skirtData(s: SkirtWriter): SkirtData {
  return {
    p: new Float32Array(s.p),
    c: Uint8Array.from(s.c, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)),
    i: s.i,
  };
}

// 점에서 건물 주축 상자까지 거리(안이면 0)
export function obbDist(o: Obb, x: number, z: number) {
  const dx = x - o.cx,
    dz = z - o.cz,
    s = Math.abs(dx * o.ux + dz * o.uz) - o.a,
    t = Math.abs(-dx * o.uz + dz * o.ux) - o.b;
  return Math.hypot(Math.max(s, 0), Math.max(t, 0));
}

// 출입구(OSM entrance)를 그 문이 붙은 건물에 묶는다
function entranceMap(data: MapData, plans: Plan[]) {
  const out = new Map<string, Front>();
  for (const e of data.pois ?? []) {
    if (e.k !== "entrance") continue;
    let best: Plan | null = null,
      bd = 1.5;
    for (const pl of plans) {
      const { cx, cz, a } = pl.obb;
      if (Math.abs(e.x - cx) > a + 3 || Math.abs(e.z - cz) > a + 3) continue;
      const d = distToLines([[...pl.b.p, pl.b.p[0], pl.b.p[1]]], e.x, e.z);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    if (best && !out.has(best.b.id)) out.set(best.b.id, { x: e.x, z: e.z, ry: e.a });
  }
  return out;
}

export function buildingCache(data: MapData): Cache {
  let c = caches.get(data);
  if (c) return c;
  const t0 = performance.now(),
    ctx = planCtx(data as StyledMap),
    slotOfId = new Map(LANDMARK_SLOTS.map((s) => [s.osmId, s])),
    tiles = new Map<string, TileRec>(),
    plans: Plan[] = [],
    recs: NearRec[] = [],
    slotPlans: [LandmarkSlot, Plan][] = [];
  for (const b of data.buildings as StyledBuilding[]) {
    const slot = slotOfId.get(b.id);
    if (slot?.external) continue; // 용봉관은 field-map.ts의 블렌더 모형이 선다
    const pl = planBuilding(b, ctx);
    if (!pl) continue;
    plans.push(pl);
    if (slot) {
      slotPlans.push([slot, pl]);
      continue;
    }
    const i = Math.floor(pl.obb.cx / TILE),
      j = Math.floor(pl.obb.cz / TILE),
      key = `${i},${j}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { i, j, plans: [], body: null }));
    t.plans.push(pl);
    recs.push({ pl, near: null, skirt: null, d: Infinity });
  }
  const nearCtx: NearCtx = {
    roads: data.roads,
    carRoads: ctx.carRoads,
    legs: data.legs,
    entrances: entranceMap(data, plans),
  };
  let bodyTris = 0;
  for (const t of tiles.values()) {
    const w = new ClayWriter();
    for (const pl of t.plans) bodyParts(w, pl);
    bodyTris += w.triangles;
    t.body = shared(w.geometry());
  }
  const slots: SlotRec[] = slotPlans.map(([slot, pl]) => {
    const w = new ClayWriter(),
      s = new SkirtWriter();
    slotParts(slot, pl, w, data, {
      body: (p) => bodyParts(w, p),
      near: (p) => nearParts(w, p, nearCtx),
      plan: (b) => planBuilding(b, ctx),
    });
    skirtParts(s, pl);
    bodyTris += w.triangles;
    return { slot, plan: pl, geo: shared(w.geometry()), skirt: skirtData(s) };
  });
  c = {
    tiles: [...tiles.values()],
    recs,
    slots,
    nearCtx,
    stats: { bodyTris, buildMs: performance.now() - t0 },
  };
  caches.set(data, c);
  if (process.env.NODE_ENV !== "production")
    console.info(
      "field buildings",
      plans.length,
      "in",
      c.tiles.length,
      "tiles, body triangles",
      bodyTris,
      `(${c.stats.buildMs.toFixed(0)} ms)`,
    );
  return c;
}

// 건물 하나의 덧붙임 조각과 접지 그늘을 만든다
export function buildNear(r: NearRec, ctx: NearCtx) {
  while (!buildNearStep(r, ctx));
}
// 같은 일을 두 걸음(덧붙임 조각 → 접지 그늘)으로 나눈다. 프레임마다 걸음 사이에 시간을 보고
// 멈출 수 있게 한다. 다 만들었으면 true.
export function buildNearStep(r: NearRec, ctx: NearCtx): boolean {
  if (r.near && r.skirt) return true;
  if (!r.part) {
    const w = new ClayWriter();
    nearParts(w, r.pl, ctx);
    r.part = w.chunk();
    return false;
  }
  const s = new SkirtWriter();
  skirtParts(s, r.pl);
  r.near = r.part;
  r.skirt = skirtData(s);
  r.part = null;
  return true;
}

function mergeSkirts(parts: readonly SkirtData[]) {
  const nv = parts.reduce((n, p) => n + p.p.length / 3, 0),
    pos = new Float32Array(nv * 3),
    col = new Uint8Array(nv * 4),
    idx = nv > 65535 ? new Uint32Array(parts.reduce((n, p) => n + p.i.length, 0)) : new Uint16Array(parts.reduce((n, p) => n + p.i.length, 0));
  let o = 0,
    oi = 0;
  for (const p of parts) {
    pos.set(p.p, o * 3);
    col.set(p.c, o * 4);
    for (let j = 0; j < p.i.length; j++) idx[oi + j] = p.i[j] + o;
    o += p.p.length / 3;
    oi += p.i.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 4, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export type Buildings = { update: Updater; group: THREE.Group };

// 개발 중에만: 건물이 실제로 그려진 수와 삼각형 수를 window.__fieldBuildingsProbe에 쌓는다
// (화면 밖 구역은 three가 건너뛰므로 셀 수 없다). frames로 나누면 한 장면당 값이 된다.
type Probe = { frame: number; frames: number; calls: number; tris: number; shadowCalls: number; shadowTris: number };
function devProbe(group: THREE.Group) {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  const w = window as unknown as { __fieldBuildingsProbe?: Probe },
    P = (w.__fieldBuildingsProbe ??= { frame: -1, frames: 0, calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 });
  const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  const tick = (r: THREE.WebGLRenderer) => {
    if (r.info.render.frame !== P.frame) {
      P.frame = r.info.render.frame;
      P.frames++;
    }
  };
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.probed) return;
    o.userData.probed = true;
    o.onBeforeRender = (r, _s, _c, g) => {
      tick(r);
      P.calls++;
      P.tris += tris(g);
    };
    o.onBeforeShadow = (r, _o, _c, _sc, g) => {
      tick(r);
      P.shadowCalls++;
      P.shadowTris += tris(g);
    };
  });
}

// 건물을 장면에 넣고, 캐릭터 자리에 맞춰 가까이 덧붙임과 접지 그늘을 고르는 함수를 돌려준다.
// 그리기 수: 몸체 구역(화면 안 것만) + 랜드마크 자리 4 + 덧붙임 1 + 접지 그늘 1.
export function buildBuildings(
  scene: THREE.Scene,
  data: MapData,
  ctx: FieldCtx,
): Buildings {
  // 나무 자리 막기(occ)는 field-map.ts가 건물 윤곽으로 이미 한다. 여기서는 폰 여부만 읽는다.
  const cache = buildingCache(data),
    phone = ctx.phone ?? isPhoneView(),
    material = seeThrough(clayMaterial(phone)),
    group = new THREE.Group();
  group.name = "buildings";
  scene.add(group);
  for (const t of cache.tiles) {
    if (!t.body) continue;
    const m = new THREE.Mesh(t.body, material);
    m.castShadow = m.receiveShadow = true;
    m.name = `bldg-${t.i},${t.j}`;
    group.add(m);
  }
  // 랜드마크 자리: 한 채씩 따로(블렌더 모형이 오면 숨기고 바꿔 세운다)
  const slotMeshes = new Map<string, THREE.Mesh>();
  for (const s of cache.slots) {
    const m = new THREE.Mesh(s.geo, material);
    m.castShadow = m.receiveShadow = true;
    m.name = `landmark-${s.slot.key}`;
    group.add(m);
    slotMeshes.set(s.slot.key, m);
  }
  loadLandmarks().then((list) => {
    if (!group.parent || !list.length) return; // 그사이 화면이 닫혔거나 모형이 없다
    // 코드 건물과 같은 점토 밝힘(clayLift) 위에 시야 구멍을 잇는다(patch 차례: 밝힘 → 구멍 → 테 빛)
    const clay = seeThrough(clayLift(worldMaterial(phone, 0.88)));
    for (const { entry, geometry } of list) {
      const s = cache.slots.find((r) => r.slot.key === entry.key),
        box = s?.slot.box ? data.boxes[s.slot.box] : undefined;
      if (!s || !box) continue;
      const m = new THREE.Mesh(geometry, clay);
      m.matrixAutoUpdate = false;
      m.matrix.copy(landmarkMatrix(geometry, box, entry));
      m.castShadow = m.receiveShadow = true;
      m.name = `landmark-glb-${entry.key}`;
      group.add(m);
      const old = slotMeshes.get(entry.key);
      if (old) old.visible = false;
    }
    devProbe(group);
  });

  // 가까이 덧붙임(한 덩어리)과 접지 그늘(한 덩어리)
  const nearMesh = new THREE.Mesh(new THREE.BufferGeometry(), material),
    skirtMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
  nearMesh.name = "bldg-near";
  nearMesh.castShadow = nearMesh.receiveShadow = true;
  nearMesh.visible = false;
  skirtMesh.name = "bldg-skirt";
  skirtMesh.renderOrder = 1;
  skirtMesh.visible = false;
  group.add(nearMesh, skirtMesh);

  let active = new Set<NearRec>(),
    slotOn = new Set<SlotRec>(),
    lastX = Infinity,
    lastZ = Infinity,
    dirty = false,
    held = false;
  const queue: NearRec[] = [];
  const rebuild = () => {
    const chunks: ClayChunk[] = [],
      skirts: SkirtData[] = [];
    for (const r of active)
      if (r.near && r.skirt) {
        if (r.near.i.length) chunks.push(r.near);
        skirts.push(r.skirt);
      }
    for (const s of slotOn) skirts.push(s.skirt);
    nearMesh.geometry.dispose();
    skirtMesh.geometry.dispose();
    nearMesh.geometry = chunks.length ? chunkGeometry(chunks) : new THREE.BufferGeometry();
    skirtMesh.geometry = skirts.length ? mergeSkirts(skirts) : new THREE.BufferGeometry();
    nearMesh.visible = chunks.length > 0;
    skirtMesh.visible = skirts.length > 0;
  };

  const update: Updater = (x, z) => {
    if (Math.hypot(x - lastX, z - lastZ) > MOVE_M) {
      lastX = x;
      lastZ = z;
      queue.length = 0;
      const next = new Set<NearRec>();
      for (const r of cache.recs) {
        const d = (r.d = obbDist(r.pl.obb, x, z));
        if (active.has(r) ? d < NEAR_OFF : d < NEAR_ON) next.add(r);
        if (d < PREFETCH && !r.near) queue.push(r);
        else if (d > EVICT && (r.near || r.part)) r.near = r.skirt = r.part = null;
      }
      queue.sort((a, b) => a.d - b.d);
      if (next.size !== active.size || [...next].some((r) => !active.has(r))) {
        active = next;
        dirty = true;
      }
      const nextSlots = new Set<SlotRec>();
      for (const s of cache.slots) {
        const d = obbDist(s.plan.obb, x, z);
        if (slotOn.has(s) ? d < NEAR_OFF : d < NEAR_ON) nextSlots.add(s);
      }
      if (nextSlots.size !== slotOn.size || [...nextSlots].some((s) => !slotOn.has(s))) {
        slotOn = nextSlots;
        dirty = true;
      }
    }
    // 이번 프레임 몫(SLICE_MS)을 걸음 단위로 쓴다
    const deadline = performance.now() + SLICE_MS;
    while (queue.length && performance.now() < deadline)
      if (buildNearStep(queue[0], cache.nearCtx)) queue.shift();
    const spent = performance.now() >= deadline;
    // 켤 건물의 조각이 다 준비되면 한 번에 갈아 끼운다. 몫을 다 쓴 프레임이면 한 프레임만 미룬다.
    if (dirty && ![...active].some((r) => !r.near)) {
      if (spent && !held) held = true;
      else {
        held = false;
        dirty = false;
        rebuild();
      }
    }
  };
  devProbe(group);
  return { update, group };
}
