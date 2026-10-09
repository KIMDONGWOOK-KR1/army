import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// 입체 필드의 공용 부품: 색, 형상 합치기, 인스턴싱, 나무, 장병 캐릭터. 거점 표석은 field-stop.ts.

export const C = {
  sky: "#c4e8fb",
  grass: "#8fcf6a",
  lawn: "#a6da7d",
  hedge: "#5fa955",
  path: "#f2e6c6",
  pave: "#e6d7b2",
  road: "#d4ccbb",
  curb: "#fbf3df",
  water: "#62c0ef",
  stone: "#ece2c9",
  granite: "#d9d0c0",
  graniteJoint: "#bdb2a0",
  beam: "#54463b",
  guard: "#e2d5b8",
  guardShade: "#cdbf9f",
  bronze: "#b4875a",
  patina: "#6c826e",
  patinaDark: "#4e5f52",
  cream: "#f4e8cb",
  creamShade: "#e6d6b2",
  white: "#fbf7ee",
  brick: "#bd5940",
  brickDark: "#9c4634",
  roof: "#7d90b5",
  roofTop: "#a9b5cc",
  roofDeck: "#bcb0a0",
  frame: "#fffaf0",
  pane: "#3c5f95",
  track: "#d9845d",
  field: "#7ccb5e",
  leaf: ["#5aa952", "#6bb85b", "#7fc565", "#4f9c4b"],
  cone: ["#4c9650", "#57a259", "#63ad61"],
  pine: ["#3c7a48", "#468650", "#3f8150"],
  flower: ["#ef7088", "#f6c74e", "#fff6ea"],
  trunk: "#8f6545",
  hill: ["#8cc48c", "#7fb987", "#98cb8f"],
  pin: "#e8452c",
  olive: "#6b7d42",
  oliveDark: "#4f5e2f",
  skin: "#f6d2ab",
  hair: "#3b2b22",
  boot: "#3a3226",
};

export type V3 = [number, number, number];

// 같은 재질의 고정 물체를 한 덩어리로 합쳐 그리기 횟수를 줄인다.
// 꼭짓점 색에 바닥 쪽을 살짝 어둡게 하는 가짜 그늘(ao)을 굽는다.
export class Batch {
  private parts: THREE.BufferGeometry[] = [];
  // keepUv: 무늬(창 등)를 입힐 덩어리는 uv를 남긴다. 한 덩어리 안 형상은 모두 uv가 있어야 한다.
  constructor(private keepUv = false) {}
  add(
    geo: THREE.BufferGeometry,
    color:
      | string
      | ((
          x: number,
          y: number,
          z: number,
          nx: number,
          ny: number,
          nz: number,
        ) => THREE.Color),
    matrix: THREE.Matrix4,
    ao = 0,
  ) {
    // 둥근 상자는 색인 없는 형상이라 모두 색인 없이 맞춰 합친다.
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(
      matrix,
    );
    if (!this.keepUv) g.deleteAttribute("uv");
    const pos = g.attributes.position,
      nor = g.attributes.normal,
      col = new Float32Array(pos.count * 3),
      base = typeof color === "string" ? new THREE.Color(color) : null;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i),
        c =
          base ??
          (color as Exclude<typeof color, string>)(
            x,
            y,
            z,
            nor?.getX(i) ?? 0,
            nor?.getY(i) ?? 1,
            nor?.getZ(i) ?? 0,
          ),
        k = ao > 0 ? 0.7 + 0.3 * Math.min(1, Math.max(0, y / ao)) : 1;
      col[i * 3] = c.r * k;
      col[i * 3 + 1] = c.g * k;
      col[i * 3 + 2] = c.b * k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }
  get empty() {
    return this.parts.length === 0;
  }
  mesh(material: THREE.Material) {
    const merged = mergeGeometries(this.parts)!;
    if (process.env.NODE_ENV !== "production")
      console.info("field batch vertices", merged.attributes.position.count);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    return new THREE.Mesh(merged, material);
  }
}

// 나무처럼 같은 모양이 많이 반복되는 것은 GPU 인스턴싱으로 그린다.
export class Inst {
  private list: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  add(m: THREE.Matrix4, color: string) {
    this.list.push({ m, c: new THREE.Color(color) });
  }
  get count() {
    return this.list.length;
  }
  mesh(geo: THREE.BufferGeometry) {
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      this.list.length,
    );
    this.list.forEach(({ m, c }, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}
// 나무 부품을 받는 쪽: 한 덩어리(Inst)든 구역별 덩어리든 add만 있으면 된다.
export type Adder = { add(m: THREE.Matrix4, color: string): void };
export type Trees = { blob: Adder; cone: Adder; trunk: Adder };

export const UNIT = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  bush: new THREE.SphereGeometry(1, 9, 6),
  cone: new THREE.ConeGeometry(1, 1, 12),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  circle: new THREE.CylinderGeometry(1, 1, 1, 36),
  capsule: new THREE.CapsuleGeometry(0.13, 0.36, 3, 8),
  ring: new THREE.RingGeometry(0.985, 1, 64),
};
const rounded = new Map<string, THREE.BufferGeometry>();
export function rbox(w: number, h: number, d: number, r: number) {
  const key = [w, h, d, r].join(":");
  let g = rounded.get(key);
  if (!g) {
    // 얇은 띠·창턱·기둥은 모서리를 굴리지 않은 상자로 충분하다.
    g =
      r <= 0.05
        ? new THREE.BoxGeometry(w, h, d)
        : new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));
    rounded.set(key, g);
  }
  return g;
}
export const atE = (p: V3, s: V3, r: V3, order: THREE.EulerOrder = "XYZ") =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, order)),
    new THREE.Vector3(...s),
  );
