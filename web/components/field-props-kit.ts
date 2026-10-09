import * as THREE from "three";

// 손으로 빚은 듯한 점토 거리 소품 키트(코드로 만든다). 크기는 캐릭터 키 8.5m에 맞춘
// 장난감 축척(실제의 약 2.2배), 원점은 바닥 가운데, 앞은 +z, 단위는 m다.
// 모든 바깥 모서리를 깎아(둥근 법선) 굵고 짧은 실루엣, 물체 하나에 색 2~3개, 무광.
// 꼭짓점 색에 바닥 쪽 그늘(AO)을 굽는다. 기준: field-style-ac-pogo.md 7장.
// 닌텐도·나이언틱의 모형이나 상징은 쓰지 않는다. 무기·군사 소품·차량은 없다.

export const PROP_COLORS = {
  navy: "#1f2a44",
  cream: "#fff6e2",
  creamShade: "#e3d6bd",
  wood: "#d29a62",
  beam: "#b98b5e",
  stone: "#ece2c9",
  granite: "#d9d0c0",
  soil: "#8a6a4e",
  leaf: "#5aa952",
  leafLight: "#6bb85b",
  hedge: "#5fa955",
  hedgeBase: "#4b8a46", // 생울타리 밑동 띠
  topiary: "#3f7f45", // 원뿔꼴로 다듬은 나무
  pine: "#4f8a4a", // 다듬은 소나무 잎 판
  pineLight: "#5f9a55",
  bark: "#7a5a44",
  stepSlab: "#e7dfd0", // 디딤돌
  glass: "#cfe5f0",
  lampGlass: "#ffe9b8",
  plate: "#8a7a68",
  pink: "#ef7088",
  yellow: "#f6c74e",
  white: "#fff6ea",
  paperYellow: "#ffc53d",
  paperRed: "#e8452c",
  paperMint: "#a6dcc6",
};
const P = PROP_COLORS;

// 소품 한 종류의 형상: 색인 있는 삼각형 묶음
export type Template = {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
  // 바닥 그늘(블롭) 반지름 x·z(m)
  foot: [number, number];
  height: number;
};
export const triangles = (t: Template) => t.idx.length / 3;

type ColorFn = (nx: number, ny: number, nz: number, y: number) => string;
const _col = new THREE.Color(),
  _n = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _nm = new THREE.Matrix3();

// 부품을 모아 한 형상으로 만든다
export class Mesher {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  add(geo: THREE.BufferGeometry, color: string | ColorFn, m?: THREE.Matrix4) {
    const p = geo.attributes.position,
      nn = geo.attributes.normal,
      base = this.pos.length / 3;
    if (m) _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      _n.fromBufferAttribute(nn, i);
      if (m) {
        _p.applyMatrix4(m);
        _n.applyMatrix3(_nm).normalize();
      }
      this.pos.push(_p.x, _p.y, _p.z);
      this.nor.push(_n.x, _n.y, _n.z);
      _col.set(typeof color === "string" ? color : color(_n.x, _n.y, _n.z, _p.y));
      this.col.push(_col.r, _col.g, _col.b);
    }
    if (geo.index)
      for (let i = 0; i < geo.index.count; i++)
        this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
    return this;
  }
  // 바닥 쪽을 어둡게(0.8 + 0.2 × smoothstep(0, 0.4 × 높이, y))
  build(foot: [number, number]): Template {
    let h = 0;
    for (let i = 1; i < this.pos.length; i += 3) h = Math.max(h, this.pos[i]);
    const col = new Float32Array(this.col);
    for (let i = 0; i < col.length / 3; i++) {
      const t = THREE.MathUtils.smoothstep(this.pos[i * 3 + 1], 0, 0.4 * h || 1),
        k = 0.8 + 0.2 * t;
      col[i * 3] *= k;
      col[i * 3 + 1] *= k;
      col[i * 3 + 2] *= k;
    }
    return {
      pos: new Float32Array(this.pos),
      nor: new Float32Array(this.nor),
      col,
      idx: new Uint32Array(this.idx),
      foot,
      height: h,
    };
  }
}

