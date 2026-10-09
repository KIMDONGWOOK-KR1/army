import * as THREE from "three";
import {
  at,
  Inst,
  metasequoia,
  mulberry,
  pine,
  roundTree,
  type Trees,
} from "./field-kit";
import {
  bloomModel,
  calmGateFlowers,
  calmHallFlowers,
  gateModel,
  HALL_SIZE,
  hallModel,
  lightHallRoof,
  stoneModel,
  towerModel,
} from "./field-landmarks";
import type { FieldAssets, TreeKind, TreeLod } from "./field-assets";
import { buildBuildings, ROOF_COLOR } from "./field-buildings";
import { calmZones, type CalmZone } from "./field-calm";
import { isPhoneView, worldMaterial } from "./field-clay";
import {
  insidePoly,
  Occupancy,
  type MapData,
  type Updater,
} from "./field-geom";
import { buildGround, GROUND_COLORS } from "./field-ground";
import { LodInstancer, type LodLevel, type LodShape } from "./field-instances";
import { seeThrough, type SeeKind } from "./field-occlusion";
import { buildProps, type TreeSpot } from "./field-props";
import { markerAt } from "./field-stop";
import { polylineLength, type XZ } from "@/lib/geo";

// 오픈스트리트맵에서 구운 지도 자료(scripts/build-map.mjs)를 실제 축척(1단위 = 1m)의
// 점토 디오라마로 깐다. 좌표는 정문 기준 미터, x 동쪽, z 남쪽이다.
// 지도 자료 모양과 기하 도구는 field-geom.ts, 일반 건물은 field-buildings.ts,
// 거리 소품은 field-props.ts, 캐릭터 시야 구멍은 field-occlusion.ts에 있다.
export type { MapData } from "./field-geom";

// 포켓몬고 낮 지도처럼: 민트빛 바탕, 초록 공원, 노란 테를 두른 회청색 길, 낮고 옅은 건물.
// 캐릭터 둘레는 풀빛 마을 땅이 된다(field-ground.ts). 층 높이 표는 field-ground.ts의 LAYER 하나다.
export const MAP_COLORS = {
  ground: GROUND_COLORS.base,
  groundB: GROUND_COLORS.baseB,
  edge: GROUND_COLORS.edge, // 차도 테
  roof: ROOF_COLOR,
};
const TILE = 160;

// 블렌더 나무를 받지 못했을 때 쓰는 코드 나무: 160m 구역마다 묶어 화면·그림자 밖 구역은 그리지 않는다
class Tiled {
  private tiles = new Map<string, Inst>();
  add(m: THREE.Matrix4, color: string) {
    const key = `${Math.floor(m.elements[12] / TILE)},${Math.floor(m.elements[14] / TILE)}`;
    let t = this.tiles.get(key);
    if (!t) this.tiles.set(key, (t = new Inst()));
    t.add(m, color);
  }
  meshes(geo: THREE.BufferGeometry) {
    if (process.env.NODE_ENV !== "production")
      console.info(
        "field tree parts",
        [...this.tiles.values()].reduce((n, t) => n + t.count, 0),
        "in",
        this.tiles.size,
        "tiles",
      );
    return [...this.tiles.values()].map((t) => {
      const mesh = t.mesh(geo);
      mesh.computeBoundingSphere();
      return mesh;
    });
  }
}

