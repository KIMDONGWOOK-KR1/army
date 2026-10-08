import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { insidePoly, type MapData } from "../components/field-geom";
import {
  campusTest,
  footMaterials,
  GroundBuilder,
  isPromenade,
  reverseTriangles,
  roadGrid,
} from "../components/field-ground";
import { MEMORIAL_AT } from "../components/field-calm";
import { MINJU } from "../components/field-dressing";
import { markerAt } from "../components/field-stop";
import { LodInstancer } from "../components/field-instances";
import {
  calmZones,
  inCalm,
  mergeTile,
  placeProps,
  PROPS_STYLE,
  type Placed,
  type PropsInput,
  type TreeSpot,
} from "../components/field-props";
import {
  CALM_OK,
  chamferBox,
  HEDGE,
  hedgeTemplate,
  PROP_KINDS,
  PROP_TRIANGLE_CAP,
  propTemplate,
  signpost,
  triangles,
} from "../components/field-props-kit";

// 거리 소품(스타일 시트 7·9장): 지도 자료에서 결정론적으로 놓고, 건물·차도를 피하고,
// 조용한 구역 규칙과 개수·삼각형 예산을 지키는지 본다.
const ROOT = join(__dirname, "..");
const map = JSON.parse(
  readFileSync(join(ROOT, "components", "maps", "jnu.json"), "utf8"),
) as MapData;

function input(): PropsInput {
  const campus = campusTest(map.roads),
    grid = roadGrid(map.roads),
    foot = footMaterials(map.roads, campus, grid);
  const trees: TreeSpot[] = [];
  for (let i = 0; i < map.rows.length; i += 2)
    trees.push({ x: map.rows[i], z: map.rows[i + 1], r: 3.6, meta: true });
  for (let i = 0; i < map.trees.length; i += 2)
    trees.push({ x: map.trees[i], z: map.trees[i + 1], r: 3.4, meta: false });
  const A = map.anchors,
    sites = [{ x: A.gate[0], z: A.gate[1] }];
  if (A.hall) sites.push({ x: A.hall[0], z: A.hall[1] });
  return {
    trees,
    ground: { foot, grid, campus },
    calm: calmZones(map),
    legs: map.legs,
    sites,
    markers: sites.map((p, i) => markerAt(i, p)),
  };
}
const placed = placeProps(map, input());
const count = (pred: (p: Placed) => boolean) => placed.filter(pred).length;
const FLOWERS = new Set(["flowerPink", "flowerYellow", "flowerWhite"]);
// 길·물길 위에 일부러 까는 것(보호판·테돌·홍매 테)
const ON_GROUND = new Set(["treeGuard", "edgeStone", "stoneRing"]);

