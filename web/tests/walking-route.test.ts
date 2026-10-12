import { describe, expect, it } from "vitest";
import { clearsWalkingRoute } from "../lib/walking-route";
import { crosswalkBars, roadGrid } from "../components/field-ground";
import map from "../components/maps/jnu.json";
import type { MapPoi } from "../components/field-geom";

describe("walkway clearance and sourced crossings", () => {
  it("keeps tree crowns and avatar bodies clear of straight paths, corners and endpoints", () => {
    const legs = [[0, 0, 0, 20, 20, 20]];
    expect(clearsWalkingRoute(legs, 0, 12, 4)).toBe(false);
    expect(clearsWalkingRoute(legs, 4, 16, 4)).toBe(false);
    expect(clearsWalkingRoute(legs, 23, 23, 4)).toBe(false);
    expect(clearsWalkingRoute(legs, -7, 10, 4)).toBe(true);
  });
  it("retains both decorative avenue rows outside the walking corridor", () => {
    const retained = [];
    for (let i = 0; i < map.rows.length; i += 2)
      if (clearsWalkingRoute(map.legs, map.rows[i], map.rows[i + 1], 3.9)) retained.push(i);
    expect(retained.length).toBeGreaterThan(map.rows.length / 2 * 0.7);
    expect(map.legs).toHaveLength(4);
  });
  it("includes the missing service-road crossings at their public OSM nodes", () => {
    for (const osm of ["n1211682775", "n10252846149", "n10252846150", "n10310832393"])
      expect(map.pois.find((p) => "osm" in p && p.osm === osm)).toMatchObject({ k: "crossing", markings: "yes" });
    expect(map.pois.find((p) => "osm" in p && p.osm === "n10252846171")).toMatchObject({ markings: "unknown" });
  });
  it("renders marked service-road crossings, without inventing stripes for unknown or unmarked ones", () => {
    const grid = roadGrid([{ k: 1, w: 7, p: [0, -30, 0, 30] }]);
    const pois: MapPoi[] = ["yes", "unknown", "no"].map((markings, i) => ({
      k: "crossing", x: 0, z: (i - 1) * 12, a: 0, markings: markings as MapPoi["markings"],
    }));
    expect(crosswalkBars(pois, grid)).toHaveLength(1);
    expect(crosswalkBars(pois, grid)[0].z).toBe(-12);
  });
});