// 모서리를 한 번 깎은 상자(꼭짓점 24, 삼각형 44). 깎은 면은 양쪽 면 법선을 이어 둥글게 보인다.
export function chamferBox(w: number, h: number, d: number, r: number) {
  r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const X = w / 2,
    Y = h / 2,
    Z = d / 2,
    pos: number[] = [],
    nor: number[] = [],
    idx: number[] = [];
  // 면마다 네 꼭짓점: 축 a(법선), 면 위 두 축 b·c
  const faces: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ];
  const ext = [X, Y, Z];
  const vid = new Map<string, number>(); // "면,부호b,부호c" → 꼭짓점 번호
  faces.forEach(([a, s], f) => {
    const b = (a + 1) % 3,
      c = (a + 2) % 3;
    for (const sb of [-1, 1])
      for (const sc of [-1, 1]) {
        const v = [0, 0, 0],
          n = [0, 0, 0];
        v[a] = s * ext[a];
        v[b] = sb * (ext[b] - r);
        v[c] = sc * (ext[c] - r);
        n[a] = s;
        vid.set(`${f},${sb},${sc}`, pos.length / 3);
        pos.push(v[0], v[1], v[2]);
        nor.push(n[0], n[1], n[2]);
      }
  });
  const V = (a: number, s: number, ax: number, sx: number, ay: number, sy: number) => {
    // 면(a, s)의 꼭짓점 중 축 ax 부호 sx, 축 ay 부호 sy
    const f = faces.findIndex(([fa, fs]) => fa === a && fs === s),
      b = (a + 1) % 3,
      sb = ax === b ? sx : sy,
      sc = ax === b ? sy : sx;
    return vid.get(`${f},${sb},${sc}`)!;
  };
  const tri = (i: number, j: number, k: number) => {
    // 바깥(원점 반대)을 보게 감는다
    const p = (n: number) => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]];
    const A = p(i),
      B = p(j),
      Cc = p(k),
      u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
      v = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]],
      c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      m = [(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3, (A[2] + B[2] + Cc[2]) / 3];
    if (c[0] * m[0] + c[1] * m[1] + c[2] * m[2] >= 0) idx.push(i, j, k);
    else idx.push(i, k, j);
  };
  // 큰 면
  faces.forEach(([a, s]) => {
    const b = (a + 1) % 3,
      c = (a + 2) % 3;
    const q00 = V(a, s, b, -1, c, -1),
      q10 = V(a, s, b, 1, c, -1),
      q01 = V(a, s, b, -1, c, 1),
      q11 = V(a, s, b, 1, c, 1);
    tri(q00, q10, q11);
    tri(q00, q11, q01);
  });
  // 모서리 띠: 두 면(a, sa)·(b, sb)이 만나는 곳, 남은 축 c를 따라
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      const c = 3 - a - b;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const p0 = V(a, sa, b, sb, c, -1),
            p1 = V(a, sa, b, sb, c, 1),
            q0 = V(b, sb, a, sa, c, -1),
            q1 = V(b, sb, a, sa, c, 1);
          tri(p0, p1, q1);
          tri(p0, q1, q0);
        }
    }
  // 모서리 꼭짓점 삼각형
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        tri(V(0, sx, 1, sy, 2, sz), V(1, sy, 0, sx, 2, sz), V(2, sz, 0, sx, 1, sy));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
// 원기둥(옆은 부드럽게, 윗면만 막는다). cap이 "both"면 양면을 다 막는다(세워 단 원판).
function cyl(rTop: number, rBot: number, h: number, seg = 8, cap: boolean | "both" = true) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !cap);
  g.deleteAttribute("uv");
  if (cap === true && g.groups.length > 2) {
    // 아랫면(땅에 닿아 안 보인다)은 뺀다
    const bottom = g.groups[2],
      index = g.index!.array as ArrayLike<number>,
      keep: number[] = [];
    for (let i = 0; i < index.length; i++)
      if (i < bottom.start || i >= bottom.start + bottom.count) keep.push(index[i]);
    g.setIndex(keep);
  }
  return g;
}
function blob(r: number, ws = 7, hs = 5) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.deleteAttribute("uv");
  return g;
}
const at = (x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s: [number, number, number] = [1, 1, 1]) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(...s),
  );
