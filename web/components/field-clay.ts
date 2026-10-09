import * as THREE from "three";
import { chainOnBeforeCompile } from "./field-occlusion";

// 점토 건물을 코드로 빚는 낮은 단계 도구: 둥근 모서리 고리, 고리를 따라 올리는 띠(벽·받침·난간),
// 지붕판, 작은 상자·원기둥, 그리고 창을 기하 없이 그리는 벽 셰이더.
// 좌표는 정문 기준 미터(x 동쪽, z 남쪽), 모든 형상은 월드 좌표로 바로 만든다.
// 창은 꼭짓점 속성 aWin = (벽 시작에서 거리 u, 벽 길이 L, 창 영역 꼭대기 H, 무늬 번호)으로 셰이더가 그린다.

export type RGB = readonly [number, number, number];
// sRGB 색(#hex)을 three가 쓰는 선형 색으로. k는 밝기 배율.
export const rgb = (hex: string, k = 1): RGB => {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
};
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const scaleRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

// 벽 무늬 번호(aWin.w의 아래 4비트). 위쪽 비트(÷16)는 무늬마다 쓰는 정수(층수·강조색 등).
export const WIN = {
  CAMPUS: 0, // 크림 틀 낱창
  BRICK: 1, // 흰 틀 세로창 + 줄마다 창턱 띠 + 가로 줄눈
  CURTAIN: 2, // 커튼월 유리 + 멀리온
  HOUSE: 3, // 작은 낱창(주택)
  SHOP: 4, // 1층 진열창 + 위층 주택 창
  APART: 5, // 층마다 가로 발코니 띠
  BRICK_RIBBON: 6, // 벽돌 + 가로 띠창(중앙도서관)
  WHITE_RIBBON: 7, // 흰 벽 + 가로 띠창(대학본부)
  BANDS: 8, // 정보마루: 1층 통유리, 흰 띠, 테라코타 세로 핀
  GREENHOUSE: 9, // 온실 유리 + 흰 틀
  AWNING: 10, // 상가 차양 줄무늬(위쪽 비트 = 강조색 0~3, 4 = 크림만)
  SLAB: 11, // 민주마루 지붕판: 네모 창 띠(위쪽 비트 = 판 두께 dm)
  GLASSBOX: 12, // 민주마루 안쪽 유리·패널 상자
  RIBS: 13, // 돔·살창: u 방향 줄
  PLAIN: 14, // 창 없는 벽(받침 띠·바닥 그늘·먼 색만)
  NONE: 15, // 지붕·판: 꼭짓점 색 그대로
} as const;
export const winCode = (style: number, extra = 0) =>
  style + 16 * Math.max(0, Math.min(2000, Math.round(extra)));

// 색인 있는 형상을 모으는 그릇. 꼭짓점마다 위치·법선·색·창 속성을 가진다.
export class ClayWriter {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  w: number[] = [];
  i: number[] = [];
  get vertices() {
    return this.p.length / 3;
  }
  get triangles() {
    return this.i.length / 3;
  }
  v(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    col: RGB,
    u = 0,
    L = 0,
    H = 0,
    code: number = WIN.NONE,
  ) {
    const k = this.p.length / 3,
      l = Math.hypot(nx, ny, nz) || 1;
    this.p.push(x, y, z);
    this.n.push(nx / l, ny / l, nz / l);
    this.c.push(col[0], col[1], col[2]);
    this.w.push(u, L, H, code);
    return k;
  }
  // 삼각형 하나. 면의 방향이 꼭짓점 법선과 맞게 감는 방향을 고르고, 넓이가 없으면 버린다.
  t(a: number, b: number, c: number) {
    const P = this.p,
      N = this.n,
      ax = P[a * 3],
      ay = P[a * 3 + 1],
      az = P[a * 3 + 2],
      ux = P[b * 3] - ax,
      uy = P[b * 3 + 1] - ay,
      uz = P[b * 3 + 2] - az,
      vx = P[c * 3] - ax,
      vy = P[c * 3 + 1] - ay,
      vz = P[c * 3 + 2] - az,
      fx = uy * vz - uz * vy,
      fy = uz * vx - ux * vz,
      fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-8) return;
    const d =
      fx * (N[a * 3] + N[b * 3] + N[c * 3]) +
      fy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) +
      fz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d >= 0) this.i.push(a, b, c);
    else this.i.push(a, c, b);
  }
  q(a: number, b: number, c: number, d: number) {
    this.t(a, b, c);
    this.t(a, c, d);
  }
  // 폰 메모리를 아끼는 형식으로 묶는다: 법선 Int8, 색 Uint8, 창 속성 Int16(u·L·H는 10cm 단위).
  chunk(): ClayChunk {
    const nv = this.vertices,
      nor = new Int8Array(nv * 3),
      col = new Uint8Array(nv * 3),
      win = new Int16Array(nv * 4);
    for (let k = 0; k < nv * 3; k++) {
      nor[k] = Math.round(this.n[k] * 127);
      col[k] = Math.round(Math.min(1, Math.max(0, this.c[k])) * 255);
    }
    const q = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 10)));
    for (let k = 0; k < nv; k++) {
      win[k * 4] = q(this.w[k * 4]);
      win[k * 4 + 1] = q(this.w[k * 4 + 1]);
      win[k * 4 + 2] = q(this.w[k * 4 + 2]);
      win[k * 4 + 3] = this.w[k * 4 + 3];
    }
    return {
      p: new Float32Array(this.p),
      n: nor,
      c: col,
      w: win,
      i: nv > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
  }
  geometry() {
    return chunkGeometry([this.chunk()]);
  }
}