export const at = (p: V3, s: V3 = [1, 1, 1], ry = 0) => atE(p, s, [0, ry, 0]);
// 앞(+z)을 보는 납작한 원판
export const disc = (p: V3, r: number, t: number) =>
  atE(p, [r, t, r], [Math.PI / 2, 0, 0]);
export const shade = (hex: string, k: number) =>
  "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();

export function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rect = { x: number; z: number; w: number; d: number };
export const inside = (r: Rect, x: number, z: number, pad: number) =>
  Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(z - r.z) < r.d / 2 + pad;

export class Windows {
  frames: THREE.Matrix4[] = [];
  panes: THREE.Matrix4[] = [];
  add(x: number, y: number, z: number, ry: number, w: number, h: number) {
    this.frames.push(at([x, y, z], [w + 0.16, h + 0.16, 1], ry));
    this.panes.push(at([x, y, z], [w, h, 1], ry));
  }
  get count() {
    return this.panes.length;
  }
  meshes() {
    const make = (list: THREE.Matrix4[], depth: number, color: string) => {
      const m = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, depth),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
        list.length,
      );
      list.forEach((mat, i) => m.setMatrixAt(i, mat));
      return m;
    };
    return [make(this.frames, 0.07, C.frame), make(this.panes, 0.09, C.pane)];
  }
}

export function metasequoia(
  t: Trees,
  x: number,
  z: number,
  s: number,
  tone: number,
) {
  t.trunk.add(at([x, 0.7, z], [0.16 * s, 1.4, 0.16 * s]), C.trunk);
  const col = C.cone[tone % C.cone.length];
  t.cone.add(at([x, 2.3 * s, z], [1.0 * s, 2.8 * s, 1.0 * s]), col);
  t.cone.add(
    at([x, 3.5 * s, z], [0.78 * s, 2.4 * s, 0.78 * s]),
    shade(col, 1.06),
  );
  t.cone.add(
    at([x, 4.6 * s, z], [0.52 * s, 1.8 * s, 0.52 * s]),
    shade(col, 1.12),
  );
}

export function roundTree(
  t: Trees,
  rnd: () => number,
  x: number,
  z: number,
  s: number,
) {
  const col = C.leaf[Math.floor(rnd() * C.leaf.length)];
  t.trunk.add(at([x, 0.6 * s, z], [0.2 * s, 1.2 * s, 0.2 * s]), C.trunk);
  t.blob.add(at([x, 1.75 * s, z], [1.15 * s, 1.1 * s, 1.15 * s]), col);
  const a = rnd() * Math.PI * 2;
  t.blob.add(
    at(
      [x + Math.cos(a) * 0.55 * s, 2.35 * s, z + Math.sin(a) * 0.55 * s],
      [0.72 * s, 0.7 * s, 0.72 * s],
    ),
    shade(col, 1.07),
  );
  t.blob.add(
    at(
      [x - Math.cos(a) * 0.6 * s, 1.45 * s, z - Math.sin(a) * 0.6 * s],
      [0.7 * s, 0.62 * s, 0.7 * s],
    ),
    shade(col, 0.95),
  );
}

// 정문·용봉탑 둘레의 소나무: 살짝 기운 줄기에 납작한 잎 덩어리를 층층이 얹는다.
export function pine(
  t: Trees,
  rnd: () => number,
  x: number,
  z: number,
  s: number,
) {
  const lean = (rnd() - 0.5) * 0.3,
    col = C.pine[Math.floor(rnd() * C.pine.length)];
  t.trunk.add(
    atE([x, 1.1 * s, z], [0.17 * s, 2.2 * s, 0.17 * s], [0, 0, lean]),
    C.trunk,
  );
  const tx = x - Math.sin(lean) * 2 * s;
  for (const [dx, dz, y, r] of [
    [0, 0, 2.3, 1.35],
    [0.55, -0.3, 2.95, 1.0],
    [-0.45, 0.35, 3.45, 0.8],
  ])
    t.blob.add(
      at([tx + dx * s, y * s, z + dz * s], [r * s, r * 0.42 * s, r * s]),
      shade(col, 1 + y * 0.03),
    );
}

