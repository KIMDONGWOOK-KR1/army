import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { clayMaterial, worldMaterial } from "../components/field-clay";
import { groundMaterial } from "../components/field-ground";
import { fogFor, maxPolarFor, VIEW } from "../components/field-view";

// 필드 카메라·안개(field-view.ts)와 세계 재질 고르기(field-clay worldMaterial)를 본다.
describe("카메라 거리에 따른 극각·안개", () => {
  it("가까이(90m 안)는 1.25rad까지 눕히고, 200m 넘게 당기면 0.85rad로 내려다본다", () => {
    expect(maxPolarFor(0)).toBeCloseTo(VIEW.polar.high);
    expect(maxPolarFor(74)).toBeCloseTo(1.25);
    expect(maxPolarFor(90)).toBeCloseTo(1.25);
    expect(maxPolarFor(200)).toBeCloseTo(0.85);
    expect(maxPolarFor(400)).toBeCloseTo(0.85);
    let prev = Infinity;
    for (let d = 0; d <= 260; d += 10) {
      const p = maxPolarFor(d);
      expect(p).toBeLessThanOrEqual(prev + 1e-9);
      prev = p;
    }
    // 처음 극각은 가까이에서 허용하는 범위 안이다
    expect(VIEW.defaultPolar).toBeLessThan(maxPolarFor(74));
    expect(VIEW.defaultPolar).toBeGreaterThan(VIEW.minPolar);
  });

  it("안개는 카메라 거리만큼 뒤로 물러난다(기본 74m: 164→594m)", () => {
    expect(fogFor(74)).toEqual({ near: 164, far: 594 });
    const a = fogFor(100),
      b = fogFor(250);
    expect(b.near - a.near).toBe(150);
    expect(b.far - a.far).toBe(150);
  });
});

describe("세계 재질", () => {
  it("폰은 Lambert, 큰 화면은 무광 Standard", () => {
    expect(worldMaterial(true)).toBeInstanceOf(THREE.MeshLambertMaterial);
    const m = worldMaterial(false, 0.88) as THREE.MeshStandardMaterial;
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.roughness).toBe(0.88);
    expect(m.metalness).toBe(0);
    expect(m.vertexColors).toBe(true);
    expect(worldMaterial(true).vertexColors).toBe(true);
  });

  it("건물·땅 재질도 같은 고르기를 따른다", () => {
    expect(clayMaterial(true)).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(clayMaterial(false)).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(groundMaterial([], true)).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(groundMaterial([], false)).toBeInstanceOf(THREE.MeshStandardMaterial);
  });
});
