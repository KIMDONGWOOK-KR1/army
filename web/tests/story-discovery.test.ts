import { describe, expect, it } from "vitest";
import { discoveryKey, readDiscovery } from "../lib/story-discovery";

describe("discovery presentation memory", () => {
  it("recovers from missing, malformed and unexpected session storage", () => {
    for (const raw of [null, "{", "null", "42", '{"opened":true,"collected":{}}'])
      expect(readDiscovery(raw, ["synthetic-A"])).toEqual({ opened: [], collected: [] });
  });
  it("retains only known step ids and discards duplicate, foreign and private-like fields", () => {
    const raw = JSON.stringify({ opened: ["synthetic-A", "synthetic-A", "foreign", 5], collected: ["synthetic-B", {}], answer: "synthetic input", record: "synthetic memo" });
    expect(readDiscovery(raw, ["synthetic-A", "synthetic-B"])).toEqual({ opened: ["synthetic-A"], collected: ["synthetic-B"] });
  });
  it("isolates cosmetic progress across rooms, stages and roles", () => {
    const keys = [discoveryKey("room-A", "gate", "scout"), discoveryKey("room-B", "gate", "scout"), discoveryKey("room-A", "yongbong", "scout"), discoveryKey("room-A", "gate", "signal")];
    expect(new Set(keys).size).toBe(4);
  });
});
