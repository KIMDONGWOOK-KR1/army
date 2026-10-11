/** Shared interaction values adapted from motion-foundations. No game answers. */
export const motionTokens = {
  duration: { instant: 0, fast: .18, normal: .28 },
  scale: { press: .98, pop: 1.03 },
  drag: { elastic: .08 },
} as const;
export const springs = {
  snappy: { type: "spring", stiffness: 300, damping: 30 },
  release: { type: "spring", stiffness: 200, damping: 20, restDelta: .001 },
} as const;