// 블렌더 나무 모형의 거리 단계: 캐릭터 둘레 55m 안은 자세한 모형(그림자를 드리운다),
// 190m까지는 줄인 모형(_lo, 같은 종류는 한 모양을 함께 쓰고 크기만 맞춘다), 그 밖 안개까지는
// 코드로 만든 48삼각형 덩어리. 단계·형상마다 InstancedMesh 하나라 나무 그리기는 10번 이하다.
// (55m: 메타세쿼이아 줄이 빽빽한 민주대로에서 그림자 패스 삼각형을 8만 아래로 묶는 거리)
export const TREE_LOD: LodLevel[] = [
  { max: 55, castShadow: true },
  { max: 190 },
  { max: 600, receiveShadow: false },
];
// 먼 나무 덩어리: 아래 12%부터 둥글게 솟은 수관(줄기는 안개 속이라 뺀다). 키·너비 1.
let farTreeGeo: THREE.BufferGeometry | null = null;
export function farTree() {
  if (farTreeGeo) return farTreeGeo;
  const g = new THREE.LatheGeometry(
    [
      [0.001, 0.12],
      [0.8, 0.24],
      [1, 0.5],
      [0.72, 0.82],
      [0.001, 1],
    ].map(([r, y]) => new THREE.Vector2(r * 0.5, y)),
    6,
  );
  g.computeVertexNormals();
  const p = g.attributes.position,
    col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++)
    col.fill(0.8 + 0.28 * p.getY(i), i * 3, i * 3 + 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  g.userData.shared = true;
  farTreeGeo = g;
  return g;
}
const boxes = new WeakMap<THREE.BufferGeometry, THREE.Box3>();
function boxOf(g: THREE.BufferGeometry) {
  let b = boxes.get(g);
  if (!b) {
    g.computeBoundingBox();
    b = g.boundingBox!.clone();
    boxes.set(g, b);
  }
  return b;
}
// 형상 g를 기준 형상 ref의 상자(바닥·가운데·크기)에 맞추는 변환
function fitTo(ref: THREE.BufferGeometry, g: THREE.BufferGeometry) {
  const a = boxOf(ref),
    b = boxOf(g),
    sa = a.getSize(new THREE.Vector3()),
    sb = b.getSize(new THREE.Vector3()),
    ca = a.getCenter(new THREE.Vector3()),
    cb = b.getCenter(new THREE.Vector3());
  return new THREE.Matrix4()
    .makeTranslation(ca.x, a.min.y, ca.z)
    .multiply(
      new THREE.Matrix4().makeScale(
        sa.x / Math.max(1e-3, sb.x),
        sa.y / Math.max(1e-3, sb.y),
        sa.z / Math.max(1e-3, sb.z),
      ),
    )
    .multiply(new THREE.Matrix4().makeTranslation(-cb.x, -b.min.y, -cb.z));
}
// 자세한 모형 수관(위쪽 70%)의 평균 꼭짓점 색: 먼 덩어리를 같은 빛깔로 칠한다
function crownTint(g: THREE.BufferGeometry) {
  const c = g.attributes.color,
    p = g.attributes.position,
    top = boxOf(g).max.y,
    out = new THREE.Color(0, 0, 0);
  if (!c) return new THREE.Color(0.35, 0.6, 0.3);
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < top * 0.3) continue;
    out.r += c.getX(i);
    out.g += c.getY(i);
    out.b += c.getZ(i);
    n++;
  }
  return n ? out.multiplyScalar(1 / n) : new THREE.Color(0.35, 0.6, 0.3);
}
function treeInstancer(kit: Record<TreeKind, TreeLod[]>, phone: boolean) {
  const family = new Map<TreeLod, TreeKind>();
  for (const k of Object.keys(kit) as TreeKind[])
    for (const l of kit[k]) family.set(l, k);
  return new LodInstancer<TreeLod>({
    name: "trees",
    levels: TREE_LOD,
    // 나무는 부드러운 시야 구멍(가운데를 다 걷어 낸다)
    material: seeThrough(worldMaterial(phone, 0.9), "soft"),
    shape(lod): LodShape {
      const lo = kit[family.get(lod) ?? "round"][0].lo,
        far = farTree();
      return {
        geos: [lod.hi, lo, far],
        fit: [null, lo === lod.lo ? null : fitTo(lod.hi, lo), fitTo(lod.hi, far)],
        tint: [null, null, crownTint(lod.hi)],
      };
    },
  });
}

// 나무 한 그루: 종류, 자리, 크기, 모양·색을 고르는 난수 두 개(a, b).
// 메타세쿼이아는 a에 색 번호(0~2)를 담는다.
type TreeSpec = {
  k: TreeKind;
  x: number;
  z: number;
  s: number;
  a: number;
  b: number;
};
const fract = (v: number) => v - Math.floor(v);

