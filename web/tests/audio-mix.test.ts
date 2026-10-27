import { describe, expect, it } from "vitest";
import { DEFAULT_MIX, MIX_KEY, MIX_PRESETS, mixLevels, readMix } from "../lib/audio-mix";
import { HOME, heroDistance } from "../components/home-view";

describe("persisted audio mix", () => {
  it("recovers from missing, malformed or blocked storage", () => {
    expect(readMix(null)).toEqual(DEFAULT_MIX);
    expect(readMix({getItem: () => "broken"})).toEqual(DEFAULT_MIX);
    expect(readMix({getItem: () => {throw new Error("blocked");}})).toEqual(DEFAULT_MIX);
  });
  it("clamps values and preserves a deliberately silent music channel", () => {
    expect(readMix({getItem: key => key === MIX_KEY ? '{"music":0,"effects":3}' : null})).toEqual({music:0,effects:1});
    expect(readMix({getItem: () => '{"music":-2,"effects":"loud"}'})).toEqual({music:0,effects:DEFAULT_MIX.effects});
  });
  it("scene ducking never unmutes music or ducks the independent cue channel", () => {
    expect(mixLevels(MIX_PRESETS.effects, 1, 1)).toEqual({synth:0, files:0, effects:0.75});
    expect(mixLevels(MIX_PRESETS.focus, 0.16, 0.5)).toEqual({synth:0.04, files:0.125, effects:0.6});
  });
});
it("the entire crew fits horizontally even at the closest camera position", () => {
  const span = HOME.spacing * 3 + HOME.soldierM * 1.1;
  for (const [w,h] of [[320,844],[390,844],[768,1024],[1440,900]]) {
    const fov = w/h < 0.8 ? 50 : 34;
    const distance = heroDistance(h, h * 0.65, fov, w) * (1 - HOME.dolly);
    const visibleWidth = 2 * distance * Math.tan(fov * Math.PI / 360) * w/h;
    expect(span / visibleWidth).toBeLessThanOrEqual(0.841);
  }
});
