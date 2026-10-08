import { describe, expect, it } from "vitest";
import {
  bandOffset,
  HOME,
  heroDistance,
  homeCamera,
  roadAxis,
  soldierSpots,
} from "../components/home-view";

// 첫 화면 입체 배경(home-view.ts)의 장병 자리와 카메라 길을 본다.
describe("첫 화면 카메라 길", () => {
  it("한 바퀴(period초)마다 같은 자리로 끊김 없이 돌아온다", () => {
    const t0 = HOME.intro.sec + 5,
      a = homeCamera(t0),
      b = homeCamera(t0 + HOME.period);
    expect(b.az).toBeCloseTo(a.az, 9);
    expect(b.distK).toBeCloseTo(a.distK, 9);
    expect(b.elevation).toBeCloseTo(a.elevation, 9);
  });

  it("정면에서 시작해 흔들림 폭 안에서만 돈다", () => {
    expect(homeCamera(0).az).toBe(0);
    for (let t = 0; t < HOME.period * 2; t += 0.5) {
      const c = homeCamera(t);
      expect(Math.abs(c.az)).toBeLessThanOrEqual(HOME.swing + 1e-9);
      expect(c.distK).toBeGreaterThan(0.85);
      expect(c.elevation).toBeGreaterThanOrEqual(HOME.elevation - 1e-9);
    }
  });

  it("처음에는 위·뒤에서 내려앉고, 몇 초 뒤에는 기본 높이로 돌아온다", () => {
    expect(homeCamera(0).elevation).toBeGreaterThan(HOME.elevation);
    expect(homeCamera(0).distK).toBeGreaterThan(1 + HOME.dolly);
    expect(homeCamera(HOME.intro.sec).elevation).toBeCloseTo(HOME.elevation);
  });

  it("움직임 줄이기 설정이면 카메라가 서 있다", () => {
    expect(homeCamera(0, true)).toEqual(homeCamera(17, true));
    expect(homeCamera(17, true).az).toBe(0);
  });
});

describe("정문 앞 네 장병", () => {
  const gate = { x: 0, z: 0 },
    axis = roadAxis(gate, { x: 96.8, z: -261.1 });

  it("정문 바깥(용봉탑 반대쪽)에 서서 바깥을 본다", () => {
    const spots = soldierSpots(gate, axis);
    expect(spots).toHaveLength(4);
    for (const s of spots) {
      // 안쪽 방향과의 내적이 음수 = 정문 바깥
      expect(s.x * axis.x + s.z * axis.z).toBeLessThan(-HOME.front + HOME.arc + 1e-6);
      // 앞(+z를 돌린 방향)이 바깥을 향한다
      const fx = Math.sin(s.ry),
        fz = Math.cos(s.ry);
      expect(fx * -axis.x + fz * -axis.z).toBeGreaterThan(0.98);
    }
  });

  it("문 사이(약 15m) 안에 고르게 늘어선다", () => {
    const spots = soldierSpots(gate, axis),
      side = { x: axis.z, z: -axis.x },
      across = spots.map((s) => s.x * side.x + s.z * side.z);
    for (let i = 1; i < across.length; i++)
      expect(across[i] - across[i - 1]).toBeCloseTo(HOME.spacing);
    expect(Math.max(...across) - Math.min(...across)).toBeLessThan(15);
  });
});

describe("화면 띠에 맞춘 구도", () => {
  it("띠가 낮을수록 카메라가 물러나되 정한 범위를 넘지 않는다", () => {
    const near = heroDistance(787, 360, 42),
      far = heroDistance(787, 200, 42);
    expect(far).toBeGreaterThan(near);
    expect(heroDistance(787, 10, 42)).toBeLessThanOrEqual(HOME.dist.max);
    expect(heroDistance(787, 2000, 42)).toBeGreaterThanOrEqual(HOME.dist.min);
  });

  it("띠 가운데가 화면 가운데보다 아래면 시야를 위로 옮긴다(음수)", () => {
    expect(bandOffset(800, 300, 600)).toBeCloseTo(400 - 474);
    expect(bandOffset(800, 0, 690)).toBeCloseTo(0, 0);
    // 띠가 너무 좁으면 화면 가운데 근처로
    expect(bandOffset(800, 500, 520)).toBeCloseTo(400 - 440);
  });
});
