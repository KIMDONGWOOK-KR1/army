import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CALM_R, calmZones, coverArrival, inCalm, MEMORIAL_AT } from "../components/field-calm";
import type { MapData } from "../components/field-geom";
import {
  calmGateFlowers,
  calmHallFlowers,
  lightHallRoof,
} from "../components/field-landmarks";
import { propTemplate } from "../components/field-props-kit";
import {
  frameTop,
  rippleState,
  STOP,
  stopPole,
  stopScale,
  stopSpinRate,
} from "../components/field-stop";

// 5·18 사적지 둘레(조용한 구역)는 돌빛과 흰 꽃만 쓴다(결정 사항). 소품 묶음의 조용한 화단·흰 꽃과
// 용봉관 블렌더 모형의 현관 화단에 분홍·노랑·보라 꽃이 남지 않았는지 본다.

// 채도 높은 꽃 색(초록 잎이 아닌 것)인가. 선형 색 기준.
function flowerish(r: number, g: number, b: number) {
  const hi = Math.max(r, g, b),
    lo = Math.min(r, g, b);
  if (hi < 0.25 || (hi - lo) / hi < 0.45) return false;
  return !(g >= r && g >= b); // 잎·풀은 초록이 가장 크다
}

// 소품 꽃 색(분홍·노랑·보라)과 빛깔이 같은가(밝기는 빼고 견준다). 흙·돌·잎은 걸리지 않는다.
const FLOWER_HEX = ["#ef7088", "#f6c74e", "#c9b8e8"];
const unit = (r: number, g: number, b: number) => {
  const m = Math.max(r, g, b, 1e-6);
  return [r / m, g / m, b / m];
};
function paletteFlower(r: number, g: number, b: number) {
  const u = unit(r, g, b);
  return FLOWER_HEX.some((hex) => {
    const c = new THREE.Color(hex),
      v = unit(c.r, c.g, c.b);
    return Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 0.06;
  });
}

