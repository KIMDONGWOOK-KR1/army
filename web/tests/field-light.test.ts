import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  LIGHT,
  lightBasis,
  patchShadowFade,
  shadowHalf,
  snapToTexel,
} from "../components/field-light";
import {
  AdaptiveQuality,
  fieldFlags,
  QUALITY,
  qualityLevels,
} from "../components/field-perf";

const DIR = new THREE.Vector3(...LIGHT.sun.offset).normalize();

describe("그림자 상자를 텍셀 단위로 옮기기", () => {
  const texel = (2 * 70) / 1024,
    basis = lightBasis(DIR);
  const coords = (p: THREE.Vector3) => [
    p.dot(basis.right) / texel,
    p.dot(basis.up) / texel,
  ];

  it("빛 공간 두 축은 서로 직각이고 빛 방향과도 직각이다", () => {
    expect(basis.right.dot(basis.up)).toBeCloseTo(0, 9);
    expect(basis.right.dot(DIR)).toBeCloseTo(0, 9);
    expect(basis.up.dot(DIR)).toBeCloseTo(0, 9);
  });

  it("옮긴 자리는 빛 공간에서 텍셀의 정수배이고 빛 방향 성분은 그대로다", () => {
    for (const p of [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(167.9, 0, 33.5),
      new THREE.Vector3(97.3, 0, -245.1),
      new THREE.Vector3(-512.7, 0, 801.2),
    ]) {
      const s = snapToTexel(p, DIR, texel);
      for (const c of coords(s))
        expect(Math.abs(c - Math.round(c))).toBeLessThan(1e-6);
      expect(s.dot(DIR)).toBeCloseTo(p.dot(DIR), 6);
      // 반 칸보다 많이 움직이지 않는다
      expect(s.distanceTo(p)).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-9);
    }
  });

  it("한 칸보다 적게 움직이면 같은 자리, 넘으면 한 칸씩 뛴다", () => {
    const a = snapToTexel(new THREE.Vector3(10, 0, 10), DIR, texel),
      b = snapToTexel(
        new THREE.Vector3(10, 0, 10).addScaledVector(basis.right, texel * 0.2),
        DIR,
        texel,
      ),
      c = snapToTexel(
        new THREE.Vector3(10, 0, 10).addScaledVector(basis.right, texel * 1.0),
        DIR,
        texel,
      );
    // 0.2칸 움직임은 원래 자리가 칸 가운데 근처가 아니면 같은 칸이다
    const da = coords(a),
      dc = coords(c);
    expect(Math.round(dc[0] - da[0])).toBe(1);
    expect(dc[1]).toBeCloseTo(da[1], 6);
    const db = Math.round(coords(b)[0] - da[0]);
    expect([0, 1]).toContain(db);
    expect(b.distanceTo(a)).toBeCloseTo(db * texel, 6);
  });

  it("상자 크기는 카메라 거리에 맞춰 10m 단위로, 60~120m 안에서 고른다", () => {
    expect(shadowHalf(30)).toBe(60);
    expect(shadowHalf(74)).toBe(70);
    expect(shadowHalf(100)).toBe(90);
    expect(shadowHalf(240)).toBe(120);
    // 폰은 75m에서 멈춘다
    expect(shadowHalf(74, true)).toBe(70);
    expect(shadowHalf(240, true)).toBe(75);
  });

  it("three 그림자 함수 하나만 고치고, 두 번 고치지 않는다", () => {
    const src = THREE.ShaderChunk.shadowmap_pars_fragment;
    // 불러올 때 이미 고쳐져 있다
    expect(src).toContain("field-shadow-fade");
    expect(patchShadowFade(src)).toBe(src);
    expect(src.match(/field-shadow-fade/g)?.length).toBe(1);
    // 고치기 전 원문에는 PCF 그림자 함수가 있어야 한다(three를 올렸을 때 알아채게)
    const raw = src.replace(
      /\/\* field-shadow-fade \*\/[\s\S]*?\n\t\t\t(?=return)/,
      "",
    );
    expect(raw).toContain("float getShadow( sampler2DShadow shadowMap");
    expect(patchShadowFade(raw)).toContain("field-shadow-fade");
  });
});

describe("적응 화질", () => {
  it("폰은 픽셀 비율 1.75 → 1.4 → 1.1, 다음 그림자 512, 마지막에 그림자를 끈다", () => {
    expect(qualityLevels(3, true)).toEqual([
      { pixelRatio: 1.75, shadow: 1024 },
      { pixelRatio: 1.4, shadow: 1024 },
      { pixelRatio: 1.1, shadow: 1024 },
      { pixelRatio: 1.1, shadow: 512 },
      { pixelRatio: 1.1, shadow: 0 },
    ]);
    // 픽셀 비율 1인 데스크톱은 같은 단계를 합친다
    expect(qualityLevels(1, false)).toEqual([
      { pixelRatio: 1, shadow: 2048 },
      { pixelRatio: 1, shadow: 1024 },
      { pixelRatio: 1, shadow: 512 },
      { pixelRatio: 1, shadow: 0 },
    ]);
  });

  const run = (q: AdaptiveQuality, ms: number, seconds: number) => {
    const changes: number[] = [];
    for (let t = 0; t < seconds * 1000; t += ms)
      if (q.tick(ms)) changes.push(q.level);
    return changes;
  };

  it("60fps면 그대로, 2초 넘게 느리면 한 단계씩 내린다", () => {
    const q = new AdaptiveQuality(qualityLevels(3, true));
    expect(run(q, 16.7, 10)).toEqual([]);
    expect(q.level).toBe(0);
    // 40ms(25fps): 처음 1.5초는 재지 않고, 평균이 오른 뒤 2초 넘게 느리면 내린다
    const down = run(q, 40, 6);
    expect(down[0]).toBe(1);
    expect(q.level).toBeGreaterThanOrEqual(1);
  });

  it("오래 느리면 그림자를 끄는 마지막 단계까지 내려가고, 빨라지면 천천히 되돌린다", () => {
    const q = new AdaptiveQuality(qualityLevels(3, true));
    run(q, 60, 40);
    expect(q.level).toBe(q.levels.length - 1);
    expect(q.current.shadow).toBe(0);
    // 16ms가 짧게 이어지면 아직 올리지 않는다
    run(q, 16, QUALITY.recoverAfter * 0.5);
    expect(q.level).toBe(q.levels.length - 1);
    // 오래 빠르면 다시 올린다(내려간 횟수만큼 기다림이 길다)
    run(q, 16, 2000);
    expect(q.level).toBe(0);
  });

  it("탭 전환처럼 아주 긴 프레임 하나로는 내리지 않는다", () => {
    const q = new AdaptiveQuality(qualityLevels(3, true));
    run(q, 16.7, 3);
    expect(q.tick(5000)).toBe(false);
    run(q, 16.7, 3);
    expect(q.level).toBe(0);
  });

  it("?fq=N이면 그 단계로 고정한다", () => {
    expect(fieldFlags("?fq=2&dev=1")).toEqual({ pinned: 2, dev: true });
    expect(fieldFlags("")).toEqual({ pinned: null, dev: false });
    const q = new AdaptiveQuality(qualityLevels(3, true), 0);
    run(q, 80, 20);
    expect(q.level).toBe(0);
    expect(q.ema).toBeGreaterThan(60);
  });
});