// C02 v2 기준의 SD 장병: 큰 머리, 짧은 몸, 간소한 올리브 군복, 가슴에 역할 색 배지.
export function soldier(roleColor: string) {
  const g = new THREE.Group();
  const m = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const part = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    color: string,
    p: V3,
    s: V3 = [1, 1, 1],
  ) => {
    const mesh = new THREE.Mesh(geo, m(color));
    mesh.position.set(...p);
    mesh.scale.set(...s);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const limb = (x: number, y: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    g.add(pivot);
    return pivot;
  };
  const legs = [limb(-0.19, 0.62), limb(0.19, 0.62)];
  for (const leg of legs) {
    part(
      leg,
      new THREE.CapsuleGeometry(0.15, 0.22, 4, 10),
      C.oliveDark,
      [0, -0.2, 0],
    );
    part(
      leg,
      new THREE.CapsuleGeometry(0.16, 0.12, 4, 10),
      C.boot,
      [0, -0.46, 0.04],
      [1, 1, 1.25],
    );
  }
  part(
    g,
    new THREE.CapsuleGeometry(0.42, 0.32, 6, 16),
    C.olive,
    [0, 1.0, 0],
    [1, 1, 0.86],
  );
  part(
    g,
    new THREE.CylinderGeometry(0.43, 0.43, 0.1, 20),
    C.oliveDark,
    [0, 0.82, 0],
    [1, 1, 0.88],
  );
  part(g, new THREE.BoxGeometry(0.16, 0.12, 0.04), "#c9b27a", [0, 0.82, 0.38]);
  for (const x of [-0.17, 0.17])
    part(g, new THREE.BoxGeometry(0.2, 0.16, 0.05), C.oliveDark, [
      x,
      1.12,
      0.36,
    ]);
  part(
    g,
    new THREE.CylinderGeometry(0.13, 0.13, 0.04, 20),
    roleColor,
    [0.17, 1.17, 0.4],
  ).rotation.x = Math.PI / 2;
  part(
    g,
    new THREE.CylinderGeometry(0.3, 0.38, 0.12, 20),
    C.oliveDark,
    [0, 1.38, 0.02],
    [1, 1, 0.9],
  );
  const arms = [limb(-0.5, 1.24), limb(0.5, 1.24)];
  arms.forEach((arm, i) => {
    arm.rotation.z = i ? -0.18 : 0.18;
    part(
      arm,
      new THREE.CapsuleGeometry(0.12, 0.34, 4, 10),
      C.olive,
      [0, -0.26, 0],
    );
    part(arm, new THREE.SphereGeometry(0.12, 12, 10), C.skin, [0, -0.52, 0]);
  });
  const head = new THREE.Group();
  head.position.y = 1.5;
  head.rotation.x = -0.42;
  g.add(head);
  part(
    head,
    new THREE.SphereGeometry(0.64, 28, 20),
    C.skin,
    [0, 0.58, 0],
    [1, 0.96, 0.96],
  );
  part(
    head,
    new THREE.SphereGeometry(0.66, 28, 20, 0, Math.PI * 2, 0, 1.25),
    C.hair,
    [0, 0.62, -0.06],
  );
  for (const x of [-0.63, 0.63])
    part(head, new THREE.SphereGeometry(0.12, 12, 10), C.skin, [x, 0.56, 0]);
  part(
    head,
    new THREE.CylinderGeometry(0.6, 0.66, 0.36, 28),
    C.olive,
    [0, 1.05, -0.02],
  );
  part(
    head,
    new THREE.CylinderGeometry(0.58, 0.6, 0.06, 28),
    C.oliveDark,
    [0, 1.25, -0.02],
  );
  const brim = part(
    head,
    new THREE.CylinderGeometry(
      0.34,
      0.34,
      0.06,
      24,
      1,
      false,
      -Math.PI / 2,
      Math.PI,
    ),
    C.oliveDark,
    [0, 0.9, 0.38],
    [1.25, 1, 1],
  );
  brim.rotation.x = 0.12;
  for (const x of [-0.21, 0.21]) {
    part(
      head,
      new THREE.SphereGeometry(0.085, 14, 12),
      "#2a2622",
      [x, 0.6, 0.6],
      [1, 1.25, 0.6],
    );
    part(head, new THREE.SphereGeometry(0.03, 8, 6), "#ffffff", [
      x + 0.03,
      0.66,
      0.65,
    ]);
  }
  for (const x of [-0.38, 0.38])
    part(
      head,
      new THREE.SphereGeometry(0.09, 12, 8),
      "#f4a58f",
      [x, 0.43, 0.54],
      [1, 0.6, 0.4],
    );
  part(
    head,
    new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI),
    "#8a4f3a",
    [0, 0.4, 0.63],
  ).rotation.z = Math.PI;

  // 발밑 고리: 역할 색 테두리 + 흰 안쪽
  const ring = new THREE.Group();
  const disc = (
    r0: number,
    r1: number,
    color: string,
    o: number,
    y: number,
  ) => {
    const d = new THREE.Mesh(
      new THREE.RingGeometry(r0, r1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: o,
        depthWrite: false,
      }),
    );
    d.rotation.x = -Math.PI / 2;
    d.position.y = y;
    ring.add(d);
  };
  disc(0, 0.95, "#ffffff", 0.35, 0.03);
  disc(0.95, 1.2, roleColor, 0.85, 0.035);
  g.add(ring);
  g.scale.setScalar(2.3);
  return { group: g, legs, arms, head };
}