describe("거리 소품 자리", () => {
  it("같은 지도면 언제나 같은 자리에 놓는다", () => {
    expect(placeProps(map, input())).toEqual(placed);
  });

  it("규칙마다 소품이 놓인다", () => {
    const why = (w: string) => count((p) => p.why.startsWith(w));
    expect(why("osm:")).toBeGreaterThan(5);
    expect(why("route:lamp")).toBeGreaterThan(15);
    // 정문 표석(21, 10) 둘레 14m는 벤치를 비운다(PROPS_STYLE.siteClearWide)
    expect(why("route:bench")).toBeGreaterThan(4);
    expect(why("front:planter")).toBeGreaterThan(10);
    expect(why("front:sign")).toBeGreaterThan(1);
    expect(why("front:board")).toBe(3);
    expect(why("front:bikeRack")).toBeGreaterThan(1);
    expect(why("wall:bush")).toBeGreaterThan(10);
    expect(why("xing:bollard")).toBeGreaterThan(4);
    expect(why("route:hedge")).toBeGreaterThan(2);
    expect(why("lawn:flower")).toBeGreaterThan(50);
    expect(why("stream:stone")).toBeGreaterThan(20);
  });

  it("생울타리는 8m 넘는 마디만 심는다", () => {
    const hedges = placed.filter((p) => p.kind === "hedge");
    expect(hedges.length).toBeGreaterThan(2);
    for (const h of hedges) expect(h.len!).toBeGreaterThanOrEqual(8);
  });

  it("키 큰 소품(관목·생울타리·가로등·벤치)은 거점·표석 14m 안에 두지 않는다", () => {
    const inp = input(),
      keep = [...inp.sites, ...(inp.markers ?? [])],
      wide = new Set(["bush", "hedge", "lamp", "bench", "benchStone"]);
    for (const p of placed) {
      if (!wide.has(p.kind)) continue;
      const half = p.kind === "hedge" ? (p.len ?? 0) / 2 : 0,
        ux = Math.cos(p.ry),
        uz = -Math.sin(p.ry);
      for (const k of keep) {
        // 생울타리는 길이 방향 선분까지의 거리
        const t = Math.max(-half, Math.min(half, (k.x - p.x) * ux + (k.z - p.z) * uz)),
          d = Math.hypot(k.x - p.x - ux * t, k.z - p.z - uz * t);
        expect(d, `${p.kind} ${p.why}`).toBeGreaterThan(PROPS_STYLE.siteClearWide);
      }
    }
  });

  it("랜드마크 둘레 손질: 용봉관 앞 원뿔 나무, 민주마루 디딤돌·소나무, 계승비", () => {
    const why = (w: string) => placed.filter((p) => p.why === w);
    expect(why("hall:topiary").length).toBeGreaterThanOrEqual(5);
    expect(why("hall:topiary").every((p) => p.kind === "coneTopiary" && p.calm)).toBe(true);
    expect(why("minju:slab").length).toBe(MINJU.slabs);
    expect(why("minju:pine").length).toBeGreaterThanOrEqual(6);
    const relic = why("memorial:relic");
    expect(relic.length).toBe(1);
    expect(relic[0].kind).toBe("relicStone");
    expect(relic[0].calm).toBe(true);
    expect(Math.hypot(relic[0].x - MEMORIAL_AT.x, relic[0].z - MEMORIAL_AT.z)).toBeLessThan(0.01);
  });

  // 꺾은선 p에서 (x, z)까지 가장 가까운 거리
  const lineDist = (p: number[], x: number, z: number) => {
    let best = Infinity;
    for (let k = 2; k < p.length; k += 2) {
      const ax = p[k - 2],
        az = p[k - 1],
        dx = p[k] - ax,
        dz = p[k + 1] - az,
        L2 = dx * dx + dz * dz,
        t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
    return best;
  };

  it("건물 안이나 차도·서비스 길·보행로 위에 놓지 않는다", () => {
    const bad: string[] = [];
    for (const p of placed) {
      if (ON_GROUND.has(p.kind)) continue;
      const at = `${p.kind} ${p.why} @${p.x.toFixed(1)},${p.z.toFixed(1)}`;
      for (const b of map.buildings) if (insidePoly(b.p, p.x, p.z)) bad.push(`건물 ${at}`);
      for (const r of map.roads) {
        // 횡단보도 말뚝은 보행로 끝에 선다
        if (r.k === 2 && p.kind === "bollard") continue;
        if (lineDist(r.p, p.x, p.z) < r.w / 2) bad.push(`길 ${at}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("시연 경로 중심선 둘레는 비워 둔다(가로등·벤치·화단은 길 밖)", () => {
    const bad = placed.filter(
      (p) => !ON_GROUND.has(p.kind) && map.legs.some((l) => lineDist(l, p.x, p.z) < 1.2),
    );
    expect(bad.map((p) => p.why)).toEqual([]);
  });

  it("조용한 구역에는 돌색·흰 꽃 변형만, 길 안내 기둥·색 꽃은 없다", () => {
    const calm = calmZones(map);
    let n = 0;
    for (const p of placed) {
      expect(p.calm).toBe(inCalm(calm, p.x, p.z));
      if (!p.calm) continue;
      n++;
      expect(CALM_OK.has(p.kind), `${p.kind} ${p.why}`).toBe(true);
    }
    expect(n).toBeGreaterThan(0);
    for (const p of placed)
      if (inCalm(calm, p.x, p.z))
        expect(["flowerPink", "flowerYellow", "signpost", "bench", "planter", "busStop", "pergola"]).not.toContain(
          p.kind,
        );
  });

  it("개수 예산: 가로등 60, 벤치 40, 꽃 800, 소품 600, 모두 3,000 아래", () => {
    expect(count((p) => p.kind === "lamp")).toBeLessThanOrEqual(60);
    expect(count((p) => p.kind === "bench" || p.kind === "benchStone")).toBeLessThanOrEqual(40);
    expect(count((p) => p.kind === "signpost")).toBeLessThanOrEqual(7);
    const flowers = count((p) => FLOWERS.has(p.kind));
    expect(flowers).toBeLessThanOrEqual(800);
    // 길·물길에 붙인 테돌·보호판은 따로 센다
    const props = count((p) => !FLOWERS.has(p.kind) && !ON_GROUND.has(p.kind));
    expect(props).toBeLessThanOrEqual(600);
    expect(placed.length).toBeLessThan(3000);
  });

  it("구역 한 변은 켜는 거리(여유 포함)의 두 배 이상이라 켜지는 구역은 2×2를 넘지 않는다", () => {
    expect(PROPS_STYLE.tile).toBeGreaterThanOrEqual(2 * (PROPS_STYLE.near + PROPS_STYLE.hyst));
  });

  it("구역별로 합친 소품 삼각형: 캐릭터 둘레 켜지는 구역 합이 25,000 아래", () => {
    const S = PROPS_STYLE.tile,
      tiles = new Map<string, Placed[]>();
    for (const p of placed) {
      const key = `${Math.floor(p.x / S)},${Math.floor(p.z / S)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key)!.push(p);
    }
    const tris = new Map<string, number>();
    for (const [key, items] of tiles) {
      const g = mergeTile(items);
      tris.set(key, g.index!.count / 3);
      g.dispose();
    }
    // 시연 장면 다섯 곳: 시작·정문 앞·민주대로 가운데·용봉탑·용봉관 앞
    const spots = [
      [167.9, 33.5],
      [5, 12],
      [40, -140],
      [97, -245],
      [110, -300],
    ];
    for (const [x, z] of spots) {
      let sum = 0,
        on = 0;
      for (const [key, n] of tris) {
        const [i, j] = key.split(",").map(Number),
          dx = Math.max(i * S - x, 0, x - (i + 1) * S),
          dz = Math.max(j * S - z, 0, z - (j + 1) * S);
        if (Math.hypot(dx, dz) < PROPS_STYLE.near + PROPS_STYLE.hyst) {
          sum += n;
          on++;
        }
      }
      expect(sum, `${x},${z}`).toBeLessThan(25000);
      expect(on, `${x},${z}`).toBeLessThanOrEqual(4);
    }
  });
});

describe("소품 키트 형상", () => {
  it("모서리 깎은 상자는 삼각형 44개", () => {
    const g = chamferBox(2, 1, 1, 0.1);
    expect(g.index!.count / 3).toBe(44);
  });

  it("종류마다 삼각형 상한을 지킨다", () => {
    for (const k of PROP_KINDS)
      expect(triangles(propTemplate(k)), k).toBeLessThanOrEqual(PROP_TRIANGLE_CAP[k]);
    expect(triangles(hedgeTemplate(12))).toBeLessThanOrEqual(PROP_TRIANGLE_CAP.hedge);
    expect(triangles(signpost([0, 1, 2]))).toBeLessThanOrEqual(PROP_TRIANGLE_CAP.signpost);
  });

  it("벤치는 앞(+z)을 보고, 돌린 각 ry의 앞은 (sin ry, cos ry)다", () => {
    const ry = Math.atan2(1, -1); // 앞 = (1, -1)/√2
    const g = mergeTile([{ kind: "bench", x: 0, z: 0, ry, calm: false, why: "t" }]);
    const p = g.attributes.position;
    let back = 0,
      n = 0;
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) > 1.6) {
        back += (p.getX(i) - p.getZ(i)) / Math.SQRT2;
        n++;
      }
    expect(n).toBeGreaterThan(0);
    expect(back / n).toBeLessThan(-0.3); // 등받이는 앞 반대쪽
  });

  it("땅 형상은 위층부터 그리게 삼각형 차례를 뒤집는다(삼각형 안 차례는 그대로)", () => {
    const a = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];
    expect([...reverseTriangles(a, 3)]).toEqual([3, 3, 3, 4, 4, 4, 5, 5, 5, 0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect([...reverseTriangles([7, 8, 9, 1, 2, 3], 1)]).toEqual([1, 2, 3, 7, 8, 9]);
  });

  it("생울타리는 길 방향(dx, dz)을 따라 눕는다(ry = atan2(-dz, dx))", () => {
    const dx = 3,
      dz = 4,
      ry = Math.atan2(-dz, dx);
    const g = mergeTile([{ kind: "hedge", x: 0, z: 0, ry, len: 10, calm: false, why: "t" }]);
    const p = g.attributes.position;
    let along = 0,
      across = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      along = Math.max(along, Math.abs((x * dx + z * dz) / 5));
      across = Math.max(across, Math.abs((-x * dz + z * dx) / 5));
    }
    expect(along).toBeGreaterThan(4.5);
    expect(across).toBeLessThan(HEDGE.d / 2 + 0.05); // 폭 1.8의 반(밑동 띠 포함)
  });

  it("조용한 구역 표시는 꼭짓점 pOrg.w에 담긴다", () => {
    const g = mergeTile([
      { kind: "bin", x: 1, z: 2, ry: 0, calm: true, why: "t" },
      { kind: "bin", x: 5, z: 2, ry: 0, calm: false, why: "t" },
    ]);
    const o = g.attributes.pOrg,
      half = o.count / 2;
    expect(o.getW(0)).toBe(1);
    expect(o.getX(0)).toBe(1);
    expect(o.getW(half)).toBe(0);
    expect(o.getX(half)).toBe(5);
  });
});

describe("땅: 보행로 재질과 길 이음", () => {
  it("민주대로는 마사토, 캠퍼스 보도는 붉은 벽돌, 캠퍼스 밖은 보도블록", () => {
    const campus = campusTest(map.roads),
      foot = footMaterials(map.roads, campus);
    map.roads.forEach((r, i) => {
      if (r.k !== 2) expect(foot[i]).toBeNull();
      else if (isPromenade(r)) expect(foot[i]).toBe("sand");
    });
    expect(foot.filter((f) => f === "brick").length).toBeGreaterThan(3);
    expect(foot.filter((f) => f === "pave").length).toBeGreaterThan(3);
    // 정문(캠퍼스 남쪽 끝)은 캠퍼스 안, 정문 남쪽 100m는 밖
    const [gx, gz] = map.anchors.gate;
    expect(campus(gx, gz - 20)).toBe(true);
    expect(campus(gx, gz + 100)).toBe(false);
  });

  it("직각으로 꺾인 길의 이음은 바깥만 부채꼴로 채운다(겹침 없음)", () => {
    const gb = new GroundBuilder();
    gb.ribbon([0, 0, 20, 0, 20, 20], 4, 0.1);
    const a = gb.geometry().attributes.position;
    // (0,0)→(20,0)→(20,20)은 +z 쪽으로 꺾인다: 바깥 틈은 꺾인 점의 x ≥ 20, z ≤ 0 쪽 사분면
    let fan = 0;
    for (let i = 0; i < a.count; i += 3) {
      const v = [0, 1, 2].map((k) => [a.getX(i + k), a.getZ(i + k)]);
      if (!v.some(([x, z]) => Math.hypot(x - 20, z) < 1e-6)) continue;
      fan++;
      for (const [x, z] of v) {
        expect(x).toBeGreaterThan(20 - 1e-4);
        expect(z).toBeLessThan(1e-4);
      }
    }
    expect(fan).toBeGreaterThan(0);
    // 띠 4 + 이음 부채꼴 3 + 끝 반원 3·3
    expect(a.count / 3).toBe(4 + 3 + 6);
  });
});

describe("거리 단계 인스턴싱", () => {
  it("거리에 따라 단계를 고르고, 같은 형상은 메시 하나를 함께 쓴다", () => {
    const hi1 = new THREE.BoxGeometry(1, 2, 1),
      hi2 = new THREE.BoxGeometry(1, 3, 1),
      lo = new THREE.BoxGeometry(1, 1, 1),
      far = new THREE.BoxGeometry(1, 1, 1);
    const inst = new LodInstancer<string>({
      name: "t",
      levels: [{ max: 90, castShadow: true }, { max: 190 }, { max: 600 }],
      material: new THREE.MeshBasicMaterial(),
      shape: (k) => ({ geos: [k === "a" ? hi1 : hi2, lo, far] }),
    });
    const put = (k: string, x: number) =>
      inst.add(k, new THREE.Matrix4().makeTranslation(x, 0, 0), new THREE.Color(1, 1, 1));
    put("a", 10);
    put("b", 20);
    put("a", 150);
    put("b", 160);
    put("a", 400);
    put("b", 700);
    const root = new THREE.Group(),
      update = inst.build(root);
    // 단계별 형상: 가까이 2개 + 줄인 것 1개 + 먼 것 1개
    expect(inst.meshes.length).toBe(4);
    update(0, 0);
    const byLevel = [0, 0, 0];
    for (const m of inst.meshes) byLevel[m.userData.lodLevel] += m.count;
    expect(byLevel).toEqual([2, 2, 1]);
    expect(inst.meshes.filter((m) => m.visible).length).toBe(4);
    expect(inst.meshes.filter((m) => m.castShadow).every((m) => m.userData.lodLevel === 0)).toBe(true);
    // 캐릭터가 400m 쪽으로 가면 그 나무가 가까운 단계로 바뀐다
    update(395, 0);
    const near = inst.meshes.filter((m) => m.userData.lodLevel === 0).reduce((s, m) => s + m.count, 0);
    expect(near).toBe(1);
  });
});
