import { describe, expect, it } from "vitest";
import {
  DEG_PER_DETENT,
  angleDelta,
  angleToTenths,
  bandStep,
  formatTenths,
  glide,
  keyStep,
  parseTenths,
  pointerAngle,
  tenthsToAngle,
  toTenths,
  tenthsInRange,
  turn,
  wheelDetents,
} from "../components/dial-math";

const MIN = 100,
  MAX = 1000; // 10.0 ~ 100.0 MHz

describe("frequency dial maths", () => {
  it("turns once for 5 MHz with a detent every 0.1 MHz", () => {
    expect(DEG_PER_DETENT).toBeCloseTo(7.2);
    expect(angleToTenths(360, MIN, MAX)).toBe(MIN + 50);
    expect(formatTenths(angleToTenths(360, MIN, MAX))).toBe("15.0");
    expect(tenthsToAngle(toTenths(51.8), MIN)).toBeCloseTo(418 * 7.2);
    // 51.8은 0.1 단위 정수로 소수 오차 없이 오간다
    expect(formatTenths(toTenths(51.8))).toBe("51.8");
    for (let t = MIN; t <= MAX; t += 37)
      expect(angleToTenths(tenthsToAngle(t, MIN), MIN, MAX)).toBe(t);
  });

  it("snaps a free angle to the nearest detent", () => {
    expect(angleToTenths(3.5, MIN, MAX)).toBe(MIN);
    expect(angleToTenths(3.7, MIN, MAX)).toBe(MIN + 1);
    expect(angleToTenths(7.2 * 12 + 3, MIN, MAX)).toBe(MIN + 12);
    expect(angleToTenths(7.2 * 12 - 3, MIN, MAX)).toBe(MIN + 12);
  });

  it("clamps the angle and the value to min..max", () => {
    expect(angleToTenths(-50, MIN, MAX)).toBe(MIN);
    expect(angleToTenths(1e6, MIN, MAX)).toBe(MAX);
    // 끝에서 더 돌려도 각도가 끝에 붙어, 되돌리면 곧바로 값이 줄어든다
    const end = tenthsToAngle(MAX, MIN);
    const pushed = turn(end - 3, 400, MIN, MAX);
    expect(pushed).toBe(end);
    expect(angleToTenths(turn(pushed, -7.2, MIN, MAX), MIN, MAX)).toBe(
      MAX - 1,
    );
    expect(turn(5, -90, MIN, MAX)).toBe(0);
    expect(parseTenths("150", MIN, MAX)).toBe(MAX);
    expect(parseTenths("3", MIN, MAX)).toBe(MIN);
    expect(parseTenths("51.84", MIN, MAX)).toBe(518);
    expect(parseTenths("", MIN, MAX)).toBeNull();
    expect(parseTenths("abc", MIN, MAX)).toBeNull();
    // 치는 중인 값은 범위 안일 때만 다이얼을 움직인다
    expect(tenthsInRange("5", MIN, MAX)).toBeNull();
    expect(tenthsInRange("120", MIN, MAX)).toBeNull();
    expect(tenthsInRange("51.", MIN, MAX)).toBe(510);
    expect(tenthsInRange("51.8", MIN, MAX)).toBe(518);
    expect(tenthsInRange("10", MIN, MAX)).toBe(MIN);
    expect(tenthsInRange("", MIN, MAX)).toBeNull();
  });

  it("measures finger angles clockwise from 12 o'clock and never jumps across 12", () => {
    expect(pointerAngle(0, -10)).toBeCloseTo(0);
    expect(pointerAngle(10, 0)).toBeCloseTo(90);
    expect(pointerAngle(0, 10)).toBeCloseTo(180);
    expect(pointerAngle(-10, 0)).toBeCloseTo(270);
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
    expect(angleDelta(90, 100)).toBeCloseTo(10);
    expect(angleDelta(100, 90)).toBeCloseTo(-10);
  });

  it("follows a full clockwise circle drawn in small finger steps", () => {
    let angle = tenthsToAngle(500, MIN),
      last = pointerAngle(0, -50);
    for (let deg = 6; deg <= 360; deg += 6) {
      const r = (deg * Math.PI) / 180,
        a = pointerAngle(50 * Math.sin(r), -50 * Math.cos(r));
      angle = turn(angle, angleDelta(last, a), MIN, MAX);
      last = a;
    }
    expect(formatTenths(angleToTenths(angle, MIN, MAX))).toBe("55.0");
  });

  it("steps by 0.1 with arrows, 1 MHz with PageUp/PageDown and jumps with Home/End", () => {
    expect(keyStep("ArrowUp", 500, MIN, MAX)).toBe(501);
    expect(keyStep("ArrowRight", 500, MIN, MAX)).toBe(501);
    expect(keyStep("ArrowDown", 500, MIN, MAX)).toBe(499);
    expect(keyStep("ArrowLeft", 500, MIN, MAX)).toBe(499);
    expect(keyStep("PageUp", 500, MIN, MAX)).toBe(510);
    expect(keyStep("PageDown", 500, MIN, MAX)).toBe(490);
    expect(keyStep("Home", 500, MIN, MAX)).toBe(MIN);
    expect(keyStep("End", 500, MIN, MAX)).toBe(MAX);
    expect(keyStep("ArrowUp", MAX, MIN, MAX)).toBe(MAX);
    expect(keyStep("PageDown", MIN + 3, MIN, MAX)).toBe(MIN);
    expect(keyStep("Enter", 500, MIN, MAX)).toBeNull();
  });

  it("turns one detent per wheel notch and reacts at once when reversed", () => {
    expect(wheelDetents(0, -100)).toEqual({ detents: 1, rest: 0 });
    expect(wheelDetents(0, 100)).toEqual({ detents: -1, rest: 0 });
    // 트랙패드처럼 잘게 오면 모아서 한 칸
    let r = wheelDetents(0, -40);
    expect(r.detents).toBe(0);
    r = wheelDetents(r.rest, -40);
    expect(r.detents).toBe(0);
    r = wheelDetents(r.rest, -40);
    expect(r).toEqual({ detents: 1, rest: -20 });
    // 반대로 굴리면 남은 픽셀을 버린다
    expect(wheelDetents(-60, 100).detents).toBe(-1);
    // 줄 단위(Firefox) 3줄 = 한 칸
    expect(wheelDetents(0, -3, 1).detents).toBe(1);
  });

  it("glides the auto demo smoothly and lands exactly on the target", () => {
    const up = glide(500, 518);
    expect(up.at(-1)).toBe(518);
    expect(up.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThan(up[i - 1]);
    const down = glide(500, 199);
    expect(down.at(-1)).toBe(199);
    expect(down.length).toBeLessThanOrEqual(36);
    for (let i = 1; i < down.length; i++)
      expect(down[i]).toBeLessThan(down[i - 1]);
    // 출발과 도착은 천천히(가운데 걸음이 가장 크다)
    const steps = down.map((v, i) => Math.abs(v - (down[i - 1] ?? 500)));
    expect(Math.max(...steps)).toBeGreaterThan(steps[0]);
    expect(Math.max(...steps)).toBeGreaterThan(steps.at(-1)!);
    expect(glide(500, 500)).toEqual([]);
  });

  it("labels the band every 10 MHz for the 10..100 course range", () => {
    expect(bandStep(10, 100)).toBe(10);
    expect(bandStep(10, 30)).toBe(5);
    expect(bandStep(10, 12)).toBe(1);
  });
});