// 블렌더 나무로 심는다: 모양은 a, 방향은 b로 고르고 밝기를 살짝 달리한다.
function kitTree(
  forest: LodInstancer<TreeLod>,
  kit: Record<TreeKind, TreeLod[]>,
  t: TreeSpec,
) {
  const lods = kit[t.k];
  let lod: TreeLod, ry: number, k: number, warm: number;
  if (t.k === "meta") {
    lod = lods[0];
    ry =
      fract(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) * Math.PI * 2;
    k = [1, 0.95, 1.05][t.a] ?? 1;
    warm = 0;
  } else if (t.k === "pine") {
    lod = lods[(t.a < 0.5 ? 0 : 1) % lods.length];
    ry = fract(t.b * 13.7) * Math.PI * 2;
    k = 0.94 + 0.1 * fract(t.b * 3.7);
    warm = 0;
  } else {
    lod = lods[Math.floor(t.a * lods.length) % lods.length];
    ry = t.b * Math.PI * 2;
    k = 0.92 + 0.14 * fract(t.a * 7.13);
    warm = 0.05 * (fract(t.b * 5.31) - 0.5);
  }
  forest.add(
    lod,
    at([t.x, 0, t.z], [t.s, t.s, t.s], ry),
    new THREE.Color(k * (1 + warm), k, k * (1 - warm)),
  );
}

// 코드 모형으로 심는다: 함수 안에서 뽑던 난수 두 개를 a, b로 차례로 돌려준다.
function blockTree(trees: Trees, t: TreeSpec) {
  if (t.k === "meta") return metasequoia(trees, t.x, t.z, t.s, t.a);
  let n = 0;
  const replay = () => (n++ === 0 ? t.a : t.b);
  if (t.k === "pine") pine(trees, replay, t.x, t.z, t.s);
  else roundTree(trees, replay, t.x, t.z, t.s);
}

export type MapWorld = {
  sites: XZ[];
  // 5·18 조용한 구역(field-calm.ts): 거점 표석·발밑 물결이 움직임을 멈출 자리
  calm: CalmZone[];
  legs: number[][];
  legLength: number[];
  radius: number;
  // 매 프레임 캐릭터 자리(x, z)와 카메라에 맞춰 나무·건물·소품의 가까이·멀리 모양을 고른다
  update: Updater;
  // update의 옛 이름(카메라 없이)
  lod: (x: number, z: number) => void;
};

