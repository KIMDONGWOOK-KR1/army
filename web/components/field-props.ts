import * as THREE from "three";
import {
  frontOf,
  hash,
  insidePoly,
  type FieldCtx,
  type Front,
  type MapBuilding,
  type MapData,
} from "./field-geom";
import { calmZones, inCalm, type CalmZone } from "./field-calm";
import { crosswalkBars, LAYER, SegGrid, type Ground } from "./field-ground";
import { BlobShadows } from "./field-instances";
import { isPhoneView, worldMaterial } from "./field-clay";
import { hallTopiaries, minjumaruDressing, relicStone } from "./field-dressing";
import { chainOnBeforeCompile, seeThrough } from "./field-occlusion";
import {
  CALM_OK,
  hedgeTemplate,
  propTemplate,
  signpost,
  type PropKind,
  type Template,
} from "./field-props-kit";
import type { XZ } from "@/lib/geo";

// 캐릭터 둘레 80m에 걸치는 구역에만 서는 손으로 만든 듯한 거리 소품. 자리는 모두 지도 자료에서
// 결정론적으로 정한다: ① 오픈스트리트맵 지물(벤치·거치대·쉼터·정류장·휴지통·횡단보도),
// ② 시연 경로(가로등·벤치·휴지통·생울타리·꽃·길 안내 기둥), ③ 건물 정면(frontOf·출입구:
// 화분·빈 안내판·거치대, 보행로를 보는 벽의 관목), ④ 메타세쿼이아 보호판·물길 테돌.
// 그리기는 176m 구역마다 한 덩어리(구역 하나 = 그리기 1번)이고 소품 그늘은 블롭 하나로 그린다.
// 조용한 구역(5·18 사적지 둘레)은 돌색·크림·남색·초록·흰 꽃 변형만 쓰고 바로 나타난다.

export type TreeSpot = { x: number; z: number; r: number; meta: boolean };
export type PropKindX = PropKind | "hedge" | "signpost";
export type Placed = {
  kind: PropKindX;
  x: number;
  z: number;
  ry: number;
  calm: boolean;
  len?: number; // 생울타리 길이
  dirs?: number[]; // 길 안내 기둥 화살표 방향
  why: string; // 놓은 규칙(시험·점검용)
};
export type PropsInput = {
  trees: TreeSpot[];
  ground: Pick<Ground, "foot" | "grid" | "campus">;
  calm: CalmZone[];
  legs: number[][];
  sites: XZ[];
  // 거점 표석이 실제로 서는 자리(거점 자리에서 비켜 선다, field-stop markerAt)
  markers?: XZ[];
};
export type Props = {
  group: THREE.Group;
  placed: Placed[];
  // 캐릭터 자리(x, z)와 카메라에 맞춰 가까운 구역의 소품만 보이게 한다
  update(x: number, z: number, camera?: THREE.Camera): void;
};

// 구역 한 변이 2 × (near + hyst)라서 캐릭터 둘레 원은 언제나 구역 2 × 2개 안에 든다
// (소품 그리기 4번 + 블롭 그늘 1번 이하).
export const PROPS_STYLE = {
  tile: 176, // 구역 한 변(m)
  near: 80, // 캐릭터와 구역 사이가 이보다 가까우면 켠다
  hyst: 8, // 켜진 구역은 near + hyst 넘어서야 끈다
  prefetch: 120, // 이 안의 구역은 미리 만들어 둔다
  grow: 0.3, // 나타나는 시간(초)
  routeClear: 2.5, // 시연 경로 중심선에서 비우는 거리
  siteClear: 6, // 거점 자리·표석 둘레 비우는 거리
  // 키 큰 소품(관목·생울타리·가로등·벤치)은 거점 둘레를 더 넓게 비운다: 도착해 둘러볼 때
  // 표석과 기록 액자를 가리지 않게
  siteClearWide: 14,
};
const WIDE_CLEAR = new Set<PropKindX>(["bush", "hedge", "lamp", "bench", "benchStone"]);
// 게시판을 두는 건물(스타일 시트 7장 13번)
const BOARD_AT = new Set(["제1학생마루", "제2학생마루", "중앙도서관"]);
// 종류별 개수 상한(스타일 시트 9장: 가로등 60, 벤치 40, 꽃점 800)
const CAP: Partial<Record<PropKindX, number>> = {
  lamp: 60,
  bench: 40,
  benchStone: 40,
  bush: 120,
  hedge: 80,
  signpost: 6,
};
const FLOWER_CAP = 800;

// 5·18 조용한 구역 목록은 field-calm.ts 하나에 둔다(땅·건물·소품·거점 표석이 함께 읽는다)
export { calmZones, inCalm };