const topSide = (top: string, side: string): ColorFn => (_x, ny) =>
  ny > 0.6 ? top : side;

// ── 소품들 ────────────────────────────────────────────────────
// 나무 벤치(등받이): 판 #d29a62, 다리·틀 남색. 4.0 × 1.5 × 2.2, 앉는 높이 1.05.
function bench() {
  const m = new Mesher();
  for (const z of [0.42, 0, -0.42])
    m.add(chamferBox(3.9, 0.25, 0.38, 0.08), P.wood, at(0, 1.0, z));
  for (const y of [1.55, 1.95])
    m.add(chamferBox(3.9, 0.3, 0.25, 0.08), P.wood, at(0, y, -0.66, 0, -0.12));
  for (const x of [-1.6, 1.6]) {
    m.add(chamferBox(0.26, 0.9, 1.25, 0.08), P.navy, at(x, 0.45, 0));
    m.add(chamferBox(0.26, 1.3, 0.26, 0.08), P.navy, at(x, 1.55, -0.68, 0, -0.12));
  }
  return m.build([2.3, 1.0]);
}
// 조용한 구역의 돌벤치: 등받이 없이 돌색 한 가지
function benchStone() {
  const m = new Mesher();
  m.add(chamferBox(4.0, 0.36, 1.4, 0.12), P.stone, at(0, 0.82, 0));
  for (const x of [-1.35, 1.35])
    m.add(chamferBox(0.6, 0.66, 1.1, 0.1), P.granite, at(x, 0.33, 0));
  return m.build([2.3, 0.95]);
}
// 가로등: 받침·기둥 남색, 등 크림, 등 유리 띠 연노랑. 높이 약 9m.
function lamp() {
  const m = new Mesher();
  m.add(cyl(0.38, 0.46, 0.4, 8), P.navy, at(0, 0.2, 0));
  m.add(cyl(0.16, 0.2, 7.6, 8, false), P.navy, at(0, 4.2, 0));
  m.add(cyl(0.42, 0.3, 0.45, 8), P.cream, at(0, 8.15, 0));
  m.add(cyl(0.46, 0.42, 0.42, 8), P.lampGlass, at(0, 8.58, 0));
  m.add(cyl(0.12, 0.62, 0.42, 8), P.navy, at(0, 9.0, 0));
  return m.build([0.7, 0.7]);
}
// 돋운 화분: 돌 테 안에 흙, 풀 덩이 셋, 꽃점 여섯. 4.0 × 1.8, 테 높이 0.7.
function planter(colors: string[]) {
  const m = new Mesher();
  m.add(chamferBox(4.0, 0.7, 1.8, 0.16), topSide(P.stone, P.granite), at(0, 0.35, 0));
  const soil = new THREE.PlaneGeometry(3.6, 1.4);
  soil.rotateX(-Math.PI / 2);
  soil.deleteAttribute("uv");
  m.add(soil, P.soil, at(0, 0.71, 0));
  const leaves: [number, number, number][] = [
    [-1.15, 0.05, 0.62],
    [0.05, -0.1, 0.7],
    [1.2, 0.08, 0.58],
  ];
  leaves.forEach(([x, z, r], i) =>
    m.add(blob(1, 6, 4), i % 2 ? P.leafLight : P.leaf, at(x, 0.85, z, i, 0, 0, [r, r * 0.75, r * 0.8])),
  );
  const dots: [number, number][] = [
    [-1.5, 0.35],
    [-0.6, -0.4],
    [-0.3, 0.45],
    [0.6, 0.3],
    [1.0, -0.45],
    [1.6, 0.2],
  ];
  dots.forEach(([x, z], i) =>
    m.add(new THREE.OctahedronGeometry(0.2), colors[i % colors.length], at(x, 1.28 + (i % 2) * 0.12, z, i * 0.7)),
  );
  return m.build([2.4, 1.3]);
}
// 빈 크림 안내판(글자 없음): 화강석 받침 위 크림 판. 3.8 × 1.0 × 1.7.
function sign() {
  const m = new Mesher();
  m.add(chamferBox(3.8, 0.32, 1.0, 0.1), P.granite, at(0, 0.16, 0));
  m.add(chamferBox(3.4, 1.35, 0.55, 0.14), topSide(P.creamShade, P.cream), at(0, 0.98, 0));
  return m.build([2.2, 0.8]);
}
// 길 안내 기둥: 남색 기둥에 글자 없는 화살표 판(크림)을 단다. dirs는 판이 가리킬 방향(라디안).
export function signpost(dirs: number[]) {
  const m = new Mesher();
  m.add(chamferBox(0.32, 6.0, 0.32, 0.08), P.navy, at(0, 3.0, 0));
  dirs.slice(0, 3).forEach((a, i) => {
    // 판의 +x가 가리키는 쪽: 화살촉 오각 기둥(2.8 × 0.7 × 0.25)
    const s = new THREE.Shape();
    s.moveTo(-0.2, -0.35);
    s.lineTo(2.2, -0.35);
    s.lineTo(2.6, 0);
    s.lineTo(2.2, 0.35);
    s.lineTo(-0.2, 0.35);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.25,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 1,
    });
    g.deleteAttribute("uv");
    g.translate(0, 0, -0.125);
    g.computeVertexNormals();
    // 판의 +x가 방향 a(지도 각: sin a, cos a)를 보게 y축으로 돌린다
    m.add(g, P.cream, at(0, 5.2 - i * 0.95, 0, a - Math.PI / 2));
  });
  return m.build([0.6, 0.6]);
}
// 자전거 거치대(자전거 없음): 남색 고리 다섯, 6.0 × 0.35 × 1.7
function bikeRack() {
  const m = new Mesher();
  m.add(chamferBox(5.8, 0.25, 0.4, 0.08), P.navy, at(0, 0.125, 0));
  for (let i = 0; i < 5; i++) {
    const g = new THREE.TorusGeometry(0.62, 0.13, 4, 6, Math.PI);
    g.deleteAttribute("uv");
    m.add(g, P.navy, at(-2.4 + i * 1.2, 0.9, 0, Math.PI / 2));
  }
  return m.build([3.1, 0.7]);
}
// 돌 말뚝(횡단보도 끝): 화강석 몸통에 크림 머리
function bollard() {
  const m = new Mesher();
  m.add(cyl(0.3, 0.34, 1.0, 8), P.granite, at(0, 0.5, 0));
  m.add(cyl(0.2, 0.33, 0.22, 8), P.cream, at(0, 1.1, 0));
  return m.build([0.45, 0.45]);
}
// 분리수거함: 크림 몸통, 남색 뚜껑. 1.6 × 0.9 × 1.5.
function bin() {
  const m = new Mesher();
  m.add(chamferBox(1.55, 1.25, 0.9, 0.18), P.cream, at(0, 0.625, 0));
  m.add(chamferBox(1.7, 0.28, 1.0, 0.1), P.navy, at(0, 1.38, 0));
  return m.build([1.0, 0.65]);
}
// 버스 정류장 쉘터: 크림 지붕, 불투명 하늘색 뒷판, 남색 기둥, 나무 의자, 남색 원판 표지(그림 없음).
// 운수 회사 이름·로고는 넣지 않는다. 7.5 × 2.6 × 4.6.
function busStop() {
  const m = new Mesher();
  m.add(chamferBox(7.5, 0.4, 2.6, 0.14), topSide(P.cream, P.creamShade), at(0, 4.4, 0));
  m.add(chamferBox(7.0, 3.1, 0.25, 0.08), P.glass, at(0, 2.35, -1.05));
  for (const x of [-3.5, 0, 3.5])
    m.add(chamferBox(0.3, 4.2, 0.3, 0.08), P.navy, at(x, 2.1, -1.05));
  m.add(chamferBox(5.0, 0.28, 0.8, 0.08), P.wood, at(0, 1.05, -0.55));
  for (const x of [-2.0, 2.0])
    m.add(chamferBox(0.28, 0.95, 0.6, 0.06), P.navy, at(x, 0.48, -0.6));
  m.add(cyl(0.14, 0.14, 5.2, 6, false), P.navy, at(4.4, 2.6, 0.9));
  m.add(cyl(0.72, 0.72, 0.16, 12, "both"), P.navy, at(4.4, 4.9, 0.9, 0, Math.PI / 2));
  m.add(cyl(0.5, 0.5, 0.18, 12, "both"), P.cream, at(4.4, 4.9, 0.92, 0, Math.PI / 2));
  return m.build([4.0, 1.6]);
}
// 그늘 쉼터(퍼걸러): 크림 기둥 넷, 나무 보 둘과 지붕살 일곱. 6.5 × 4.5 × 5.0.
function pergola() {
  const m = new Mesher();
  for (const x of [-2.9, 2.9])
    for (const z of [-1.9, 1.9])
      m.add(chamferBox(0.5, 4.6, 0.5, 0.12), P.cream, at(x, 2.3, z));
  for (const z of [-1.9, 1.9])
    m.add(chamferBox(6.6, 0.4, 0.4, 0.1), P.beam, at(0, 4.6, z));
  for (let i = 0; i < 7; i++)
    m.add(chamferBox(0.35, 0.35, 4.7, 0.08), P.beam, at(-3 + i, 4.95, 0));
  return m.build([3.6, 2.6]);
}
// 생울타리: 길이 len, 높이 1.7, 폭 1.8, 모서리 반경 0.25. 옆 #5fa955, 윗면 #6bb85b,
// 밑 0.3m는 짙은 띠(#4b8a46, 조금 더 넓은 상자로 감싼다).
export const HEDGE = { h: 1.7, d: 1.8, r: 0.25, band: 0.3 };
function hedge(len: number) {
  const m = new Mesher();
  m.add(chamferBox(len, HEDGE.h, HEDGE.d, HEDGE.r), topSide(P.leafLight, P.hedge), at(0, HEDGE.h / 2, 0));
  m.add(
    chamferBox(len + 0.06, HEDGE.band, HEDGE.d + 0.06, 0.08),
    P.hedgeBase,
    at(0, HEDGE.band / 2, 0),
  );
  return m.build([len / 2 + 0.3, HEDGE.d / 2 + 0.3]);
}
// 원뿔꼴로 다듬은 나무(용봉관 앞 잔디): 키 6.5, 밑 반지름 1.6, 짙은 초록 #3f7f45.
// 짧은 밑동 위에 원뿔 둘(아래 넓은 몸통, 위 뾰족한 끝)을 겹쳐 손으로 다듬은 듯 보이게 한다.
function coneTopiary() {
  const m = new Mesher();
  m.add(cyl(0.2, 0.26, 0.6, 6, false), P.bark, at(0, 0.3, 0));
  m.add(cyl(0.55, 1.6, 3.6, 10, "both"), P.topiary, at(0, 0.5 + 1.8, 0));
  m.add(cyl(0.001, 0.75, 2.6, 10, "both"), P.topiary, at(0, 4.0 + 1.3 - 0.1, 0));
  return m.build([1.7, 1.7]);
}
// 다듬은 소나무(민주마루 계단 옆): 살짝 기운 줄기에 구름처럼 다듬은 잎 판 셋. 키 약 4.8m.
function clippedPine() {
  const m = new Mesher();
  m.add(cyl(0.2, 0.3, 3.6, 6, false), P.bark, at(0, 1.8, 0, 0, 0, 0.1));
  const pads: [number, number, number, number, number, number, string][] = [
    [0.95, 2.3, 0.1, 1.45, 0.42, 1.15, P.pine],
    [-0.75, 3.3, -0.15, 1.25, 0.4, 1.05, P.pineLight],
    [0.15, 4.25, 0.05, 1.0, 0.38, 0.9, P.pine],
  ];
  pads.forEach(([x, y, z, sx, sy, sz, c], i) => {
    m.add(cyl(0.07, 0.09, Math.abs(x) + 0.2, 4, false), P.bark, at(x / 2, y - 0.25, z, 0, 0, Math.sign(x || 1) * -1.35));
    m.add(blob(1, 8, 5), c, at(x, y, z, i * 0.9, 0, 0, [sx, sy, sz]));
  });
  return m.build([1.6, 1.4]);
}
// 디딤돌(민주마루 앞 잔디): 2.6 × 0.8, 두께 0.15
function stepSlab() {
  const m = new Mesher();
  m.add(chamferBox(2.6, 0.15, 0.8, 0.04), P.stepSlab, at(0, 0.075, 0));
  return m.build([0, 0]);
}
// 혁명정신 계승비: 화강석 받침 2.0 × 2.0 × 0.8 위에 돌 1.2 × 1.2 × 1.6
function relicStone() {
  const m = new Mesher();
  m.add(chamferBox(2.0, 0.8, 2.0, 0.12), topSide(P.stone, P.granite), at(0, 0.4, 0));
  m.add(chamferBox(1.2, 1.6, 1.2, 0.18), P.stone, at(0, 0.8 + 0.8, 0));
  return m.build([1.3, 1.3]);
}
// 캠퍼스 게시판: 남색 기둥·지붕 틀, 크림 판에 글자 없는 종이 여섯 장. 3.6 × 0.5 × 3.2.
function board() {
  const m = new Mesher();
  for (const x of [-1.6, 1.6]) {
    const leg = new THREE.BoxGeometry(0.26, 3.2, 0.26);
    leg.deleteAttribute("uv");
    m.add(leg, P.navy, at(x, 1.6, 0));
  }
  m.add(chamferBox(3.3, 1.9, 0.2, 0.06), P.cream, at(0, 2.05, 0));
  m.add(chamferBox(3.7, 0.24, 0.5, 0.08), P.navy, at(0, 3.12, 0));
  const papers: [number, number, number, number, string][] = [
    [-1.05, 2.45, 0.7, 0.85, P.paperYellow],
    [-0.2, 2.5, 0.65, 0.8, P.white],
    [0.75, 2.4, 0.9, 0.7, P.paperMint],
    [-1.0, 1.55, 0.75, 0.65, P.paperRed],
    [0.0, 1.6, 0.6, 0.75, P.paperMint],
    [0.95, 1.55, 0.7, 0.7, P.paperYellow],
  ];
  for (const [x, y, w, h, c] of papers) {
    const g = new THREE.PlaneGeometry(w, h);
    g.deleteAttribute("uv");
    m.add(g, c, at(x, y, 0.11, 0, 0, (x * 7) % 0.08));
  }
  return m.build([2.0, 0.5]);
}
// 관목: 둥근 잎 덩이 셋(지름 약 3.9 × 높이 2.1)
function bush() {
  const m = new Mesher();
  m.add(blob(1), P.leaf, at(0, 0.95, 0, 0, 0, 0, [1.5, 1.1, 1.35]));
  m.add(blob(1), P.leafLight, at(0.9, 0.85, 0.35, 0.6, 0, 0, [0.95, 0.8, 0.9]));
  m.add(blob(1), P.hedge, at(-0.85, 0.75, -0.3, 1.2, 0, 0, [0.9, 0.7, 0.85]));
  return m.build([1.9, 1.6]);
}
// 잔디밭 꽃 한 포기: 잎 육각 받침 위 꽃 한 송이
function flower(color: string) {
  const m = new Mesher();
  const leaf = new THREE.CircleGeometry(0.45, 6);
  leaf.rotateX(-Math.PI / 2);
  leaf.deleteAttribute("uv");
  m.add(leaf, P.leafLight, at(0, 0.12, 0));
  m.add(new THREE.OctahedronGeometry(0.24), color, at(0, 0.36, 0, 0.4, 0, 0, [1, 0.8, 1]));
  return m.build([0.4, 0.4]);
}
// 메타세쿼이아 밑 나무 보호판(지름 3.2, 두께 0.12)
function treeGuard() {
  const m = new Mesher();
  m.add(cyl(1.6, 1.6, 0.12, 8), P.plate, at(0, 0.06, 0));
  return m.build([0, 0]);
}
// 오월 물길 테돌 한 마디(2.4 × 0.45 × 0.30): 윗면 돌색, 옆면 화강석
function edgeStone() {
  const m = new Mesher();
  const g = new THREE.BoxGeometry(2.32, 0.3, 0.45);
  g.deleteAttribute("uv");
  m.add(g, topSide(P.stone, P.granite), at(0, 0.15, 0));
  return m.build([0, 0]);
}
// 전남대 홍매 둘레 돌 테(지름 6, 높이 0.3)
function stoneRing() {
  const m = new Mesher();
  const g = new THREE.TorusGeometry(3.0, 0.32, 4, 16);
  g.deleteAttribute("uv");
  m.add(g, P.stone, at(0, 0.18, 0, 0, Math.PI / 2, 0, [1, 1, 0.6]));
  return m.build([0, 0]);
}