function readGlbGeometry(file: string) {
  const b = readFileSync(join(__dirname, "../public/models", file));
  const len = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
  const bin = 20 + len + 8;
  const prim = g.meshes[0].primitives[0];
  const read = (i: number, comps: number) => {
    const a = g.accessors[i],
      v = g.bufferViews[a.bufferView],
      off = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
      size = a.componentType === 5126 ? 4 : 2,
      stride = v.byteStride ?? size * comps,
      out = new Float32Array(a.count * comps);
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < comps; c++)
        out[k * comps + c] =
          a.componentType === 5126
            ? b.readFloatLE(off + k * stride + c * 4)
            : b.readUInt16LE(off + k * stride + c * 2) / 65535;
    return out;
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(read(prim.attributes.POSITION, 3), 3));
  if (prim.attributes.NORMAL !== undefined)
    geo.setAttribute("normal", new THREE.BufferAttribute(read(prim.attributes.NORMAL, 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(read(prim.attributes.COLOR_0, 4), 4));
  return geo;
}

describe("조용한 구역의 꽃", () => {
  it("조용한 화단과 흰 꽃 소품에는 분홍·노랑·보라 꽃 색이 없다", () => {
    for (const kind of ["planterCalm", "flowerWhite"] as const) {
      const t = propTemplate(kind);
      for (let i = 0; i < t.col.length; i += 3)
        expect(
          paletteFlower(t.col[i], t.col[i + 1], t.col[i + 2]),
          `${kind} 꼭짓점 ${i / 3}`,
        ).toBe(false);
    }
    // 일반 화단은 그대로 알록달록하다(시험이 꽃 색을 알아보는지 확인)
    const pl = propTemplate("planter");
    let colorful = 0;
    for (let i = 0; i < pl.col.length; i += 3)
      if (paletteFlower(pl.col[i], pl.col[i + 1], pl.col[i + 2])) colorful++;
    expect(colorful).toBeGreaterThan(0);
  });

  it("용봉관 모형의 현관 화단 꽃은 흰 꽃이 되고 벽돌·잎은 그대로다", () => {
    const geo = readGlbGeometry("hall.glb"),
      p = geo.attributes.position,
      c = geo.attributes.color,
      before = Float32Array.from(c.array as Float32Array);
    const inBeds = (i: number) =>
      Math.abs(p.getX(i)) < 8 &&
      p.getY(i) > 0.4 &&
      p.getY(i) < 1.1 &&
      p.getZ(i) > 9.7 &&
      p.getZ(i) < 10.7;
    let flowersBefore = 0;
    for (let i = 0; i < p.count; i++)
      if (inBeds(i) && flowerish(c.getX(i), c.getY(i), c.getZ(i))) flowersBefore++;
    expect(flowersBefore).toBeGreaterThan(50);

    const n = calmHallFlowers(geo);
    expect(n).toBe(flowersBefore);
    for (let i = 0; i < p.count; i++) {
      if (inBeds(i)) {
        expect(flowerish(c.getX(i), c.getY(i), c.getZ(i))).toBe(false);
        continue;
      }
      // 화단 밖(벽돌 벽 등)은 한 꼭짓점도 바뀌지 않는다
      for (let k = 0; k < 3; k++)
        expect(c.getComponent(i, k)).toBe(before[i * 4 + k]);
    }
    // 두 번 불러도 다시 칠하지 않는다(모형은 화면을 다시 열 때도 같이 쓴다)
    expect(calmHallFlowers(geo)).toBe(0);
  });
});

describe("정문 모형의 분리대 화분", () => {
  it("노란 꽃은 흰 꽃(#fff6ea)이 되고 화분 밖은 그대로다", () => {
    const geo = readGlbGeometry("gate.glb"),
      p = geo.attributes.position,
      c = geo.attributes.color,
      before = Float32Array.from(c.array as Float32Array);
    const inBeds = (i: number) =>
      Math.abs(p.getX(i)) < 0.5 &&
      p.getY(i) > 0.38 &&
      p.getY(i) < 0.95 &&
      p.getZ(i) > -2.2 &&
      p.getZ(i) < 1.8;
    let flowersBefore = 0;
    for (let i = 0; i < p.count; i++)
      if (inBeds(i) && flowerish(c.getX(i), c.getY(i), c.getZ(i))) flowersBefore++;
    expect(flowersBefore).toBeGreaterThan(10);
    expect(calmGateFlowers(geo)).toBe(flowersBefore);
    const white = new THREE.Color("#fff6ea");
    for (let i = 0; i < p.count; i++) {
      if (inBeds(i)) {
        expect(flowerish(c.getX(i), c.getY(i), c.getZ(i))).toBe(false);
        continue;
      }
      for (let k = 0; k < 3; k++) expect(c.getComponent(i, k)).toBe(before[i * 4 + k]);
    }
    // 바뀐 꼭짓점은 흰 꽃 빛깔(밝기만 다르다)
    let seen = 0;
    for (let i = 0; i < p.count; i++)
      if (inBeds(i) && c.getX(i) !== before[i * 4]) {
        seen++;
        expect(c.getY(i) / c.getX(i)).toBeCloseTo(white.g / white.r, 3);
      }
    expect(seen).toBe(flowersBefore);
    expect(calmGateFlowers(geo)).toBe(0);
  });
});

describe("용봉관 모형 지붕", () => {
  it("11m 위 평지붕 바닥은 밝은 회색(#d4d4d0)이 되고 흰 난간은 그대로다", () => {
    const geo = readGlbGeometry("hall.glb"),
      p = geo.attributes.position,
      n = geo.attributes.normal,
      c = geo.attributes.color,
      before = Float32Array.from(c.array as Float32Array);
    const n0 = lightHallRoof(geo);
    expect(n0).toBeGreaterThan(20);
    const grey = new THREE.Color("#d4d4d0");
    let changed = 0;
    for (let i = 0; i < p.count; i++) {
      const was = [before[i * 4], before[i * 4 + 1], before[i * 4 + 2]],
        hi = Math.max(...was);
      const same = [0, 1, 2].every((k) => c.getComponent(i, k) === was[k]);
      if (p.getY(i) < 11 || n.getY(i) < 0.9 || hi >= 0.85) {
        expect(same, `꼭짓점 ${i}`).toBe(true); // 벽·난간 갓돌은 그대로
        continue;
      }
      if (!same) {
        changed++;
        expect(c.getX(i) / c.getZ(i)).toBeCloseTo(grey.r / grey.b, 3);
      }
    }
    expect(changed).toBe(n0);
    expect(lightHallRoof(geo)).toBe(0);
  });
});

describe("조용한 구역 목록(field-calm)", () => {
  const map = JSON.parse(
    readFileSync(join(__dirname, "../components/maps/jnu.json"), "utf8"),
  ) as MapData;

  it("정문 50m, 용봉관은 도착 범위(30m)+15m까지 덮는다", () => {
    const zones = calmZones(map),
      A = map.anchors,
      gate = zones[0],
      hall = zones.find((z) => z.x === map.boxes.hall!.c[0])!;
    expect(gate.r).toBe(CALM_R.gate);
    const d = Math.hypot(A.hall![0] - hall.x, A.hall![1] - hall.z);
    expect(hall.r).toBeCloseTo(Math.max(CALM_R.hall, d + 30 + 15), 5);
    expect(hall.r).toBeGreaterThan(65);
    // 도착 반경 안 어디든 조용한 구역이다
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      expect(inCalm(zones, A.gate[0] + 30 * Math.cos(a), A.gate[1] + 30 * Math.sin(a))).toBe(true);
      expect(inCalm(zones, A.hall![0] + 30 * Math.cos(a), A.hall![1] + 30 * Math.sin(a))).toBe(true);
    }
    expect(inCalm(zones, MEMORIAL_AT.x, MEMORIAL_AT.z)).toBe(true);
    // 구역 밖 거점은 넓히지 않는다
    expect(coverArrival({ x: 0, z: 0, r: 10 }, [50, 0]).r).toBe(10);
  });

  it("조용한 구역의 거점 표석은 돌지 않고, 기둥이 낮고, 발밑 물결이 없다", () => {
    expect(stopSpinRate("now", true)).toBe(0);
    expect(stopSpinRate("next", true)).toBe(0);
    expect(stopSpinRate("done", false)).toBe(0);
    expect(stopSpinRate("now", false)).toBe(STOP.spin);
    expect(stopPole(true)).toBe(STOP.poleCalm);
    expect(stopScale("now", true)).toBeLessThan(stopScale("now", false));
    for (const t of [0, 800, 1600, 3100]) {
      expect(rippleState(t, true).visible).toBe(false);
      const r = rippleState(t, false);
      expect(r.visible).toBe(true);
      expect(r.opacity).toBeLessThanOrEqual(0.25);
    }
  });

  it("펼친 기록 액자는 용봉관 처마(13m)보다 낮다", () => {
    expect(frameTop(true)).toBeLessThan(13);
    expect(frameTop(false)).toBeLessThan(13);
  });
});
