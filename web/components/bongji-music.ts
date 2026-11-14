export type PlazaZone = "pond" | "statue";
export const PLAZA_MUSIC = {
  pond: { file: "hoguk-bongji-afternoon", seconds: 76.8, bpm: 100, beatOffset: .054 },
  statue: { file: "hoguk-bongji-afternoon-house", seconds: 64, bpm: 120, beatOffset: .045 },
} as const;
/** Both arrangements contain 32 bars; preserve the phrase when changing zone. */
export function phraseOffset(offset: number, elapsed: number, fromSeconds: number, toSeconds: number) {
  const position = ((offset + Math.max(0, elapsed)) % fromSeconds + fromSeconds) % fromSeconds;
  return position / fromSeconds * toSeconds;
}