export type PropKind =
  | "bench"
  | "benchStone"
  | "lamp"
  | "planter"
  | "planterCalm"
  | "sign"
  | "bikeRack"
  | "bollard"
  | "bin"
  | "busStop"
  | "pergola"
  | "board"
  | "bush"
  | "flowerPink"
  | "flowerYellow"
  | "flowerWhite"
  | "treeGuard"
  | "edgeStone"
  | "stoneRing"
  | "coneTopiary"
  | "clippedPine"
  | "stepSlab"
  | "relicStone";
const MAKERS: Record<PropKind, () => Template> = {
  bench,
  benchStone,
  lamp,
  planter: () => planter([P.pink, P.yellow, P.white]),
  // 추모 장소: 돌빛과 흰 꽃만(결정 사항)
  planterCalm: () => planter([P.white]),
  sign,
  bikeRack,
  bollard,
  bin,
  busStop,
  pergola,
  board,
  bush,
  flowerPink: () => flower(P.pink),
  flowerYellow: () => flower(P.yellow),
  flowerWhite: () => flower(P.white),
  treeGuard,
  edgeStone,
  stoneRing,
  coneTopiary,
  clippedPine,
  stepSlab,
  relicStone,
};
export const PROP_KINDS = Object.keys(MAKERS) as PropKind[];
// 조용한 구역(5·18 사적지 둘레)에서 쓸 수 있는 소품: 돌색·크림·남색·초록·흰 꽃만
export const CALM_OK: ReadonlySet<PropKind | "hedge" | "signpost"> = new Set([
  "benchStone",
  "lamp",
  "planterCalm",
  "sign",
  "bollard",
  "bin",
  "bush",
  "hedge",
  "flowerWhite",
  "treeGuard",
  "edgeStone",
  "stoneRing",
  "coneTopiary",
  "stepSlab",
  "relicStone",
]);
// 종류마다 삼각형 상한(스타일 시트 7장)
export const PROP_TRIANGLE_CAP: Record<PropKind | "hedge" | "signpost", number> = {
  bench: 400,
  benchStone: 400,
  lamp: 250,
  planter: 300,
  planterCalm: 300,
  sign: 122,
  bikeRack: 350,
  bollard: 80,
  bin: 150,
  busStop: 900,
  pergola: 600,
  board: 150,
  bush: 260,
  flowerPink: 16,
  flowerYellow: 16,
  flowerWhite: 16,
  treeGuard: 32,
  edgeStone: 44,
  stoneRing: 160,
  coneTopiary: 160,
  clippedPine: 330,
  stepSlab: 44,
  relicStone: 88,
  hedge: 120,
  signpost: 200,
};

const cache = new Map<string, Template>();
export function propTemplate(kind: PropKind): Template {
  let t = cache.get(kind);
  if (!t) cache.set(kind, (t = MAKERS[kind]()));
  return t;
}
// 생울타리는 길이(0.5m 단위)마다 따로 만든다
export function hedgeTemplate(len: number): Template {
  const L = Math.max(1.5, Math.round(len * 2) / 2),
    key = `hedge:${L}`;
  let t = cache.get(key);
  if (!t) cache.set(key, (t = hedge(L)));
  return t;
}