// 묶어 둔 형상 조각. 가까이 덧붙임은 건물마다 조각으로 두었다가 캐릭터 둘레 것만 이어 붙인다.
export type ClayChunk = {
  p: Float32Array;
  n: Int8Array;
  c: Uint8Array;
  w: Int16Array;
  i: Uint16Array | Uint32Array;
};
export const chunkBytes = (k: ClayChunk) =>
  k.p.byteLength + k.n.byteLength + k.c.byteLength + k.w.byteLength + k.i.byteLength;

// 조각들을 한 형상(그리기 한 번)으로 잇는다
export function chunkGeometry(chunks: readonly ClayChunk[]) {
  let nv = 0,
    ni = 0;
  for (const k of chunks) {
    nv += k.p.length / 3;
    ni += k.i.length;
  }
  const pos = new Float32Array(nv * 3),
    nor = new Int8Array(nv * 3),
    col = new Uint8Array(nv * 3),
    win = new Int16Array(nv * 4),
    idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0,
    oi = 0;
  for (const k of chunks) {
    pos.set(k.p, ov * 3);
    nor.set(k.n, ov * 3);
    col.set(k.c, ov * 3);
    win.set(k.w, ov * 4);
    for (let j = 0; j < k.i.length; j++) idx[oi + j] = k.i[j] + ov;
    ov += k.p.length / 3;
    oi += k.i.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
  g.setAttribute("aWin", new THREE.BufferAttribute(win, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ── 둥근 모서리 고리 ─────────────────────────────────
// 고리는 "줄기(run)"의 이음이다. 줄기는 곧은 벽 한 변이거나 모서리 호 하나이고, 점마다 바깥 법선과
// 줄기 시작에서의 거리 u를 가진다(창은 줄기마다 가운데 맞춰 그린다). 이웃 줄기는 끝점을 함께 쓴다.
export type Run = {
  x: number[];
  z: number[];
  nx: number[];
  nz: number[];
  u: number[];
  L: number;
};
export type Ring = Run[];

// 겹친 점과 거의 곧은 점을 빼고, 재료가 진행 방향 왼쪽에 오게(바깥 고리는 반시계, 구멍은 시계) 맞춘다.
// keep: 빼지 말아야 할 원래 꼭짓점 번호. 돌려주는 orig는 남은 점의 원래 번호.
export function cleanRing(p: number[], hole = false, keep = -1) {
  let pts: { x: number; z: number; o: number }[] = [];
  for (let i = 0; i < p.length; i += 2) pts.push({ x: p[i], z: p[i + 1], o: i / 2 });
  const dedupe = () => {
    pts = pts.filter((q, k) => {
      const r = pts[(k + 1) % pts.length];
      return pts.length < 2 || Math.hypot(r.x - q.x, r.z - q.z) > 0.05 || q.o === keep;
    });
  };
  dedupe();
  for (let pass = 0; pass < 3 && pts.length > 3; pass++) {
    const out: typeof pts = [];
    for (let k = 0; k < pts.length; k++) {
      const a = out.length ? out[out.length - 1] : pts[(k - 1 + pts.length) % pts.length],
        b = pts[k],
        c = pts[(k + 1) % pts.length],
        ux = b.x - a.x,
        uz = b.z - a.z,
        vx = c.x - b.x,
        vz = c.z - b.z,
        lu = Math.hypot(ux, uz),
        lv = Math.hypot(vx, vz);
      const sin = lu && lv ? (ux * vz - uz * vx) / (lu * lv) : 0,
        cos = lu && lv ? (ux * vx + uz * vz) / (lu * lv) : 1;
      if (b.o !== keep && Math.abs(sin) < 0.035 && cos > 0) continue;
      out.push(b);
    }
    if (out.length < 3) break;
    pts = out;
  }
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k],
      b = pts[(k + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  if (hole ? s > 0 : s < 0) pts.reverse();
  return {
    x: pts.map((q) => q.x),
    z: pts.map((q) => q.z),
    orig: pts.map((q) => q.o),
    area: Math.abs(s) / 2,
  };
}

// 정리된 다각형(재료가 왼쪽)을 바깥으로 o(m) 밀어낸다(o < 0이면 안으로). 모서리는 뾰족하게 맞춘다.
export function offsetPoly(xs: number[], zs: number[], o: number) {
  const n = xs.length,
    ox: number[] = [],
    oz: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n,
      q = (i + 1) % n,
      l1 = Math.hypot(xs[i] - xs[p], zs[i] - zs[p]) || 1,
      l2 = Math.hypot(xs[q] - xs[i], zs[q] - zs[i]) || 1,
      n1x = (zs[i] - zs[p]) / l1,
      n1z = -(xs[i] - xs[p]) / l1,
      n2x = (zs[q] - zs[i]) / l2,
      n2z = -(xs[q] - xs[i]) / l2,
      k = 1 / Math.max(0.35, 1 + n1x * n2x + n1z * n2z);
    ox.push(xs[i] + (n1x + n2x) * k * o);
    oz.push(zs[i] + (n1z + n2z) * k * o);
  }
  return { x: ox, z: oz };
}

export type RoundOpts = {
  r: number; // 볼록 모서리 반지름
  seg: number; // 볼록 모서리 호 나눔
  segConcave?: number; // 오목 모서리 호 나눔(기본 1)
  big?: { i: number; r: number; seg: number }; // 이 꼭짓점(정리 뒤 번호)만 크게 굴린다
  sharpDeg?: number; // 이보다 덜 꺾인 모서리는 굴리지 않는다
};

// 정리된 점(재료가 왼쪽)으로 둥근 고리를 만든다. 호는 모서리를 조절점으로 둔 2차 베지에다.
export function roundRing(xs: number[], zs: number[], o: RoundOpts): Ring {
  const n = xs.length,
    sharp = ((o.sharpDeg ?? 20) * Math.PI) / 180;
  type Corner = { x: number[]; z: number[]; nx: number[]; nz: number[]; a: [number, number]; b: [number, number] };
  const corners: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const pi = (i - 1 + n) % n,
      ni = (i + 1) % n,
      px = xs[i],
      pz = zs[i];
    let e1x = px - xs[pi],
      e1z = pz - zs[pi],
      e2x = xs[ni] - px,
      e2z = zs[ni] - pz;
    const l1 = Math.hypot(e1x, e1z) || 1e-9,
      l2 = Math.hypot(e2x, e2z) || 1e-9;
    e1x /= l1;
    e1z /= l1;
    e2x /= l2;
    e2z /= l2;
    const cross = e1x * e2z - e1z * e2x,
      dot = e1x * e2x + e1z * e2z,
      phi = Math.abs(Math.atan2(cross, dot));
    const big = o.big && o.big.i === i ? o.big : null;
    let r = big ? big.r : o.r,
      seg = big ? big.seg : cross > 0 ? o.seg : (o.segConcave ?? 1);
    if (phi < sharp || seg < 1 || r <= 0) {
      corners.push({ x: [px], z: [pz], nx: [], nz: [], a: [e1z, -e1x], b: [e2z, -e2x] });
      continue;
    }
    let t = r * Math.tan(phi / 2);
    const tmax = (big ? 0.48 : 0.35) * Math.min(l1, l2);
    if (t > tmax) {
      t = tmax;
      r = t / Math.tan(phi / 2);
    }
    void r;
    const c: Corner = { x: [], z: [], nx: [], nz: [], a: [e1z, -e1x], b: [e2z, -e2x] };
    const t1x = px - e1x * t,
      t1z = pz - e1z * t,
      t2x = px + e2x * t,
      t2z = pz + e2z * t;
    for (let k = 0; k <= seg; k++) {
      const s = k / seg,
        a = (1 - s) * (1 - s),
        b = 2 * (1 - s) * s,
        d = s * s;
      c.x.push(a * t1x + b * px + d * t2x);
      c.z.push(a * t1z + b * pz + d * t2z);
      const dx = (1 - s) * e1x + s * e2x,
        dz = (1 - s) * e1z + s * e2z,
        dl = Math.hypot(dx, dz) || 1;
      c.nx.push(dz / dl);
      c.nz.push(-dx / dl);
    }
    corners.push(c);
  }
  const runs: Ring = [];
  const pushRun = (x: number[], z: number[], nx: number[], nz: number[]) => {
    const u = [0];
    for (let k = 1; k < x.length; k++)
      u.push(u[k - 1] + Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]));
    if (u[u.length - 1] < 1e-4) return;
    runs.push({ x, z, nx, nz, u, L: u[u.length - 1] });
  };
  for (let i = 0; i < n; i++) {
    const c = corners[i],
      d = corners[(i + 1) % n];
    if (c.nx.length) pushRun(c.x, c.z, c.nx, c.nz);
    // 곧은 변: 이 모서리 끝 → 다음 모서리 시작
    const ax = c.x[c.x.length - 1],
      az = c.z[c.z.length - 1],
      bx = d.x[0],
      bz = d.z[0],
      [nx, nz] = c.b;
    pushRun([ax, bx], [az, bz], [nx, nx], [nz, nz]);
  }
  return runs;
}

// 원(지름 2r)을 하나의 호 줄기로
export function circleRing(cx: number, cz: number, r: number, seg: number): Ring {
  const x: number[] = [],
    z: number[] = [],
    nx: number[] = [],
    nz: number[] = [],
    u: number[] = [];
  for (let k = 0; k <= seg; k++) {
    // 재료가 왼쪽이 되게 반시계(x→z 수학 방향)로 돈다
    const a = (k / seg) * Math.PI * 2;
    x.push(cx + Math.cos(a) * r);
    z.push(cz + Math.sin(a) * r);
    nx.push(Math.cos(a));
    nz.push(Math.sin(a));
    u.push(a * r);
  }
  return [{ x, z, nx, nz, u, L: Math.PI * 2 * r }];
}

// 회전한 직사각형(가운데 cx·cz, 가로축 방향 (ux, uz), 반 길이 a·b)을 모서리 r로 굴린 고리
export function rectRing(
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  a: number,
  b: number,
  r: number,
  seg = 1,
): Ring {
  const vx = -uz,
    vz = ux,
    xs: number[] = [],
    zs: number[] = [];
  for (const [s, t] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    xs.push(cx + ux * a * s + vx * b * t);
    zs.push(cz + uz * a * s + vz * b * t);
  }
  const c = cleanRing(xs.flatMap((x, k) => [x, zs[k]]));
  return roundRing(c.x, c.z, { r: Math.min(r, a * 0.9, b * 0.9), seg, sharpDeg: 1 });
}

// 띠의 한 단: 고리에서 바깥으로 o(m) 나간 높이 y의 점들. n은 단면 법선(바깥, 위)을 직접 줄 때.
// code·H는 이 단에서 다음 단까지 띠의 벽 무늬다.
export type Level = {
  o: number;
  y: number;
  c: RGB;
  n?: readonly [number, number];
  code?: number;
  H?: number;
};

// 고리를 따라 단과 단 사이를 띠로 잇는다(벽, 받침, 모따기, 난간 등).
export function profile(w: ClayWriter, ring: Ring, levels: readonly Level[]) {
  for (let l = 0; l + 1 < levels.length; l++) {
    const A = levels[l],
      B = levels[l + 1],
      dO = B.o - A.o,
      dY = B.y - A.y,
      dl = Math.hypot(dO, dY) || 1,
      flat: [number, number] = [dY / dl, -dO / dl],
      na = A.n ?? flat,
      nb = B.n ?? flat,
      code = A.code ?? WIN.NONE,
      H = A.H ?? 0;
    let prevA = -1,
      prevB = -1,
      firstA = -1,
      firstB = -1;
    for (const run of ring) {
      let la = -1,
        lb = -1;
      for (let k = 0; k < run.x.length; k++) {
        const x = run.x[k],
          z = run.z[k],
          nx = run.nx[k],
          nz = run.nz[k],
          L = code === WIN.NONE ? 0 : run.L,
          u = code === WIN.NONE ? 0 : run.u[k];
        const a = w.v(x + nx * A.o, A.y, z + nz * A.o, nx * na[0], na[1], nz * na[0], A.c, u, L, H, code),
          b = w.v(x + nx * B.o, B.y, z + nz * B.o, nx * nb[0], nb[1], nz * nb[0], B.c, u, L, H, code);
        if (k === 0 && prevA >= 0) w.q(prevA, a, b, prevB); // 줄기 사이 이음(뾰족한 모서리의 틈 메우기)
        if (k === 0 && firstA < 0) {
          firstA = a;
          firstB = b;
        }
        if (la >= 0) w.q(la, a, b, lb);
        la = a;
        lb = b;
      }
      prevA = la;
      prevB = lb;
    }
    if (prevA >= 0 && firstA >= 0) w.q(prevA, firstA, firstB, prevB);
  }
}

// 고리에서 o(m) 나간 높이 y의 판(위 또는 아래를 본다). holes는 구멍 고리들.
export function cap(
  w: ClayWriter,
  ring: Ring,
  o: number,
  y: number,
  c: RGB,
  up = true,
  holes: Ring[] = [],
) {
  const outline = (r: Ring) => {
    const pts: THREE.Vector2[] = [];
    for (const run of r)
      for (let k = 0; k < run.x.length; k++) {
        const v = new THREE.Vector2(run.x[k] + run.nx[k] * o, run.z[k] + run.nz[k] * o),
          last = pts[pts.length - 1];
        if (!last || last.distanceToSquared(v) > 1e-6) pts.push(v);
      }
    if (pts.length > 2 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-6) pts.pop();
    return pts;
  };
  const outer = outline(ring),
    inner = holes.map(outline).filter((h) => h.length > 2);
  if (outer.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(outer, inner),
    all = [...outer, ...inner.flat()],
    ny = up ? 1 : -1,
    base = all.map((p) => w.v(p.x, y, p.y, 0, ny, 0, c));
  for (const [a, b, d] of tris) w.t(base[a], base[b], base[d]);
}

// 굴린 상자: 가운데 (cx, cz), 바닥 y0, 가로축 (ux, uz), 크기 sx·sz(가로·깊이)·sy(높이), 모서리 r
export function clayBox(
  w: ClayWriter,
  cx: number,
  y0: number,
  cz: number,
  ux: number,
  uz: number,
  sx: number,
  sy: number,
  sz: number,
  r: number,
  side: RGB,
  top: RGB = side,
  bottom = false,
  code: number = WIN.NONE,
) {
  const rr = Math.min(r, sx * 0.45, sz * 0.45, sy * 0.45),
    ring = rectRing(cx, cz, ux, uz, sx / 2, sz / 2, rr, 1);
  const lv: Level[] = [];
  if (bottom && rr > 0.02) lv.push({ o: -rr, y: y0, c: side }, { o: 0, y: y0 + rr, c: side, code, H: y0 + sy });
  else lv.push({ o: 0, y: y0, c: side, code, H: y0 + sy });
  lv.push({ o: 0, y: y0 + sy - rr, c: side }, { o: -rr, y: y0 + sy, c: top });
  profile(w, ring, lv);
  cap(w, ring, -rr, y0 + sy, top);
  if (bottom) cap(w, ring, -rr, y0, side, false);
}

// 원기둥(세로): 가운데 (cx, cz), 반지름 r, 바닥 y0 ~ 꼭대기 y1, 위 모서리 bevel
export function clayCylinder(
  w: ClayWriter,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
  seg: number,
  side: RGB,
  top: RGB = side,
  bevel = 0.05,
  code: number = WIN.NONE,
) {
  const ring = circleRing(cx, cz, r, seg),
    b = Math.min(bevel, r * 0.4, (y1 - y0) * 0.4);
  profile(w, ring, [
    { o: 0, y: y0, c: side, n: [1, 0], code, H: y1 },
    { o: 0, y: y1 - b, c: side, n: [1, 0] },
    { o: -b, y: y1, c: top, n: [0.3, 1] },
  ]);
  cap(w, ring, -b, y1, top);
}

// ── 벽 셰이더 ────────────────────────────────────────
const g3 = (hex: string, k = 1) => {
  const [r, g, b] = rgb(hex, k);
  return `vec3(${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)})`;
};
const PALETTE = `
const vec3 CL_GLASS = ${g3("#4f74a6")};
const vec3 CL_GLASS_HI = ${g3("#bcd8ee")};
const vec3 CL_REVEAL = ${g3("#34507a")};
const vec3 CL_CREAM = ${g3("#fff6e2")};
const vec3 CL_WHITE = ${g3("#fbf7ee")};
const vec3 CL_CURTAIN = ${g3("#8fbfd9")};
const vec3 CL_FLOORBAND = ${g3("#e8eef4")};
const vec3 CL_RAIL = ${g3("#d2e0f0")};
const vec3 CL_GRANITE = ${g3("#d9d0c0")};
const vec3 CL_DOORGLASS = ${g3("#3f5f8e")};
const vec3 CL_TERRA = ${g3("#d8785a")};
const vec3 CL_FINGLASS = ${g3("#5f84b0")};
const vec3 CL_GREEN = ${g3("#cfeee6")};
const vec3 CL_OPENING = ${g3("#3a4658")};
const vec3 CL_GRID = ${g3("#c9d3de")};
const vec3 CL_FAR = ${g3("#dfe4ee")};
const vec3 CL_ACC0 = ${g3("#e8452c")};
const vec3 CL_ACC1 = ${g3("#5fa68f")};
const vec3 CL_ACC2 = ${g3("#6f87aa")};
const vec3 CL_ACC3 = ${g3("#ffc53d")};
`;
const FRAG_PARS = `
varying vec4 vClayWin;
varying vec3 vClayPos;
varying float vClayNy;
${PALETTE}
float clayRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float clayCov(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }
vec3 clayGlass(float t, float fromTop) {
  vec3 g = mix(CL_GLASS, CL_GLASS_HI, smoothstep(0.62, 0.74, t));
  return mix(g, CL_REVEAL, 1.0 - smoothstep(0.07, 0.11, fromTop));
}
// 낱창: 변 가운데 맞춘 n칸, 줄마다 둥근 창 + 틀 + 창턱. 돌려주는 값 = (색, 덮는 정도)
vec4 clayPunched(float u, float L, float y, float y0, float top, float rows, float bay,
                 vec2 win, float rad, float frame, vec3 frameC, float sill, float aa) {
  float n = floor((L - 2.0) / bay);
  float P = (top - y0) / max(rows, 1.0);
  if (n < 1.0 || rows < 0.5 || P < 0.9) return vec4(0.0);
  float bu = (u - (L - n * bay) * 0.5) / bay;
  float by = (y - y0) / P;
  if (bu < 0.0 || bu > n || by < 0.0 || by > rows) return vec4(0.0);
  vec2 lp = vec2((fract(bu) - 0.5) * bay, (fract(by) - 0.54) * P);
  vec2 hs = vec2(win.x * 0.5, min(win.y, P * 0.56) * 0.5);
  float dg = clayRR(lp, hs, rad);
  float df = clayRR(lp, hs + frame, rad + frame);
  float cg = clayCov(dg, aa), cf = clayCov(df, aa);
  float ds = clayRR(lp - vec2(0.0, -hs.y - frame - sill * 0.5), vec2(hs.x + frame + 0.2, sill * 0.5), 0.04);
  float cs = clayCov(ds, aa) * step(0.01, sill);
  vec3 col = mix(frameC, clayGlass((lp.y + hs.y) / (2.0 * hs.y), hs.y - lp.y), cg);
  return vec4(col, max(cf, cs));
}
// 가로 띠창: 줄마다 변 끝 0.8m를 남기고 길게 이어진 유리 + 세로 멀리온 + 아래 창턱 줄
vec4 clayRibbon(float u, float L, float y, float y0, float top, float rows, float mull,
                vec3 frameC, float aa) {
  float P = (top - y0) / max(rows, 1.0);
  if (L < 2.6 || rows < 0.5 || P < 0.9) return vec4(0.0);
  float by = (y - y0) / P;
  if (by < 0.0 || by > rows) return vec4(0.0);
  float ly = (fract(by) - 0.54) * P;
  float hh = min(0.8, P * 0.27);
  float dx = max(0.8 - u, u - (L - 0.8));
  float dy = abs(ly) - hh;
  float cg = clayCov(max(dx, dy), aa);
  float cf = clayCov(max(dx - 0.12, dy - 0.12), aa);
  float mu = abs(fract(u / mull + 0.5) - 0.5) * mull;
  float cm = clayCov(mu - 0.06, aa);
  vec3 col = mix(frameC, clayGlass((ly + hh) / (2.0 * hh), hh - ly), cg * (1.0 - cm));
  float cs = clayCov(max(abs(ly + hh + 0.28) - 0.1, dx - 0.15), aa);
  return vec4(mix(col, frameC, cs * (1.0 - cf)), max(cf, cs));
}
`;
const FRAG_MAIN = `
{
  float clayCode = vClayWin.w;
  float st = mod(clayCode + 0.5, 16.0) - 0.5;
  float ex = floor((clayCode + 0.5) / 16.0);
  if (st < 14.5) {
    vec3 wall = diffuseColor.rgb;
    float u = vClayWin.x * 0.1, L = vClayWin.y * 0.1, H = vClayWin.z * 0.1;
    float y = vClayPos.y;
    float camD = length(vViewPosition);
    float fu = fwidth(u), fy = fwidth(y);
    float aa = length(vec2(fu, fy)) * 0.7 + 0.003;
    // 먼 창 지우기: 흔한 낱창·주택·상가·아파트(0, 3, 4, 5)는 140→220m에서 벽 평균색으로 바꿔
    // 멀리 늘어선 건물이 창 무늬로 자글거리지 않게 한다. 랜드마크 무늬(띠창·커튼월 등)는 380→560m.
    bool clayCommon = st < 0.5 || (st > 2.5 && st < 5.5);
    float clayFar = clayCommon ? smoothstep(140.0, 220.0, camD) : smoothstep(380.0, 560.0, camD);
    float clayNear = (1.0 - clayFar) * (1.0 - smoothstep(0.2, 0.4, max(fu, fy)));
    vec3 col = wall;
    vec3 farAvg = mix(wall, CL_GLASS, 0.22);
    bool wallLike = true;
    if (st < 0.5) { // 캠퍼스 낱창
      vec4 w = clayPunched(u, L, y, 0.6, H - 0.5, ex, 3.0, vec2(1.6, 1.25), 0.25, 0.16, CL_CREAM, 0.22, aa);
      col = mix(wall, w.rgb, w.a);
      col = mix(col, CL_GRANITE, clayCov(y - 0.62, aa));
    } else if (st < 1.5 || (st > 5.5 && st < 6.5)) { // 벽돌(낱창 / 띠창)
      float j = abs(fract(y / 0.7 + 0.5) - 0.5) * 0.7;
      col = wall * (1.0 - 0.12 * clayCov(j - 0.035, aa) * (1.0 - smoothstep(50.0, 90.0, camD)));
      vec4 w = st < 1.5
        ? clayPunched(u, L, y, 0.6, H - 0.6, ex, 2.6, vec2(1.3, 1.5), 0.2, 0.18, CL_WHITE, 0.25, aa)
        : clayRibbon(u, L, y, 0.6, H - 0.6, ex, 1.6, CL_WHITE, aa);
      col = mix(col, w.rgb, w.a);
      col = mix(col, wall * 0.8, clayCov(y - 0.62, aa));
    } else if (st < 2.5) { // 커튼월
      float P = (H - 0.6) / max(ex, 1.0);
      float mu = abs(fract(u / 2.4 + 0.5) - 0.5) * 2.4;
      float fb = abs(fract((y - 0.6) / P + 0.5) - 0.5) * P;
      col = mix(CL_CURTAIN * (0.92 + 0.12 * fract((y - 0.6) / P)), CL_CREAM, clayCov(mu - 0.06, aa));
      col = mix(col, CL_FLOORBAND, clayCov(fb - 0.25, aa));
      col = mix(col, CL_GRANITE, clayCov(y - 0.62, aa));
      farAvg = CL_CURTAIN;
    } else if (st < 3.5) { // 주택 낱창
      vec4 w = clayPunched(u, L, y, 0.6, H - 0.4, ex, 2.6, vec2(1.3, 1.1), 0.25, 0.14, CL_CREAM, 0.18, aa);
      col = mix(wall, w.rgb, w.a);
      col = mix(col, wall * 0.8, clayCov(y - 0.6, aa));
    } else if (st < 4.5) { // 상가: 1층 진열창 + 위층 낱창
      float pu = abs(fract(u / 4.5 + 0.5) - 0.5) * 4.5;
      float dx = max(0.6 - u, u - (L - 0.6));
      float shop = clayCov(max(max(dx, 0.25 - pu), abs(y - 1.9) - 1.3), aa) * step(3.0, L);
      vec3 disp = mix(CL_CURTAIN, CL_GLASS_HI, smoothstep(2.6, 3.1, y));
      col = mix(wall, disp, shop);
      vec4 w = clayPunched(u, L, y, 3.6, H - 0.4, max(ex - 1.0, 0.0), 2.6, vec2(1.3, 1.1), 0.25, 0.14, CL_CREAM, 0.18, aa);
      col = mix(col, w.rgb, w.a);
      col = mix(col, wall * 0.8, clayCov(y - 0.6, aa));
      farAvg = mix(wall, CL_CURTAIN, 0.3);
    } else if (st < 5.5) { // 아파트: 층마다 가로 띠
      float P = (H - 1.0) / max(ex, 1.0);
      float fy2 = fract((y - 1.0) / P) * P;
      float inside = step(1.0, y) * step(y, H - 0.3);
      float dx = max(0.9 - u, u - (L - 0.9));
      float band = clayCov(max(dx, abs(fy2 - P * 0.55) - min(0.45, P * 0.28)), aa) * inside;
      float rail = clayCov(max(dx, abs(fy2 - P * 0.22) - 0.1), aa) * inside;
      col = mix(wall, mix(CL_CURTAIN, CL_GLASS_HI, 0.25), band);
      col = mix(col, CL_RAIL, rail);
      farAvg = mix(wall, CL_CURTAIN, 0.3);
    } else if (st < 7.5) { // 흰 벽 + 가로 띠창
      vec4 w = clayRibbon(u, L, y, 0.6, H - 0.5, ex, 1.5, CL_WHITE, aa);
      col = mix(wall, w.rgb, w.a);
      col = mix(col, CL_GRANITE, clayCov(y - 0.62, aa));
      farAvg = mix(wall, CL_GLASS, 0.3);
    } else if (st < 8.5) { // 정보마루
      float P = (H - 0.6) / max(ex, 1.0);
      float f = (y - 0.6) / P;
      float g1 = 0.6 + P;
      float mid = 0.6 + P * floor(ex * 0.5 + 0.5);
      float white = max(clayCov(abs(y - (g1 + 0.45)) - 0.45, aa), clayCov(abs(y - (mid + 0.45)) - 0.45, aa));
      white = max(white, clayCov(H - 1.3 - y, aa));
      float mu = abs(fract(u / 2.0 + 0.5) - 0.5) * 2.0;
      vec3 ground = mix(mix(CL_DOORGLASS, CL_GLASS_HI, smoothstep(0.7, 0.95, fract(f)) * 0.5), CL_WHITE, clayCov(mu - 0.05, aa));
      float fin = abs(fract(u / 1.9 + 0.5) - 0.5) * 1.9;
      vec3 upper = mix(CL_FINGLASS, CL_TERRA, clayCov(fin - 0.28, aa));
      col = mix(upper, ground, step(y, g1));
      col = mix(col, wall, white);
      col = mix(col, CL_GRANITE, clayCov(y - 0.62, aa));
      farAvg = mix(wall, CL_TERRA, 0.3);
    } else if (st < 9.5) { // 온실
      float mu = abs(fract(u / 2.4 + 0.5) - 0.5) * 2.4;
      float hb = abs(fract(y / 1.2 + 0.5) - 0.5) * 1.2;
      col = mix(CL_GREEN, CL_WHITE, max(clayCov(mu - 0.07, aa), clayCov(hb - 0.05, aa)));
      farAvg = CL_GREEN;
    } else if (st < 10.5) { // 차양 줄무늬
      vec3 acc = ex < 0.5 ? CL_ACC0 : ex < 1.5 ? CL_ACC1 : ex < 2.5 ? CL_ACC2 : ex < 3.5 ? CL_ACC3 : CL_CREAM;
      float s = abs(fract(u / 1.2) - 0.5) * 1.2;
      col = mix(acc, CL_CREAM, clayCov(s - 0.3, aa));
      wallLike = false;
    } else if (st < 11.5) { // 민주마루 지붕판 네모 창 띠
      float th = ex * 0.1;
      vec2 lp = vec2((fract(u / 2.2) - 0.5) * 2.2, y - (H - th * 0.5));
      float c = clayCov(clayRR(lp, vec2(0.5, min(0.5, th * 0.25)), 0.1), aa) * step(4.0, L);
      col = mix(wall, CL_OPENING, c);
      farAvg = mix(wall, CL_OPENING, 0.15);
      wallLike = false;
    } else if (st < 12.5) { // 민주마루 유리·패널 상자
      float mu = abs(fract(u / 1.8 + 0.5) - 0.5) * 1.8;
      float hb = abs(fract(y / 3.2 + 0.5) - 0.5) * 3.2;
      col = mix(mix(CL_REVEAL, CL_GLASS, 0.5 + 0.5 * fract(y / 3.2)), CL_GRID, max(clayCov(mu - 0.06, aa), clayCov(hb - 0.08, aa)));
      farAvg = CL_GLASS;
    } else if (st < 13.5) { // 돔 골·살창 줄
      float s = abs(fract(u / 1.1 + 0.5) - 0.5) * 1.1;
      col = wall * (1.0 - 0.18 * clayCov(s - 0.14, aa));
      farAvg = wall * 0.93;
      wallLike = false;
    } else { // 창 없는 벽
      col = mix(wall, wall * 0.8, clayCov(y - 0.6, aa));
      farAvg = wall;
    }
    col = mix(farAvg, col, clayNear);
    if (wallLike) col *= 0.78 + 0.22 * smoothstep(0.0, 2.5, y);
    col = mix(col, CL_FAR, 0.25 * smoothstep(300.0, 560.0, camD));
    diffuseColor.rgb = col;
  }
  // 점토 밝힘: 해를 등진 벽도 탁한 회색이 되지 않게 벽 색을 조금 스스로 밝힌다(지붕은 조금만)
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.32, 0.3, 0.28) * (1.0 - 0.7 * clamp(vClayNy, 0.0, 1.0));
}
`;

// 블렌더 랜드마크 모형(꼭짓점 색에 그늘을 구운 GLB)에도 코드 건물과 같은 점토 밝힘을 준다.
// 창 셰이더 없이 밝힘 한 줄만이라 코드 건물과 나란히 서도 벽이 더 어둡게 보이지 않는다.
export function clayLift<M extends THREE.Material>(m: M): M {
  return chainOnBeforeCompile(m, "clay-lift", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vLiftNy;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLiftNy = normalize(mat3(modelMatrix) * objectNormal).y;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLiftNy;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.32, 0.3, 0.28) * (1.0 - 0.7 * clamp(vLiftNy, 0.0, 1.0));",
      );
  });
}

// 폰 화면인지(짧은 변 600 CSS px 미만). 서버 렌더링 중에는 false.
export const isPhoneView = () =>
  typeof window !== "undefined" &&
  Math.min(window.innerWidth, window.innerHeight) < 600;

// 필드 세계(건물·랜드마크·나무·소품·땅)가 함께 쓰는 꼭짓점 색 무광 재질.
// 폰은 값싼 Lambert(조각마다 PBR 계산을 하지 않는다), 큰 화면은 무광 Standard.
export function worldMaterial(
  phone: boolean,
  roughness = 0.9,
): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  return phone
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness,
        metalness: 0,
      });
}

// 꼭짓점 색 점토 재질에 창 셰이더를 넣는다. 폰은 값싼 Lambert, 큰 화면은 무광 Standard.
export function clayMaterial(phone: boolean) {
  const m = worldMaterial(phone, 0.9);
  return chainOnBeforeCompile(m, "clay-windows", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 aWin;\nvarying vec4 vClayWin;\nvarying vec3 vClayPos;\nvarying float vClayNy;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvClayWin = aWin;\nvClayPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvClayNy = normalize(mat3(modelMatrix) * objectNormal).y;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_MAIN);
  });
}