// 꺾은선 둘레 사각 칸 색인(건물·면 다각형)
class PolyIndex {
  private cells = new Map<number, number[]>();
  private boxes: [number, number, number, number][] = [];
  constructor(
    public polys: number[][],
    private size = 64,
  ) {
    polys.forEach((p, i) => {
      let x0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k]);
        x1 = Math.max(x1, p[k]);
        z0 = Math.min(z0, p[k + 1]);
        z1 = Math.max(z1, p[k + 1]);
      }
      this.boxes.push([x0, z0, x1, z1]);
      for (let a = Math.floor(x0 / size); a <= Math.floor(x1 / size); a++)
        for (let b = Math.floor(z0 / size); b <= Math.floor(z1 / size); b++) {
          const key = (a + 512) * 1024 + (b + 512);
          let c = this.cells.get(key);
          if (!c) this.cells.set(key, (c = []));
          c.push(i);
        }
    });
  }
  // (x, z)가 pad 안으로 들어오는 다각형 번호
  hit(x: number, z: number, pad = 0): number {
    const key =
      (Math.floor(x / this.size) + 512) * 1024 + (Math.floor(z / this.size) + 512);
    for (const i of this.cells.get(key) ?? []) {
      const b = this.boxes[i];
      if (x < b[0] - pad || x > b[2] + pad || z < b[1] - pad || z > b[3] + pad)
        continue;
      const p = this.polys[i];
      if (insidePoly(p, x, z)) return i;
      if (pad > 0 && edgeDist(p, x, z) < pad) return i;
    }
    return -1;
  }
}
export function edgeDist(p: number[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j],
      az = p[j + 1],
      dx = p[i] - ax,
      dz = p[i + 1] - az,
      L2 = dx * dx + dz * dz,
      t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return d;
}
const polyArea = (p: number[]) => {
  let s = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    s += p[j] * p[i + 1] - p[i] * p[j + 1];
  return Math.abs(s) / 2;
};
const centroid = (p: number[]) => {
  let x = 0,
    z = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    z += p[i + 1];
  }
  return { x: (x * 2) / p.length, z: (z * 2) / p.length };
};
// 길 종류별 테(차도 노란 테 0.75, 서비스 길 0.55, 보행로 0.35)
const RIM = [0.75, 0.55, 0.35];

type FreeOpts = {
  foot?: boolean; // false면 보행로 위도 된다(횡단보도 말뚝)
  route?: boolean; // false면 시연 경로 중심선 둘레도 된다
  points?: boolean;
  trees?: boolean;
  rr?: number; // 길·물길에서 떨어질 반폭(기본 r)
  wall?: number; // 건물 벽에서 떨어질 반폭(기본 r)
  soft?: boolean; // 광장 포장 위는 안 된다(생울타리)
  siteR?: number; // 거점 자리·표석에서 떨어질 거리(기본 siteClear)
};
// 소품을 놓을 수 있는 곳을 판정한다
class Space {
  private taken = new Map<number, { x: number; z: number; r: number }[]>();
  private trees = new Map<number, TreeSpot[]>();
  buildings: PolyIndex;
  blockers: PolyIndex;
  lawns: PolyIndex;
  plazas: PolyIndex;
  streams = new SegGrid(32);
  route = new SegGrid(32);
  private points: { x: number; z: number; r: number }[] = [];
  private sites: { x: number; z: number }[] = [];
  constructor(
    public data: MapData,
    public inp: PropsInput,
  ) {
    this.buildings = new PolyIndex(data.buildings.map((b) => b.p));
    this.blockers = new PolyIndex(
      data.areas
        .filter((a) => /^(parking|pitch|track|water|flower)$/.test(a.k))
        .map((a) => a.p),
    );
    this.lawns = new PolyIndex(
      data.areas.filter((a) => a.k === "grass").map((a) => a.p),
    );
    this.plazas = new PolyIndex(
      data.areas.filter((a) => a.k === "plaza").map((a) => a.p),
    );
    data.streams.forEach((s, i) => {
      for (let k = 2; k < s.p.length; k += 2)
        this.streams.add({
          ax: s.p[k - 2],
          az: s.p[k - 1],
          bx: s.p[k],
          bz: s.p[k + 1],
          w: s.w + 0.9,
          k: 9,
          i,
        });
    });
    inp.legs.forEach((l, i) => {
      for (let k = 2; k < l.length; k += 2)
        this.route.add({
          ax: l[k - 2],
          az: l[k - 1],
          bx: l[k],
          bz: l[k + 1],
          w: 0,
          k: 9,
          i,
        });
    });
    for (const t of inp.trees) {
      const key = this.key(t.x, t.z, 8);
      let c = this.trees.get(key);
      if (!c) this.trees.set(key, (c = []));
      c.push(t);
    }
    // 모형·거점·횡단보도 둘레
    const A = data.anchors;
    const pt = (p: [number, number] | undefined, r: number) => {
      if (p) this.points.push({ x: p[0], z: p[1], r });
    };
    pt(A.gate, 22);
    pt(A.tower, 10);
    pt(A.stone, 7);
    pt(A.bloom, 7);
    for (const s of [...inp.sites, ...(inp.markers ?? [])]) this.sites.push(s);
    for (const p of data.pois ?? [])
      if (p.k === "crossing") this.points.push({ x: p.x, z: p.z, r: 3 });
  }
  private key(x: number, z: number, s: number) {
    return (Math.floor(x / s) + 4096) * 8192 + (Math.floor(z / s) + 4096);
  }
  routeDist(x: number, z: number, max = 60) {
    let d = Infinity;
    this.route.near(x, z, max, (_s, e) => (d = Math.min(d, e)));
    return d;
  }
  // 가장 가까운 길(중심선 거리 d, 중심선 위 가장 가까운 점 x, z)
  nearestRoad(x: number, z: number, max = 8, kind?: number) {
    type Near = { k: number; w: number; d: number; i: number; x: number; z: number };
    let best: Near | null = null;
    this.inp.ground.grid.near(x, z, max, (s, d, t) => {
      if (kind !== undefined && s.k !== kind) return;
      if (!best || d < best.d)
        best = { k: s.k, w: s.w, d, i: s.i, x: s.ax + (s.bx - s.ax) * t, z: s.az + (s.bz - s.az) * t };
    });
    return best as Near | null;
  }
  lawn(x: number, z: number) {
    return this.lawns.hit(x, z) >= 0;
  }
  // 반지름 r의 소품을 (x, z)에 놓을 수 있나
  free(
    x: number,
    z: number,
    r: number,
    o: FreeOpts = {},
  ) {
    let hit = false;
    // 길·물길·벽과는 소품의 앞뒤 반폭(rr, wall)만큼만 떨어지면 된다(길을 따라 눕힌 소품)
    const rr = o.rr ?? r,
      wall = o.wall ?? r;
    this.inp.ground.grid.near(x, z, rr + 1, (s, d) => {
      if (hit || (s.k === 2 && o.foot === false)) return;
      if (d < s.w / 2 + RIM[s.k] + rr) hit = true;
    });
    if (hit) return false;
    this.streams.near(x, z, rr + 1, (s, d) => {
      if (d < s.w / 2 + rr) hit = true;
    });
    if (hit) return false;
    if (this.buildings.hit(x, z, wall + 0.6) >= 0) return false;
    if (this.blockers.hit(x, z, rr + 0.3) >= 0) return false;
    if (o.soft && this.plazas.hit(x, z, rr) >= 0) return false;
    if (o.route !== false && this.routeDist(x, z, PROPS_STYLE.routeClear + r) < PROPS_STYLE.routeClear + r)
      return false;
    if (o.points !== false) {
      for (const p of this.points)
        if (Math.hypot(x - p.x, z - p.z) < p.r + r) return false;
      const sr = o.siteR ?? PROPS_STYLE.siteClear;
      for (const p of this.sites) if (Math.hypot(x - p.x, z - p.z) < sr + r) return false;
    }
    if (o.trees !== false)
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const t of this.trees.get(this.key(x + a * 8, z + b * 8, 8)) ?? [])
            if (Math.hypot(x - t.x, z - t.z) < 1.1 + r) return false;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const q of this.taken.get(this.key(x + a * 8, z + b * 8, 8)) ?? [])
          if (Math.hypot(x - q.x, z - q.z) < q.r + r + 0.4) return false;
    return true;
  }
  // 비워 둘 원(현관 앞 등)
  keep(x: number, z: number, r: number) {
    this.points.push({ x, z, r });
  }
  take(x: number, z: number, r: number) {
    const key = this.key(x, z, 8);
    let c = this.taken.get(key);
    if (!c) this.taken.set(key, (c = []));
    c.push({ x, z, r });
  }
}

