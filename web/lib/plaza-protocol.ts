/** Virtual plaza coordinates only. No device location or game answers travel here. */
export type PlazaPose = {
  x: number; z: number; heading: number; moving: boolean; dancing: boolean;
  beat: number; salute: { id: string; at: number } | null;
};
export type PlazaFrame = { v: 1; member: string; session: string; seq: number; at: number; pose: PlazaPose };
export type PlazaWire = PlazaFrame | { leave: string; session: string };
export type SharedBoat = { id: string; memberId: string; nickname: string; text: string; at: number; kind: "reflection" | "message" };
export const PLAZA_STALE_MS = 7000;
export function validFrame(value: unknown): value is PlazaFrame {
  if (!value || typeof value !== "object") return false;
  const f = value as PlazaFrame, p = f.pose;
  return f.v === 1 && typeof f.member === "string" && f.member.length <= 80 &&
    typeof f.session === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(f.session) &&
    Number.isSafeInteger(f.seq) && f.seq >= 0 && Number.isFinite(f.at) && !!p &&
    [p.x,p.z,p.heading,p.beat].every(Number.isFinite) && Math.hypot(p.x,p.z) <= 38 &&
    Math.abs(p.heading) <= Math.PI * 4 && Math.abs(p.beat) < 1e10 &&
    typeof p.moving === "boolean" && typeof p.dancing === "boolean" &&
    (p.salute === null || (!!p.salute && typeof p.salute.id === "string" && p.salute.id.length <= 80 && Number.isFinite(p.salute.at)));
}
export class PlazaPeers {
  readonly frames = new Map<string, { frame: PlazaFrame; received: number }>();
  private retired = new Set<string>();
  constructor(private self: string, private members: Set<string>) {}
  accept(value: unknown, now: number) {
    if (!validFrame(value) || value.member === this.self || !this.members.has(value.member)) return false;
    const previous = this.frames.get(value.member)?.frame;
    if (this.retired.has(`${value.member}:${value.session}`)) return false;
    if (previous?.session === value.session && previous.seq >= value.seq) return false;
    if (previous && previous.session !== value.session) {
      if (value.at < previous.at) return false;
      this.retired.add(`${previous.member}:${previous.session}`);
      if (this.retired.size > 64) this.retired.delete(this.retired.values().next().value!);
    }
    this.frames.set(value.member, { frame: value, received: now });
    return true;
  }
  leave(member: string, session: string) {
    if (this.frames.get(member)?.frame.session === session) this.frames.delete(member);
  }
  prune(now: number) { for (const [id,p] of this.frames) if (now-p.received > PLAZA_STALE_MS) this.frames.delete(id); }
}
