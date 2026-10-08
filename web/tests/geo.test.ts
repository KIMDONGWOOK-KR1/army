import { describe, expect, it } from "vitest";
import { haversine } from "../lib/arrival";
import {
  closestAlong,
  pointAlong,
  polylineLength,
  projector,
} from "../lib/geo";

describe("geo", () => {
  const origin = { lat: 35, lng: 126 };
  const { toLocal, toLatLng } = projector(origin);

  it("projects to metres that match haversine distance", () => {
    for (const [dn, de] of [
      [320, 109],
      [-150, 400],
      [800, -600],
    ]) {
      const p = {
        lat: origin.lat + dn / 111195,
        lng:
          origin.lng + de / (111195 * Math.cos((origin.lat * Math.PI) / 180)),
      };
      const q = toLocal(p),
        flat = Math.hypot(q.x, q.z),
        real = haversine(origin.lat, origin.lng, p.lat, p.lng);
      expect(Math.abs(flat - real) / real).toBeLessThan(0.002);
      expect(Math.sign(q.x)).toBe(Math.sign(de));
      expect(Math.sign(q.z)).toBe(-Math.sign(dn));
      const back = toLatLng(q);
      expect(back.lat).toBeCloseTo(p.lat, 9);
      expect(back.lng).toBeCloseTo(p.lng, 9);
    }
  });

  it("walks along a polyline by distance", () => {
    const line = [0, 0, 30, 0, 30, -40];
    expect(polylineLength(line)).toBe(70);
    expect(pointAlong(line, 15)).toEqual({ x: 15, z: 0 });
    expect(pointAlong(line, 50)).toEqual({ x: 30, z: -20 });
    expect(pointAlong(line, 999)).toEqual({ x: 30, z: -40 });
    expect(pointAlong(line, -5)).toEqual({ x: 0, z: 0 });
  });

  it("finds how far along a polyline the nearest point is", () => {
    const line = [0, 0, 30, 0, 30, -40];
    expect(closestAlong(line, 12, 5)).toBeCloseTo(12);
    expect(closestAlong(line, 36, -20)).toBeCloseTo(50);
    expect(closestAlong(line, -9, 3)).toBe(0);
    expect(closestAlong(line, 30, -60)).toBeCloseTo(70);
  });
});