// 놓을 자리: 여러 규칙을 차례로 적용한다(먼저 놓은 것이 자리를 차지한다)
export function placeProps(data: MapData, inp: PropsInput): Placed[] {
  const space = new Space(data, inp),
    out: Placed[] = [],
    count = new Map<PropKindX, number>(),
    calm = (x: number, z: number) => inCalm(inp.calm, x, z);
  const radius = (k: PropKindX, len = 0) => {
    if (k === "hedge") return Math.max(0.6, len / 2);
    if (k === "signpost") return 0.6;
    const t = propTemplate(k);
    return Math.max(0.35, Math.max(t.foot[0], t.foot[1]));
  };
  // 조용한 구역에서는 변형으로 바꾸거나 뺀다
  const variant = (k: PropKindX, c: boolean): PropKindX | null => {
    if (!c) return k;
    if (k === "bench") return "benchStone";
    if (k === "planter") return "planterCalm";
    if (k === "flowerPink" || k === "flowerYellow") return "flowerWhite";
    return CALM_OK.has(k) ? k : null;
  };
  // 반지름을 넘지 않게 놓고 자리를 차지한다. back이면 앞 방향 반대로 조금씩 물러나 본다.
  const put = (
    kind: PropKindX,
    x: number,
    z: number,
    ry: number,
    why: string,
    o: FreeOpts & { back?: number; len?: number; dirs?: number[] } = {},
  ): boolean => {
    const cap = CAP[kind];
    if (cap !== undefined && (count.get(kind) ?? 0) >= cap) return false;
    const steps = o.back ? [0, 0.5, 1, 1.5, 2, 2.5, 3, 4].filter((s) => s <= o.back!) : [0];
    for (const s of steps) {
      const px = x - Math.sin(ry) * s,
        pz = z - Math.cos(ry) * s,
        c = calm(px, pz),
        k = variant(kind, c);
      if (!k) continue;
      const r = radius(k, o.len);
      const siteR = WIDE_CLEAR.has(k) ? PROPS_STYLE.siteClearWide : undefined;
      if (!space.free(px, pz, r, { siteR, ...o })) continue;
      space.take(px, pz, r);
      out.push({ kind: k, x: px, z: pz, ry, calm: c, len: o.len, dirs: o.dirs, why });
      count.set(kind, (count.get(kind) ?? 0) + 1);
      return true;
    }
    return false;
  };

  // 건물 현관: 현관 앞 4m는 비운다(현관 장식인 화분·표지석·게시판은 따로 놓는다)
  const entrances = (data.pois ?? []).filter((p) => p.k === "entrance");
  const fronts: { b: MapBuilding; f: Front }[] = [];
  for (const b of data.buildings) {
    if (b.t && /^(greenhouse|roof|house|apartments|commercial|retail|church)$/.test(b.t)) continue;
    const area = polyArea(b.p);
    if (area < 300) continue;
    const c = centroid(b.p);
    if (!inp.ground.campus(c.x, c.z) && b.t !== "school") continue;
    if (space.routeDist(c.x, c.z, 300) > 300 && !(b.name && BOARD_AT.has(b.name))) continue;
    const f = doorOf(b, entrances, data);
    fronts.push({ b, f });
    space.keep(f.x + Math.sin(f.ry) * 2, f.z + Math.cos(f.ry) * 2, 3);
  }

  // ⓪ 랜드마크 둘레 손질(field-dressing.ts): 용봉관 앞 잔디 원뿔꼴 나무(막히면 건물 쪽으로
  // 물러난다), 민주마루 계단 앞 디딤돌과 다듬은 소나무(막히면 바깥으로 비켜 선다), 계승비.
  for (const t of hallTopiaries(data))
    put("coneTopiary", t.x, t.z, t.ry, "hall:topiary", { back: 4, route: false });
  {
    const d = minjumaruDressing(data);
    for (const t of d.slabs) {
      out.push({ kind: "stepSlab", x: t.x, z: t.z, ry: t.ry, calm: calm(t.x, t.z), why: "minju:slab" });
      space.take(t.x, t.z, 1.3);
    }
    for (const t of d.pines)
      for (const o of [0, 1, 2, 3, 4, 5]) {
        const [ox, oz] = t.out ?? [0, 0];
        if (put("clippedPine", t.x + ox * o, t.z + oz * o, t.ry, "minju:pine", { route: false }))
          break;
      }
    const rs = relicStone(data);
    out.push({ kind: "relicStone", x: rs.x, z: rs.z, ry: rs.ry, calm: calm(rs.x, rs.z), why: "memorial:relic" });
    space.take(rs.x, rs.z, 1.5);
  }

  // ① 오픈스트리트맵 지물: 실제 자리. 길 띠에 걸리면 길 반대쪽으로 조금 물러난다.
  const POI: Partial<Record<string, PropKind>> = {
    bench: "bench",
    bicycle_parking: "bikeRack",
    shelter: "pergola",
    bus_stop: "busStop",
    waste_basket: "bin",
  };
  for (const p of data.pois ?? []) {
    const k = POI[p.k];
    if (k) put(k, p.x, p.z, p.a, `osm:${p.k}`, { back: 4, route: false });
  }

  // ② 시연 경로: 길 테 바깥 1.2m에 가로등 24m마다(양쪽 번갈아, 막히면 반대쪽),
  // 벤치 40m마다 길을 보게, 벤치 둘째마다 옆에 휴지통.
  let benchN = 0;
  const lamps: { x: number; z: number }[] = [];
  inp.legs.forEach((leg, li) => {
    const L = legLength(leg);
    let side = li % 2 ? 1 : -1;
    const lampR = radius("lamp"),
      benchR = radius("bench");
    // 길 중심선에서 off만큼 sd 쪽(시연 경로는 길 가장자리를 지나기도 한다). 메타세쿼이아에
    // 걸리면 길을 따라 4m 밀어 본다. 구간이 이어지는 곳에서 몰리지 않게 14m 안에는 하나만.
    const lampAt = (q: ReturnType<typeof along>, road: { x: number; z: number }, off: number, sd: number) => {
      for (const shift of [0, 4, -4]) {
        const x = road.x + q.nx * off * sd + q.nz * shift,
          z = road.z + q.nz * off * sd - q.nx * shift;
        if (lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 14)) continue;
        if (put("lamp", x, z, 0, "route:lamp", { route: false })) {
          lamps.push({ x, z });
          return true;
        }
      }
      return false;
    };
    for (let s = 10; s < L - 6; s += 24) {
      const q = along(leg, s),
        road = space.nearestRoad(q.x, q.z, 8, 2) ?? space.nearestRoad(q.x, q.z, 8, 1);
      if (!road) continue;
      const off = road.w / 2 + RIM[road.k] + 1.2 + lampR;
      for (const sd of [side, -side]) if (lampAt(q, road, off, sd)) break;
      side = -side;
    }
    // 보행로 없이 k=0 차도를 따라가는 구간은 30m마다 양쪽, 노란 테 바깥 1.0m
    for (let s = 10; s < L - 6; s += 30) {
      const q = along(leg, s),
        road = space.nearestRoad(q.x, q.z);
      if (!road || road.k !== 0 || space.nearestRoad(q.x, q.z, 8, 2)) continue;
      const off = road.w / 2 + RIM[0] + 1.0 + lampR;
      for (const sd of [1, -1]) lampAt(q, road, off, sd);
    }
    side = li % 2 ? -1 : 1;
    for (let s = 30; s < L - 10; s += 40) {
      const q = along(leg, s),
        road = space.nearestRoad(q.x, q.z);
      if (!road || road.k === 0) continue;
      // 벤치 앞뒤 반폭 1.0 + 여유 0.6만큼 길 테 밖(앉는 자리 앞에 발 디딜 틈)
      const off = road.w / 2 + RIM[road.k] + 1.6;
      for (const sd of [side, -side]) {
        const x = road.x + q.nx * off * sd,
          z = road.z + q.nz * off * sd,
          ry = Math.atan2(-q.nx * sd, -q.nz * sd); // 길 쪽을 본다
        if (!put("bench", x, z, ry, "route:bench", { route: false, rr: 1.1 })) continue;
        benchN++;
        if (benchN % 2 === 0) {
          // 벤치 오른쪽 옆 1.2m
          const tx = Math.cos(ry),
            tz = -Math.sin(ry),
            o = benchR + 1.2;
          put("bin", x + tx * o, z + tz * o, ry, "route:bin", { route: false, rr: 0.7 }) ||
            put("bin", x - tx * o, z - tz * o, ry, "route:bin", { route: false, rr: 0.7 });
        }
        break;
      }
      side = -side;
    }
  });

  // 길 안내 기둥: 시연 경로가 35° 넘게 꺾이는 곳(조용한 구역 밖, 6개까지)과 용봉탑 로터리 북쪽.
  // 화살표는 다음 거점 쪽과 지나온 쪽을 가리킨다(글자는 넣지 않는다).
  for (const leg of inp.legs)
    for (let i = 2; i < leg.length - 2; i += 2) {
      const ux = leg[i] - leg[i - 2],
        uz = leg[i + 1] - leg[i - 1],
        vx = leg[i + 2] - leg[i],
        vz = leg[i + 3] - leg[i + 1],
        lu = Math.hypot(ux, uz),
        lv = Math.hypot(vx, vz);
      if (lu < 6 || lv < 6) continue;
      const turn = Math.acos(
        Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))),
      );
      if (turn < (35 * Math.PI) / 180) continue;
      // 꺾인 바깥쪽으로 물러난 자리
      let bx = ux / lu - vx / lv,
        bz = uz / lu - vz / lv;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl;
      bz /= bl;
      const road = space.nearestRoad(leg[i], leg[i + 1]),
        off = (road ? road.w / 2 + RIM[road.k] : 2) + 1.6;
      const dirs = [Math.atan2(vx, vz), Math.atan2(-ux, -uz)];
      for (const o of [off, off + 1.5, off + 3])
        if (
          put("signpost", leg[i] + bx * o, leg[i + 1] + bz * o, 0, "route:signpost", {
            route: false,
            dirs,
          })
        )
          break;
    }
  const tower = data.anchors.tower;
  if (tower) {
    const next = inp.sites[inp.sites.length - 1],
      prev = inp.sites[0];
    const dirs = [
      Math.atan2(next.x - tower[0], next.z - tower[1]),
      Math.atan2(prev.x - tower[0], prev.z - tower[1]),
    ];
    for (const o of [14, 16, 18, 20])
      if (put("signpost", tower[0], tower[1] - o, 0, "route:signpost", { dirs })) break;
  }

  // ③ 건물 정면: 캠퍼스 건물(300m² 이상, 시연 경로 300m 안)의 현관 양옆에 화분,
  // 경로 150m 안 이름 있는 건물의 현관 옆에 빈 크림 표지석(글자 없음, 용봉관은 모형이 있어 뺀다),
  // 1,500m² 넘는 대학 건물에는 자전거 거치대, 학생마루·중앙도서관 현관 옆에는 게시판.
  for (const { b, f } of fronts) {
    const nx = Math.sin(f.ry),
      nz = Math.cos(f.ry),
      tx = Math.cos(f.ry),
      tz = -Math.sin(f.ry),
      area = polyArea(b.p);
    // 화분·안내판·거치대는 벽과 나란히 눕히므로 벽·길과는 앞뒤 반폭만 떨어지면 된다
    for (const sd of [-1, 1])
      put("planter", f.x + tx * 4.6 * sd + nx * 2.0, f.z + tz * 4.6 * sd + nz * 2.0, f.ry, "front:planter", {
        route: false,
        points: false,
        rr: 1.0,
        wall: 1.0,
      });
    const near = space.routeDist(f.x, f.z, 150) <= 150;
    if (b.name && b.name !== "용봉관" && near)
      for (const sd of [-1, 1])
        if (
          put("sign", f.x + tx * 10 * sd + nx * 3.0, f.z + tz * 10 * sd + nz * 3.0, f.ry, "front:sign", {
            rr: 0.6,
            wall: 0.8,
          })
        )
          break;
    if (b.name && BOARD_AT.has(b.name))
      board: for (const a of [10, 13, 16])
        for (const sd of [1, -1])
          for (const o of [2.2, 3.4])
            if (
              put("board", f.x + tx * a * sd + nx * o, f.z + tz * a * sd + nz * o, f.ry, "front:board", {
                rr: 0.5,
                wall: 0.6,
                points: false,
              })
            )
              break board;
    if (area > 1500 && (b.t === "university" || b.t === "school"))
      for (const sd of [1, -1])
        if (
          put("bikeRack", f.x + tx * 11 * sd + nx * 2.2, f.z + tz * 11 * sd + nz * 2.2, f.ry, "front:bikeRack", {
            rr: 0.8,
            wall: 0.8,
          })
        )
          break;
  }

  // 메타세쿼이아 가로수 보호판, 전남대 홍매 둘레 돌 테
  for (const t of inp.trees)
    if (t.meta) out.push({ kind: "treeGuard", x: t.x, z: t.z, ry: 0, calm: calm(t.x, t.z), why: "tree:guard" });
  for (const t of inp.trees)
    if (Math.hypot(t.x - 163.9, t.z + 327) < 3) {
      out.push({ kind: "stoneRing", x: t.x, z: t.z, ry: 0, calm: calm(t.x, t.z), why: "tree:hongmae" });
      break;
    }

  // 오월 물길 테돌: 물길 양쪽 가장자리를 따라 2.4m 마디(틈 0.08m)
  for (const st of data.streams) {
    const L = legLength(st.p);
    for (let s = 1.2; s < L - 1.2; s += 2.48) {
      const q = along(st.p, s);
      for (const sd of [-1, 1]) {
        const o = st.w / 2 + 0.22,
          x = q.x + q.nx * o * sd,
          z = q.z + q.nz * o * sd;
        out.push({
          kind: "edgeStone",
          x,
          z,
          ry: Math.atan2(q.nx, q.nz), // 돌의 +x가 물길 방향(nz, -nx)을 따른다
          calm: calm(x, z),
          why: "stream:stone",
        });
      }
    }
  }

  // 횡단보도 양 끝 돌 말뚝(시연 경로 150m 안)
  for (const c of crosswalkBars(data.pois, inp.ground.grid)) {
    if (space.routeDist(c.x, c.z, 150) > 150) continue;
    const road = space.nearestRoad(c.x, c.z, 6);
    if (!road) continue;
    const vx = -c.uz,
      vz = c.ux,
      e = road.w / 2 + RIM[road.k] + 0.6;
    for (const sd of [-1, 1])
      for (const a of [-2.6, 2.6])
        put("bollard", c.x + vx * e * sd + c.ux * a, c.z + vz * e * sd + c.uz * a, 0, "xing:bollard", {
          foot: false,
          points: false,
          route: false,
        });
  }

  // 생울타리(폭 1.8, 키 1.7): 시연 경로 보행로 테 밖 1.4m(광장 포장·물길·횡단보도·현관 앞은 뺀다),
  // 마디 사이 3m 틈. 1m마다 자리를 보고 이어진 곧은 마디 가운데 8m 넘고 경로와 나란한(15° 안)
  // 것만 심는다(가로등·벤치 자리에서는 끊긴다). 마디는 14m 넘으면 끊는다.
  const HEDGE_MIN = 8,
    HEDGE_MAX = 14,
    HEDGE_OFF = 1.4,
    HEDGE_HALF = 0.9;
  for (const leg of inp.legs) {
    const L = legLength(leg);
    for (const sd of [-1, 1]) {
      let run: { x: number; z: number; s: number }[] = [];
      const flush = () => {
        const a = run[0],
          b = run[run.length - 1],
          len = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
        // 같은 구간의 경로 방향(시작·끝 지점을 잇는 현)과 나란한가
        let parallel = false;
        if (len >= HEDGE_MIN) {
          const p0 = along(leg, a.s),
            p1 = along(leg, b.s),
            lx = p1.x - p0.x,
            lz = p1.z - p0.z,
            ll = Math.hypot(lx, lz) || 1;
          parallel = Math.abs(((b.x - a.x) * lx + (b.z - a.z) * lz) / (len * ll)) > Math.cos(Math.PI / 12);
        }
        if (parallel && (count.get("hedge") ?? 0) < CAP.hedge!) {
          const mx = (a.x + b.x) / 2,
            mz = (a.z + b.z) / 2;
          for (const q of run) space.take(q.x, q.z, HEDGE_HALF);
          out.push({
            kind: "hedge",
            x: mx,
            z: mz,
            ry: Math.atan2(a.z - b.z, b.x - a.x),
            calm: calm(mx, mz),
            len,
            why: "route:hedge",
          });
          count.set("hedge", (count.get("hedge") ?? 0) + 1);
        }
        run = [];
      };
      let gap = 0;
      for (let s = 4; s < L - 4; s += 1) {
        if (gap > 0) {
          gap--;
          continue;
        }
        const q = along(leg, s),
          road = space.nearestRoad(q.x, q.z);
        if (!road || road.k === 0) {
          flush();
          continue;
        }
        const off = road.w / 2 + RIM[road.k] + HEDGE_OFF;
        const x = road.x + q.nx * off * sd,
          z = road.z + q.nz * off * sd;
        const hedgeAt = { route: false, soft: true, rr: HEDGE_HALF, siteR: PROPS_STYLE.siteClearWide };
        let ok = space.free(x, z, HEDGE_HALF, hedgeAt);
        // 곧게: 마디 가운데 점이 처음~이번 점 직선에서 0.4m 넘게 벗어나면 끊는다
        if (ok && run.length >= 2) {
          const a = run[0],
            m = run[run.length >> 1],
            ux = x - a.x,
            uz = z - a.z,
            ul = Math.hypot(ux, uz) || 1;
          if (Math.abs(((m.x - a.x) * uz - (m.z - a.z) * ux) / ul) > 0.4) {
            flush();
            ok = space.free(x, z, HEDGE_HALF, hedgeAt);
          }
        }
        if (ok) run.push({ x, z, s });
        if (!ok || run.length > HEDGE_MAX) {
          const was = run.length > HEDGE_MAX;
          flush();
          if (was) gap = 3;
        }
      }
      flush();
    }
  }

  // 관목: 보행로를 보는 건물 벽을 따라 6m마다, 벽 가까이(현관 6m 안·모서리 3m 안은 뺀다)
  for (const b of data.buildings) {
    const c = centroid(b.p);
    if (space.routeDist(c.x, c.z, 140) > 140) continue;
    if (b.t && /^(greenhouse|roof)$/.test(b.t)) continue;
    const doors = fronts.filter((f) => f.b === b).map((f) => f.f);
    const n = b.p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        ax = b.p[i * 2],
        az = b.p[i * 2 + 1],
        bx = b.p[j * 2],
        bz = b.p[j * 2 + 1],
        L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      const ux = (bx - ax) / L,
        uz = (bz - az) / L;
      let nx = uz,
        nz = -ux;
      if (insidePoly(b.p, (ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) {
        nx = -nx;
        nz = -nz;
      }
      // 벽 앞 12m 안에 보행로가 있어야 한다
      let foot = false;
      inp.ground.grid.near((ax + bx) / 2 + nx * 7, (az + bz) / 2 + nz * 7, 6, (s) => {
        if (s.k === 2) foot = true;
      });
      if (!foot) continue;
      for (let s = 3; s <= L - 3; s += 6) {
        // 벽에서 잎 가장자리까지 약 0.5m(가운데는 벽에서 2.4m)
        const x = ax + ux * s + nx * 2.4,
          z = az + uz * s + nz * 2.4;
        if (doors.some((d) => Math.hypot(d.x - (ax + ux * s), d.z - (az + uz * s)) < 6)) continue;
        put("bush", x, z, (hash(`${b.id}:${i}:${s}`) % 628) / 100, "wall:bush", { wall: 1.2 });
      }
    }
  }

  // 잔디밭 꽃: 시연 경로 30m 안 잔디밭에 20m²마다 한 포기(경로·나무 밑동 1.5m 안은 뺀다)
  let flowers = 0;
  const seen = new Set<number>();
  for (const leg of inp.legs) {
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (let i = 0; i < leg.length; i += 2) {
      x0 = Math.min(x0, leg[i]);
      x1 = Math.max(x1, leg[i]);
      z0 = Math.min(z0, leg[i + 1]);
      z1 = Math.max(z1, leg[i + 1]);
    }
    const S = 4.5;
    for (let gx = Math.floor((x0 - 30) / S); gx <= Math.ceil((x1 + 30) / S); gx++)
      for (let gz = Math.floor((z0 - 30) / S); gz <= Math.ceil((z1 + 30) / S); gz++) {
        const key = (gx + 4096) * 8192 + gz + 4096;
        if (seen.has(key) || flowers >= FLOWER_CAP) continue;
        seen.add(key);
        const h = hash(`f${gx},${gz}`),
          x = (gx + (h % 1000) / 1000) * S,
          z = (gz + ((h >>> 10) % 1000) / 1000) * S,
          d = space.routeDist(x, z, 30);
        if (d > 30 || !space.lawn(x, z)) continue;
        const pick = (h >>> 20) % 10,
          kind: PropKind = pick < 4 ? "flowerPink" : pick < 7 ? "flowerYellow" : "flowerWhite";
        if (!space.free(x, z, 0.45, { route: true })) continue;
        const c = calm(x, z),
          k = variant(kind, c) as PropKind;
        out.push({ kind: k, x, z, ry: ((h >>> 4) % 628) / 100, calm: c, why: "lawn:flower" });
        flowers++;
      }
  }
  return out;
}

