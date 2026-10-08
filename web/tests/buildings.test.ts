import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bodyParts,
  buildingCache,
  buildNear,
  classify,
  nearParts,
  obbDist,
  planBuilding,
  planCtx,
  renderHeight,
  TILE,
  type StyledBuilding,
  type StyledMap,
} from "../components/field-buildings";
import { chunkBytes, ClayWriter, WIN } from "../components/field-clay";
import { LANDMARK_SLOTS } from "../components/field-landmark-slots";

// 지도 윤곽으로 빚는 점토 건물(field-buildings.ts)이 실제 높이 규칙·재질 결정·폰 예산을 지키는지 본다.
const map = JSON.parse(
  readFileSync(join(__dirname, "..", "components", "maps", "jnu.json"), "utf8"),
) as StyledMap;
const ctx = planCtx(map);
const byId = (id: string) => map.buildings.find((b) => b.id === id) as StyledBuilding;

describe("건물 높이", () => {
  it("24m까지는 0.9배, 그 위는 21.6 + 0.35배, 가장 낮아도 3.2m", () => {
    expect(renderHeight(3.5)).toBeCloseTo(3.2);
    expect(renderHeight(13)).toBeCloseTo(11.7);
    expect(renderHeight(24)).toBeCloseTo(21.6);
    expect(renderHeight(33.9)).toBeCloseTo(25.065);
    expect(renderHeight(65)).toBeCloseTo(35.95);
    let last = 0;
    for (let h = 0; h <= 80; h += 0.5) {
      const r = renderHeight(h);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it("팀이 정한 캠퍼스 건물 높이가 그대로 벽 높이가 된다", () => {
    for (const [id, h] of [
      ["w1120956385", 18],
      ["w290374303", 20],
      ["w270549104", 19],
      ["r3690972", 33.9],
    ] as const) {
      const pl = planBuilding(byId(id), ctx)!;
      expect(pl.H, id).toBeCloseTo(renderHeight(h));
    }
  });
});

describe("건물 분류와 재질", () => {
  it("사진·자료로 확인한 외벽을 쓴다", () => {
    expect(planBuilding(byId("w271056106"), ctx)!.kind).toBe("brick"); // 인문대 1호관
    const lib = planBuilding(byId("w270549104"), ctx)!; // 중앙도서관
    expect(lib.kind).toBe("brick");
    expect(lib.code % 16).toBe(WIN.BRICK_RIBBON);
    expect(byId("w270549104").rr?.[1]).toBe(7);
    expect(planBuilding(byId("w277767025"), ctx)!.kind).toBe("white"); // 대학본부
    expect(planBuilding(byId("w290374303"), ctx)!.kind).toBe("white"); // 민주마루
    expect(planBuilding(byId("w1120956385"), ctx)!.kind).toBe("bands"); // 정보마루
  });

  it("정문 동쪽 둥근 단층 건물은 낱창 한 줄과 크림 난간 테(0.45)를 두른다", () => {
    const pl = planBuilding(byId("w1374639828"), ctx)!;
    expect(pl.kind).toBe("small");
    expect(pl.code % 16).toBe(WIN.CAMPUS);
    expect(pl.rows).toBe(1);
    expect(pl.parapet).toBe(0.45);
    expect(pl.roof).toBe("flat");
    // 다른 작은 채는 그대로(난간 없음)
    const others = map.buildings
      .filter((b) => b.id !== "w1374639828")
      .map((b) => planBuilding(b as StyledBuilding, ctx))
      .filter((p) => p && p.kind === "small" && p.parapet > 0);
    expect(others).toEqual([]);
  });

  it("캠퍼스 벽은 크림과 회백(#dfe4ea)이 반쯤씩이다", () => {
    const walls = map.buildings
      .map((b) => planBuilding(b as StyledBuilding, ctx))
      .filter((p) => p && p.kind === "campus");
    const grey = walls.filter((p) => p!.wall[2] > p!.wall[0]).length;
    expect(grey / walls.length).toBeGreaterThan(0.35);
    expect(grey / walls.length).toBeLessThan(0.65);
  });

  it("캠퍼스 안 높은 건물은 아파트가 아니라 캠퍼스 건물이다", () => {
    expect(planBuilding(byId("r3690972"), ctx)!.kind).toBe("campus");
  });

  it("분류 규칙: 재질 > 온실 > 작은 것 > 아파트 > 캠퍼스 > 상가 > 주택", () => {
    const b = (o: Partial<StyledBuilding>) => ({ id: "x", p: [], h: 10, t: "yes", ...o }) as StyledBuilding;
    expect(classify(b({ m: "brick", t: "greenhouse" }), 100, false, false)).toBe("brick");
    expect(classify(b({ t: "greenhouse" }), 100, false, false)).toBe("greenhouse");
    expect(classify(b({}), 30, false, false)).toBe("small");
    expect(classify(b({ h: 30 }), 300, false, false)).toBe("apartment");
    expect(classify(b({ h: 30 }), 300, true, false)).toBe("campus");
    expect(classify(b({}), 300, false, true)).toBe("shop");
    expect(classify(b({}), 300, false, false)).toBe("house");
  });

  it("정문 남쪽 동네에 파스텔 주택·상가와 경사 지붕이 섞인다", () => {
    const plans = map.buildings
      .map((b) => planBuilding(b as StyledBuilding, ctx))
      .filter((p) => p && p.obb.cz > 0);
    const kinds = new Set(plans.map((p) => p!.kind));
    expect(kinds.has("house")).toBe(true);
    expect(kinds.has("shop")).toBe(true);
    const pitched = plans.filter((p) => p!.roof === "hip" || p!.roof === "pillow").length;
    expect(pitched).toBeGreaterThan(20);
  });

  it("캠퍼스 경계와 랜드마크 자리 건물이 지도 자료에 있다", () => {
    expect(map.campus?.length).toBeGreaterThanOrEqual(6);
    for (const s of LANDMARK_SLOTS) {
      expect(byId(s.osmId), s.key).toBeDefined();
      if (s.box) expect(map.boxes[s.box], s.key).toBeDefined();
    }
  });
});

describe("형상", () => {
  const plans = map.buildings
    .map((b) => planBuilding(b as StyledBuilding, ctx))
    .filter((p) => p !== null);
  const near = {
    roads: map.roads,
    carRoads: ctx.carRoads,
    legs: map.legs,
    entrances: new Map(),
  };

  it("모든 윤곽이 NaN 없는 형상이 되고, 지붕판은 위를 본다", () => {
    expect(plans.length).toBeGreaterThan(700);
    for (const pl of plans) {
      const w = new ClayWriter();
      bodyParts(w, pl);
      nearParts(w, pl, near);
      expect(w.p.every(Number.isFinite), pl.b.id).toBe(true);
      expect(w.n.every(Number.isFinite), pl.b.id).toBe(true);
      expect(w.triangles, pl.b.id).toBeGreaterThan(0);
      // 지붕 높이에서 위를 향한 법선을 가진 삼각형은 감는 방향도 위(+y)다
      for (let k = 0; k < w.i.length; k += 3) {
        const [a, b, c] = [w.i[k], w.i[k + 1], w.i[k + 2]];
        if (w.n[a * 3 + 1] < 0.99 || w.n[b * 3 + 1] < 0.99 || w.n[c * 3 + 1] < 0.99) continue;
        const ux = w.p[b * 3] - w.p[a * 3],
          uz = w.p[b * 3 + 2] - w.p[a * 3 + 2],
          vx = w.p[c * 3] - w.p[a * 3],
          vz = w.p[c * 3 + 2] - w.p[a * 3 + 2];
        expect(uz * vx - ux * vz, pl.b.id).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it("폰 예산: 몸체+덧붙임 삼각형이 한 채 평균 600개, 가장 많아도 2500개 이하", () => {
    let sum = 0,
      max = 0;
    for (const pl of plans) {
      const w = new ClayWriter();
      bodyParts(w, pl);
      nearParts(w, pl, near);
      sum += w.triangles;
      max = Math.max(max, w.triangles);
    }
    expect(sum / plans.length).toBeLessThan(600);
    expect(max).toBeLessThan(2500);
  });

  it("같은 자료로 두 번 빚으면 같은 형상이 나온다", () => {
    const pl = plans[123];
    const a = new ClayWriter(),
      b = new ClayWriter();
    bodyParts(a, pl);
    nearParts(a, pl, near);
    bodyParts(b, planBuilding(pl.b, planCtx(map))!);
    nearParts(b, planBuilding(pl.b, planCtx(map))!, near);
    expect(b.p).toEqual(a.p);
    expect(b.i).toEqual(a.i);
  });
});

describe("구역과 가까이 덧붙임", () => {
  const cache = buildingCache(map);

  it("몸체는 128m 구역으로 묶고 삼각형이 폰 예산 안이다", () => {
    expect(TILE).toBe(128);
    expect(cache.tiles.length).toBeGreaterThan(20);
    expect(cache.stats.bodyTris).toBeLessThan(120000);
    for (const t of cache.tiles) {
      const tris = t.body!.index!.count / 3;
      expect(tris).toBeLessThan(25000);
      expect(t.body!.userData.shared).toBe(true);
    }
  });

  it("랜드마크 자리는 따로 한 덩어리씩, 용봉관은 field-map.ts에 맡긴다", () => {
    expect(cache.slots.map((s) => s.slot.key).sort()).toEqual(["hq", "jungbomaru", "library", "minjumaru"]);
    for (const s of cache.slots) expect(s.geo.index!.count / 3).toBeLessThan(8000);
    const tiled = new Set(cache.tiles.flatMap((t) => t.plans.map((p) => p.b.id)));
    for (const s of LANDMARK_SLOTS) expect(tiled.has(s.osmId), s.key).toBe(false);
  });

  it("출발점 둘레 64m 덧붙임이 메모리·삼각형 예산 안이다", () => {
    const [x, z] = map.anchors.start!;
    let tris = 0,
      bytes = 0;
    for (const r of cache.recs) {
      if (obbDist(r.pl.obb, x, z) > 96) continue;
      buildNear(r, cache.nearCtx);
      bytes += chunkBytes(r.near!);
      if (obbDist(r.pl.obb, x, z) < 64) tris += r.near!.i.length / 3;
    }
    expect(tris).toBeGreaterThan(0);
    expect(tris).toBeLessThan(20000);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });
});
