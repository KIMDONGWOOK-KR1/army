import { describe, expect, it } from "vitest";
import { statueNearby } from "../components/bongji-statue";

describe("석상 음악 구역", () => {
  it("먼 곳에서는 시작하지 않고 충분히 다가오면 연다", () => {
    expect(statueNearby(20, false)).toBe(false);
    expect(statueNearby(9, false)).toBe(true);
  });
  it("경계에서 작은 위치 흔들림이 곡을 반복해서 껐다 켜지 않는다", () => {
    let near = false;
    const observations = [10, 8.8, 9.2, 8.9, 10.5, 11.8, 12.1];
    expect(observations.map((distance) => near = statueNearby(distance, near)))
      .toEqual([false, true, true, true, true, true, false]);
  });
});