// 건물 현관: 지도의 출입구 점(벽에서 2.5m 안) 중 frontOf에 가장 가까운 것, 없으면 frontOf
function doorOf(b: MapBuilding, entrances: { x: number; z: number; a: number }[], data: MapData): Front {
  const f = frontOf(b, data.roads);
  let best: Front | null = null,
    bd = Infinity;
  for (const e of entrances) {
    if (edgeDist(b.p, e.x, e.z) > 2.5) continue;
    const d = Math.hypot(e.x - f.x, e.z - f.z);
    if (d < bd) {
      bd = d;
      best = { x: e.x, z: e.z, ry: e.a };
    }
  }
  return best ?? f;
}

// 꺾은선 길이와 s m 지점(왼쪽 법선 포함)
export function legLength(p: number[]) {
  let L = 0;
  for (let i = 2; i < p.length; i += 2)
    L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return L;
}
export function along(p: number[], s: number) {
  for (let i = 2; i < p.length; i += 2) {
    const dx = p[i] - p[i - 2],
      dz = p[i + 1] - p[i - 1],
      L = Math.hypot(dx, dz);
    if (s <= L || i === p.length - 2) {
      const t = L > 0 ? Math.min(1, s / L) : 0;
      return {
        x: p[i - 2] + dx * t,
        z: p[i - 1] + dz * t,
        nx: L > 0 ? -dz / L : 0,
        nz: L > 0 ? dx / L : 1,
      };
    }
    s -= L;
  }
  return { x: p[0] ?? 0, z: p[1] ?? 0, nx: 0, nz: 1 };
}

