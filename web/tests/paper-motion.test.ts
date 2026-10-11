import { describe, expect, it } from "vitest";
import { paperDestination, type PaperRect } from "../lib/paper-motion";
const from: PaperRect = { left: 20, top: 200, width: 300, height: 224 };
describe("paper flight layout", () => {
  it("aligns source and notebook centers across different viewport layouts", () => {
    expect(paperDestination({ kind: "collect", from, to: { left: 26, top: 70, width: 44, height: 44 } }))
      .toBe(`translate(-122px, -220px) scale(${44 / 172})`);
  });
  it("ends locally when the notebook target is absent or hidden", () => {
    expect(paperDestination({ kind: "collect", from })).toBe("translateY(-8px) scale(1.03)");
    expect(paperDestination({ kind: "collect", from, to: { left: 0, top: 0, width: 0, height: 0 } })).toBe("translateY(-8px) scale(1.03)");
  });
});
