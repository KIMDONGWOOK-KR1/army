import { describe, expect, it } from "vitest";
import { judgeArrival, haversine } from "../lib/arrival";
const target = { lat: 35, lng: 126, radiusM: 30 };
const fix = (timestamp: number, accuracy = 10, lat = 35) => ({
  lat,
  lng: 126,
  accuracy,
  timestamp,
});
describe("GPS arrival", () => {
  it("requires three valid samples and five continuous seconds", () => {
    expect(judgeArrival([fix(0), fix(1000)], target).arrived).toBe(false);
    expect(
      judgeArrival(
        Array.from({ length: 7 }, (_, i) => fix(i * 1000)),
        target,
      ).arrived,
    ).toBe(false);
    expect(
      judgeArrival(
        Array.from({ length: 8 }, (_, i) => fix(i * 1000)),
        target,
      ).arrived,
    ).toBe(true);
  });
  it("resets dwell on high accuracy errors and long gaps", () => {
    expect(
      judgeArrival(
        [fix(0), fix(1000), fix(2000), fix(3000, 41), fix(7000)],
        target,
      ).arrived,
    ).toBe(false);
    expect(
      judgeArrival([fix(0), fix(1000), fix(2000), fix(10000)], target).arrived,
    ).toBe(false);
  });
  it("does not accept repeated or out-of-order timestamps or invalid positions", () => {
    expect(
      judgeArrival(
        Array.from({ length: 20 }, () => fix(1000)),
        target,
      ).arrived,
    ).toBe(false);
    expect(
      judgeArrival([fix(0), fix(1000), fix(2000), fix(3000, NaN)], target)
        .arrived,
    ).toBe(false);
  });
  it("resets when the averaged position leaves the radius", () => {
    expect(
      judgeArrival(
        [fix(0), fix(1000), fix(2000), fix(3000, 10, 36), fix(4000)],
        target,
      ).arrived,
    ).toBe(false);
    expect(haversine(35, 126, 35, 126)).toBe(0);
    expect(haversine(35, 126, 36, 126)).toBeGreaterThan(100000);
  });
});