export function buildMap(
  scene: THREE.Scene,
  data: MapData,
  assets?: FieldAssets | null,
): MapWorld {
  const rnd = mulberry(518),
    tiles = { blob: new Tiled(), cone: new Tiled(), trunk: new Tiled() },
    trees: Trees = tiles;
  const A = data.anchors,
    xz = (p: [number, number]) => ({ x: p[0], z: p[1] }),
    gate = xz(A.gate),
    tower = A.tower ? xz(A.tower) : null,
    hallBox = data.boxes.hall;

  // 땅·길·물(바탕·면·길·횡단보도·화단·물길). 나무를 심지 못하는 칸도 여기서 표시한다.
  const phone = isPhoneView(),
    occ = new Occupancy(-1600, -1600, 640),
    calm = calmZones(data),
    ground = buildGround(scene, data, occ, calm, phone);

  // 건물 자리에는 나무를 심지 않는다(용봉관은 모형 둘레까지 넉넉히 비운다).
  // 건물 형상은 field-buildings.ts가 만든다.
  for (const bd of data.buildings)
    occ.polygon(bd.p, bd.name === "용봉관" ? 6 : 2);
  const updaters: Updater[] = [ground.update];
  const ctx = { assets, occ, phone };
  updaters.push(buildBuildings(scene, data, ctx).update);

  // 모형 자리는 비워 둔다
  occ.circle(gate.x, gate.z, 22);
  if (tower) occ.circle(tower.x, tower.z, 9);
  for (const k of ["stone", "bloom"]) if (A[k]) occ.circle(A[k][0], A[k][1], 7);
  // 거점 표석 자리(거점에서 비켜 선다)도 비운다: 받침 8m에 펼친 기록 액자가 선다
  const siteList: XZ[] = [gate, ...(A.hall ? [xz(A.hall)] : [])],
    markers = siteList.map((p, i) => markerAt(i, p));
  for (const m of markers) occ.circle(m.x, m.z, 7);

  // 나무: 정문~용봉탑 메타세쿼이아 가로수, 지도에 찍힌 나무, 숲·잔디밭에 흩어 심은 나무.
  // 모양·색을 고를 난수도 같은 차례로 미리 뽑아 두어, 블렌더 나무든 코드 나무든 같은 자리에 선다.
  const plan: TreeSpec[] = [];
  for (let i = 0; i < data.rows.length; i += 2) {
    const s = 3.4 + rnd() * 0.5;
    plan.push({
      k: "meta",
      x: data.rows[i],
      z: data.rows[i + 1],
      s,
      a: Math.floor(rnd() * 3),
      b: 0,
    });
    occ.circle(data.rows[i], data.rows[i + 1], 3);
  }
  for (let i = 0; i < data.trees.length; i += 2)
    if (!occ.blocked(data.trees[i], data.trees[i + 1])) {
      const s = 2.4 + rnd() * 1.2;
      plan.push({
        k: "round",
        x: data.trees[i],
        z: data.trees[i + 1],
        s,
        a: rnd(),
        b: rnd(),
      });
    }
  for (const a of data.areas) {
    if (a.k !== "wood" && a.k !== "grass") continue;
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < a.p.length; i += 2) {
      minX = Math.min(minX, a.p[i]);
      maxX = Math.max(maxX, a.p[i]);
      minZ = Math.min(minZ, a.p[i + 1]);
      maxZ = Math.max(maxZ, a.p[i + 1]);
    }
    const n = Math.min(
      400,
      Math.round(
        ((maxX - minX) * (maxZ - minZ)) / (a.k === "wood" ? 110 : 650),
      ),
    );
    for (let k = 0; k < n; k++) {
      const x = minX + rnd() * (maxX - minX),
        z = minZ + rnd() * (maxZ - minZ);
      if (!insidePoly(a.p, x, z) || occ.blocked(x, z)) continue;
      const k: TreeKind = a.k === "wood" && rnd() < 0.3 ? "pine" : "round",
        s = k === "pine" ? 2.4 + rnd() * 0.9 : 2.2 + rnd() * 1.4;
      plan.push({ k, x, z, s, a: rnd(), b: rnd() });
      occ.mark(x, z);
    }
  }
  // 용봉관 앞 잔디의 원뿔꼴로 다듬은 나무 줄은 소품 키트로 세운다(field-dressing.ts)
  const kit = assets?.trees,
    forest = kit ? treeInstancer(kit, phone) : null;
  for (const t of plan)
    if (forest && kit) kitTree(forest, kit, t);
    else blockTree(trees, t);

  // 정문·용봉탑·용봉관·추모 조형물을 실제 자리와 방향에 세운다
  const toward = (from: XZ, to: XZ) => Math.atan2(to.x - from.x, to.z - from.z);
  // 블렌더 모형을 못 받았을 때 쓰는 코드 모형·코드 나무도 시야 구멍 재질로 그린다
  // (나무는 부드러운 구멍)
  const cut = <T extends THREE.Object3D>(o: T, kind: SeeKind = "solid") => {
    o.traverse((m) => {
      if (m instanceof THREE.Mesh)
        for (const x of Array.isArray(m.material) ? m.material : [m.material])
          seeThrough(x, kind);
    });
    return o;
  };
  const place = (g: THREE.Group, p: XZ, ry: number, s: number) => {
    cut(g);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = ry;
    g.scale.setScalar(s);
    scene.add(g);
  };
  // 블렌더 모형은 꼭짓점 색을 그대로 쓰는 한 덩어리 형상이다
  const clay = seeThrough(worldMaterial(phone, 0.88));
  const solid = (geo: THREE.BufferGeometry) => {
    const g = new THREE.Group(),
      m = new THREE.Mesh(geo, clay);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return g;
  };
  // 정문 모형의 +z(바깥)는 용봉탑 반대쪽, 문 사이 너비 8.9 ≈ 4차로 15m.
  // 블렌더 정문도 같은 장난감 축척으로 만들어 배율이 같다.
  // 정문 분리대 돌 화분의 노란 꽃은 흰 꽃으로(조용한 구역)
  if (assets?.gate) calmGateFlowers(assets.gate);
  place(
    assets?.gate ? solid(assets.gate) : gateModel(),
    gate,
    tower ? toward(gate, tower) + Math.PI : 0,
    1.65,
  );
  // 사적비는 실제 크기(m)로 빚었다
  if (A.stone) place(stoneModel(), xz(A.stone), toward(xz(A.stone), gate), 1);
  if (A.bloom) place(bloomModel(), xz(A.bloom), toward(xz(A.bloom), gate), 2);
  // 블렌더 용봉탑은 실제 크기(높이 약 15m)로 만들었다
  if (tower)
    place(
      assets?.tower ? solid(assets.tower) : towerModel(),
      tower,
      toward(tower, gate),
      assets?.tower ? 1 : 1.95,
    );
  if (hallBox) {
    let h: THREE.Group;
    if (assets?.hall) {
      // 블렌더 용봉관은 실제 크기(날개 끝까지 44m, 3층 13m, 시계탑 22m)라 가로만 윤곽에 맞춘다
      calmHallFlowers(assets.hall);
      lightHallRoof(assets.hall);
      h = solid(assets.hall);
      h.scale.setScalar(hallBox.w / 44.4);
    } else {
      // 지도 윤곽(가로 w, 깊이 d)에 맞추고, 3층 몸체(모형 4.8)가 13m 남짓 되게 세운다
      h = cut(hallModel());
      h.scale.set(hallBox.w / HALL_SIZE.w, 2.7, hallBox.d / HALL_SIZE.d);
    }
    h.position.set(hallBox.c[0], 0, hallBox.c[1]);
    h.rotation.y = hallBox.a;
    scene.add(h);
  }

  if (forest) {
    updaters.push(forest.build(scene));
    if (process.env.NODE_ENV !== "production")
      console.info("field kit trees", plan.length, "meshes", forest.meshes.length);
  } else
    scene.add(
      ...[
        ...tiles.blob.meshes(new THREE.SphereGeometry(1, 12, 8)),
        ...tiles.cone.meshes(new THREE.ConeGeometry(1, 1, 10)),
        ...tiles.trunk.meshes(new THREE.CylinderGeometry(1, 1, 1, 6)),
      ].map((m) => cut(m, "soft")),
    );
  // 거리 소품(벤치·가로등·화단 등)과 소품·나무 블롭 그늘: 캐릭터 둘레 80m에 걸치는 구역에만
  const spots: TreeSpot[] = plan.map((t) => ({
    x: t.x,
    z: t.z,
    r:
      t.k === "meta"
        ? 1.0 * t.s
        : t.k === "pine"
          ? 1.25 * t.s
          : 1.15 * t.s,
    meta: t.k === "meta",
  }));
  const props = buildProps(data, ctx, {
    trees: spots,
    ground,
    calm,
    legs: data.legs,
    sites: siteList,
    markers,
  });
  scene.add(props.group);
  updaters.push(props.update);
  // 카메라를 넘기지 않으면(옛 lod 호출) 땅을 그린 지난 프레임의 카메라로 화면 밖을 고른다
  const update: Updater = (x, z, camera) => {
    const cam = camera ?? ground.camera() ?? undefined;
    for (const u of updaters) u(x, z, cam);
  };

  const hall: XZ = A.hall ? xz(A.hall) : gate;
  const legs = data.legs.length
    ? data.legs
    : [
        [gate.x, gate.z + 120, gate.x, gate.z],
        [gate.x, gate.z, hall.x, hall.z],
      ];
  return {
    sites: [gate, hall],
    calm,
    legs,
    legLength: legs.map(polylineLength),
    radius: 30,
    update,
    lod: (x, z) => update(x, z),
  };
}
