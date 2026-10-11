/** Screen-space decoration only. These are DOM rectangles, never GPS positions. */
export type PaperRect = { left: number; top: number; width: number; height: number };
export type PaperMotion = { kind: "open" | "collect"; from: PaperRect; to?: PaperRect };
export const PAPER_DURATION = 280;
export const PAPER_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const PAPER_MOVE = "cubic-bezier(0.77, 0, 0.175, 1)";

export function paperDestination(motion: PaperMotion): string {
  const { from, to } = motion;
  if (motion.kind !== "collect" || !to || to.width <= 0 || to.height <= 0) return "translateY(-8px) scale(1.03)";
  const x = to.left + to.width / 2 - (from.left + from.width / 2);
  const y = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = Math.min(.4, Math.max(.18, to.width / 172));
  return `translate(${x}px, ${y}px) scale(${scale})`;
}