// ── 그리기 ────────────────────────────────────────────────────
// 바닥 높이: 대부분 땅(0.06)에 앉히고, 보호판은 보도 위, 테돌은 물길 돌 테 위
const BASE_Y: Partial<Record<PropKindX, number>> = {
  treeGuard: LAYER.foot + 0.02,
  edgeStone: LAYER.streamStone - 0.03,
};
const templateOf = (p: Placed): Template =>
  p.kind === "hedge"
    ? hedgeTemplate(p.len ?? 4)
    : p.kind === "signpost"
      ? signpost(p.dirs ?? [0])
      : propTemplate(p.kind);
// 블롭 그늘(진하기): 소품 0.25, 나무 0.2. 보호판·테돌·꽃·홍매 테는 그늘이 없다.
const NO_BLOB = new Set<PropKindX>([
  "treeGuard",
  "stepSlab",
  "edgeStone",
  "stoneRing",
  "flowerPink",
  "flowerYellow",
  "flowerWhite",
]);

// 한 구역의 소품을 한 형상으로 합친다(위치는 세계 좌표, pOrg = 소품 바닥 가운데 + 조용한 구역 표시)
export function mergeTile(items: Placed[]) {
  const tpl = items.map(templateOf);
  let nv = 0,
    ni = 0;
  for (const t of tpl) {
    nv += t.pos.length / 3;
    ni += t.idx.length;
  }
  const pos = new Float32Array(nv * 3),
    nor = new Float32Array(nv * 3),
    col = new Float32Array(nv * 3),
    org = new Float32Array(nv * 4),
    idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0,
    k = 0;
  items.forEach((p, n) => {
    const t = tpl[n],
      c = Math.cos(p.ry),
      s = Math.sin(p.ry),
      y0 = BASE_Y[p.kind] ?? 0.06,
      cnt = t.pos.length / 3;
    for (let i = 0; i < cnt; i++) {
      const x = t.pos[i * 3],
        y = t.pos[i * 3 + 1],
        z = t.pos[i * 3 + 2],
        a = t.nor[i * 3],
        b = t.nor[i * 3 + 1],
        d = t.nor[i * 3 + 2];
      pos[(v + i) * 3] = p.x + x * c + z * s;
      pos[(v + i) * 3 + 1] = y0 + y;
      pos[(v + i) * 3 + 2] = p.z - x * s + z * c;
      nor[(v + i) * 3] = a * c + d * s;
      nor[(v + i) * 3 + 1] = b;
      nor[(v + i) * 3 + 2] = -a * s + d * c;
      col[(v + i) * 3] = t.col[i * 3];
      col[(v + i) * 3 + 1] = t.col[i * 3 + 1];
      col[(v + i) * 3 + 2] = t.col[i * 3 + 2];
      org[(v + i) * 4] = p.x;
      org[(v + i) * 4 + 1] = y0;
      org[(v + i) * 4 + 2] = p.z;
      org[(v + i) * 4 + 3] = p.calm ? 1 : 0;
    }
    for (let i = 0; i < t.idx.length; i++) idx[k + i] = t.idx[i] + v;
    v += cnt;
    k += t.idx.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("pOrg", new THREE.BufferAttribute(org, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// 소품 재질: 무광 점토. 구역이 켜질 때 0.3초 동안 0.85→1배로 자라며 디더로 나타난다
// (조용한 구역 소품은 바로 나타난다). 구역마다 재질 하나(셰이더 프로그램은 함께 쓴다).
function propMaterial(phone: boolean) {
  const grow = { value: 1 };
  // 소품은 부드러운 시야 구멍(field-occlusion "soft")을 쓴다: 캐릭터 둘레 3m부터 비워 두고
  // 남기는 테 없이 걷어 낸다
  const m = seeThrough(worldMaterial(phone, 0.88), "soft");
  m.userData.grow = grow;
  chainOnBeforeCompile(m, "prop-grow", (shader) => {
    shader.uniforms.uGrow = grow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 pOrg;
uniform float uGrow;
varying float vPropCalm;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vPropCalm = pOrg.w;
transformed = pOrg.xyz + (transformed - pOrg.xyz) * (pOrg.w > 0.5 ? 1.0 : 0.85 + 0.15 * uGrow);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uGrow;
varying float vPropCalm;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (vPropCalm < 0.5 && uGrow < 1.0) {
  vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
  float b = mod(q.x * 8.0 + q.y * 4.0 + mod(q.x + q.y, 2.0) * 2.0 + mod(q.y, 2.0), 16.0) / 16.0;
  if (b >= uGrow) discard;
}`,
      );
  });
  return m;
}

type Tile = {
  i: number;
  j: number;
  items: Placed[];
  blobs: number[]; // x, z, rx, rz, ry, a …
  mesh: THREE.Mesh | null;
  on: boolean;
  born: number;
};

export function buildProps(map: MapData, ctx: FieldCtx, inp?: PropsInput): Props {
  const phone = ctx.phone ?? isPhoneView();
  const group = new THREE.Group();
  group.name = "props";
  if (!inp) return { group, placed: [], update() {} };
  const placed = placeProps(map, inp),
    S = PROPS_STYLE.tile,
    tiles = new Map<number, Tile>();
  const tileOf = (x: number, z: number) => {
    const i = Math.floor(x / S),
      j = Math.floor(z / S),
      key = (i + 512) * 1024 + (j + 512);
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { i, j, items: [], blobs: [], mesh: null, on: false, born: 0 }));
    return t;
  };
  for (const p of placed) {
    const t = tileOf(p.x, p.z);
    t.items.push(p);
    if (NO_BLOB.has(p.kind)) continue;
    const f =
      p.kind === "hedge"
        ? [(p.len ?? 4) / 2 + 0.5, 0.9]
        : p.kind === "signpost"
          ? [0.6, 0.6]
          : propTemplate(p.kind).foot;
    t.blobs.push(p.x, p.z, f[0] * 1.15 + 0.3, f[1] * 1.15 + 0.3, p.ry, 0.25);
  }
  // 나무 밑 블롭(반지름 0.45 × 수관 지름, 진하기 0.2)
  for (const tr of inp.trees)
    tileOf(tr.x, tr.z).blobs.push(tr.x, tr.z, tr.r * 0.9, tr.r * 0.9, 0, 0.2);
  let maxBlobs = 0;
  {
    // 한꺼번에 켜지는 구역은 2×2까지
    const counts = [...tiles.values()].map((t) => t.blobs.length / 6).sort((a, b) => b - a);
    maxBlobs = counts.slice(0, 4).reduce((a, b) => a + b, 0);
  }
  const blobs = new BlobShadows(maxBlobs, LAYER.blob);
  group.add(blobs.mesh);
  if (process.env.NODE_ENV !== "production") {
    const byKind = new Map<string, number>();
    for (const p of placed) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    console.info("field props", placed.length, Object.fromEntries(byKind), "tiles", tiles.size);
  }

  const make = (t: Tile) => {
    if (t.mesh || !t.items.length) return;
    const mesh = new THREE.Mesh(mergeTile(t.items), propMaterial(phone));
    mesh.name = `props:${t.i},${t.j}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = false;
    t.mesh = mesh;
    group.add(mesh);
  };
  const list = [...tiles.values()];
  let first = true;
  return {
    group,
    placed,
    update(x, z) {
      const now = performance.now();
      let changed = false,
        built = 0;
      for (const t of list) {
        const dx = Math.max(t.i * S - x, 0, x - (t.i + 1) * S),
          dz = Math.max(t.j * S - z, 0, z - (t.j + 1) * S),
          d = Math.hypot(dx, dz),
          on = d < PROPS_STYLE.near + (t.on ? PROPS_STYLE.hyst : 0);
        // 미리 만들기: 한 프레임에 하나까지(켜야 하는 구역은 바로)
        if (!t.mesh && t.items.length && (on || (d < PROPS_STYLE.prefetch && built < 1))) {
          make(t);
          built++;
        }
        if (on !== t.on) {
          t.on = on;
          changed = true;
          t.born = first ? now - 1e4 : now;
        }
        if (t.mesh) {
          t.mesh.visible = on;
          const g = Math.min(1, (now - t.born) / 1000 / PROPS_STYLE.grow),
            u = (t.mesh.material as THREE.Material).userData.grow as { value: number };
          u.value = on ? g * g * (3 - 2 * g) : 1;
        }
      }
      first = false;
      if (changed) {
        blobs.begin();
        for (const t of list)
          if (t.on)
            for (let k = 0; k < t.blobs.length; k += 6)
              blobs.push(t.blobs[k], t.blobs[k + 1], t.blobs[k + 2], t.blobs[k + 3], t.blobs[k + 4], t.blobs[k + 5]);
        blobs.end();
      }
    },
  };
}
