import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MapData, PoiKind } from "../components/field-geom";

// 구운 지도 자료(components/maps/jnu.json)가 굽기 설정(scripts/jnu-map.config.json)의
// 높이 근거·맞춤 상자를 담았고, 거리 소품 자리를 쓸 수 있는 모양인지 본다.
const ROOT = join(__dirname, "..");
const map = JSON.parse(
  readFileSync(join(ROOT, "components", "maps", "jnu.json"), "utf8"),
) as MapData;
const config = JSON.parse(
  readFileSync(join(ROOT, "scripts", "jnu-map.config.json"), "utf8"),
) as {
  heights: Record<string, { h?: number; levels?: number; src: string } | string>;
};
const r1 = (v: number) => Math.round(v * 10) / 10;

describe("지도 자료: 높이 근거", () => {
  const fixes = Object.entries(config.heights).filter(
    ([id]) => !id.startsWith("_"),
  ) as [string, { h?: number; levels?: number; src: string }][];

  it("팀이 정한 건물 높이를 설정에 근거와 함께 적었다", () => {
    const want: Record<string, number> = {
      w1120956385: 18, // 정보마루
      w290374303: 20, // 민주마루
      w270549104: 19, // 중앙도서관
      w277767025: 33, // 대학본부
      w1120956383: 18, // 사회과학대학
      w277766413: 17, // 제1학생마루
      w271056107: 15, // 인문대 3호관
      r3690972: 33.9, // 법전원 1호관
    };
    for (const [id, h] of Object.entries(want)) {
      const fix = config.heights[id];
      expect(fix, id).toBeTypeOf("object");
      if (typeof fix !== "object") continue;
      expect(fix.h, id).toBe(h);
      expect(fix.src.length, `${id} src`).toBeGreaterThan(5);
    }
  });

  it("구운 건물이 설정 높이·층수를 쓰고 근거 표시(hs)를 갖는다", () => {
    for (const [id, fix] of fixes) {
      const found = map.buildings.filter((b) => b.id === id);
      expect(found.length, id).toBeGreaterThan(0);
      for (const b of found) {
        expect(b.h, id).toBe(r1(fix.h ?? (fix.levels ?? 0) * 3.4 + 1));
        expect(b.hs, id).toBe(1);
        if (fix.levels) expect(b.lv, id).toBe(fix.levels);
      }
    }
  });

  it("모든 건물에 종류(t)가 있고 근거 없는 높이는 hs가 없다", () => {
    for (const b of map.buildings) {
      expect(typeof b.t, b.id).toBe("string");
      expect(b.hs === undefined || b.hs === 1, b.id).toBe(true);
      expect(Number.isFinite(b.h) && b.h > 0, b.id).toBe(true);
    }
    expect(map.buildings.filter((b) => b.hs === 1).length).toBeGreaterThan(
      fixes.length,
    );
  });
});

describe("지도 자료: 소품 자리·화단·맞춤 상자", () => {
  const KINDS: PoiKind[] = [
    "bench",
    "bicycle_parking",
    "shelter",
    "bus_stop",
    "waste_basket",
    "entrance",
    "crossing",
  ];

  it("거리 소품 자리는 알려진 종류와 유한한 좌표·방향을 갖는다", () => {
    const pois = map.pois ?? [];
    expect(pois.length).toBeGreaterThan(100);
    for (const p of pois) {
      expect(KINDS).toContain(p.k);
      for (const v of [p.x, p.z, p.a]) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(p.a)).toBeLessThanOrEqual(Math.PI + 0.01);
    }
    for (const k of ["bench", "entrance", "crossing", "bus_stop"])
      expect(
        pois.some((p) => p.k === k),
        k,
      ).toBe(true);
  });

  it("민주대로 쉼터 자리(벤치 두 개와 쉼터)가 실제 자리에 있다", () => {
    const near = (map.pois ?? []).filter(
      (p) => Math.hypot(p.x - 23, p.z + 131) < 8,
    );
    expect(near.filter((p) => p.k === "bench").length).toBe(2);
    expect(near.filter((p) => p.k === "shelter").length).toBe(1);
  });

  it("화단(flower) 면이 있다", () => {
    expect(map.areas.some((a) => a.k === "flower")).toBe(true);
  });

  it("용봉관과 랜드마크 후보 건물에 맞춤 상자가 있다", () => {
    for (const key of ["hall", "jungbomaru", "minjumaru", "library", "hq"]) {
      const b = map.boxes[key];
      expect(b, key).toBeDefined();
      expect(b.w, key).toBeGreaterThan(10);
      expect(b.d, key).toBeGreaterThan(10);
      expect(Number.isFinite(b.a), key).toBe(true);
    }
  });
});
