import { describe, expect, it } from "vitest";
import {
  angleDiff, bearingDeg, distanceM, FIELD, FIELD_BEARING, rearHeading, rubbingInk, signalStrength, trueHeading,
} from "@/lib/field-sense";

describe("현장 도구 방향 계산", () => {
  it("정문에서 용봉관은 북북동 쪽 약 338m", () => {
    expect(FIELD_BEARING.hall).toBeGreaterThan(15);
    expect(FIELD_BEARING.hall).toBeLessThan(23);
    expect(Math.abs(distanceM(FIELD.gate, FIELD.hall) - 338)).toBeLessThan(10);
    // 용봉탑은 같은 길 위에 있다
    expect(Math.abs(angleDiff(bearingDeg(FIELD.gate, FIELD.tower), FIELD_BEARING.hall))).toBeLessThan(3);
  });
  it("5·18 소공원은 남동쪽 가까이, 피어나다는 길 건너 서쪽", () => {
    expect(FIELD_BEARING.park).toBeGreaterThan(110);
    expect(FIELD_BEARING.park).toBeLessThan(130);
    expect(distanceM(FIELD.gate, FIELD.park)).toBeLessThan(40);
    expect(FIELD_BEARING.bloom).toBeGreaterThan(245);
    expect(FIELD_BEARING.bloom).toBeLessThan(265);
  });
  it("각도 차이는 -180~180, +면 오른쪽", () => {
    expect(angleDiff(10, 350)).toBeCloseTo(20);
    expect(angleDiff(350, 10)).toBeCloseTo(-20);
    expect(Math.abs(angleDiff(180, 0))).toBeCloseTo(180);
  });
  it("세워 든 폰의 뒤 카메라 방위", () => {
    expect(rearHeading(0, 90, 0)).toBeCloseTo(0);
    expect(rearHeading(90, 90, 0)).toBeCloseTo(270);
    expect(rearHeading(270, 90, 0)).toBeCloseTo(90);
  });
  it("자북을 진북으로 바꾼다(광주 서편 8.5°)", () => {
    expect(trueHeading(10)).toBeCloseTo(1.5);
    expect(trueHeading(3)).toBeCloseTo(354.5);
  });
  it("신호 세기는 목표를 볼수록 1, 90° 넘게 벗어나면 0", () => {
    expect(signalStrength(0)).toBe(1);
    expect(signalStrength(45)).toBeCloseTo(0.25);
    expect(signalStrength(-120)).toBe(0);
  });
});

describe("탁본 먹 그림", () => {
  it("평평한 면은 먹, 새긴 선(밝기가 바뀌는 곳)은 종이로 남는다", () => {
    const w = 40, h = 30, lum = new Float32Array(w * h).fill(90);
    for (let y = 10; y < 20; y++) for (let x = 15; x < 25; x++) lum[y * w + x] = 200;
    const ink = rubbingInk(lum, w, h);
    expect(ink[2 * w + 2]).toBe(1);
    expect(ink[15 * w + 15]).toBe(0);
    expect(ink[15 * w + 20]).toBe(1);
  });
  it("아무 무늬 없는 사진도 먹으로 덮인다", () => {
    const ink = rubbingInk(new Float32Array(20 * 20).fill(128), 20, 20);
    expect(Math.min(...ink)).toBe(1);
  });
});
