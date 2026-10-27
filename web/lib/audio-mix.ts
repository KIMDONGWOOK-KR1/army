// User mix is separate from scene ducking and the memorial silence policy.
export type AudioMix = { music: number; effects: number };
export const MIX_KEY = "hoguk:audio-mix:v1";
export const DEFAULT_MIX: Readonly<AudioMix> = Object.freeze({ music: 0.6, effects: 0.75 });
export const MIX_PRESETS = {
  balanced: { music: 0.6, effects: 0.75 },
  focus: { music: 0.25, effects: 0.6 },
  effects: { music: 0, effects: 0.75 },
} as const;
export function clampVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}
export function readMix(storage: Pick<Storage, "getItem"> | null): AudioMix {
  try {
    const value = JSON.parse(storage?.getItem(MIX_KEY) ?? "null");
    return { music: clampVolume(value?.music, DEFAULT_MIX.music), effects: clampVolume(value?.effects, DEFAULT_MIX.effects) };
  } catch { return { ...DEFAULT_MIX }; }
}
export function mixLevels(mix: AudioMix, sceneMusic: number, sceneFiles: number) {
  return { synth: mix.music * sceneMusic, files: mix.music * sceneFiles, effects: mix.effects };
}
