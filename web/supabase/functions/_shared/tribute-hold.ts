import { ROLES, type Role, type GameV2State } from "./types.ts";
export const HOLD_MS = 15000;
export const HOLD_LEASE_MS = 4000;
type Tribute = NonNullable<GameV2State["tributes"]>[string];
export function holdView(t: Tribute | undefined, completed: boolean, now: number) {
  const pressed = ROLES.map(r => completed || !!t?.holds?.[r] && now - t.holds[r]!.at < HOLD_LEASE_MS);
  const started = !completed && pressed.every(Boolean) ? t?.startedAt ?? null : null;
  return { window_ms: HOLD_MS, started_at: started, ends_at: started === null ? null : started + HOLD_MS,
    pressed, missed: !completed && started === null && (t?.round ?? 0) > 0, round: t?.round ?? 0 };
}
/** Client clocks never count. A missing lease breaks continuity; all four must confirm past the deadline. */
export function updateHold(t: Tribute, role: Role, answer: unknown, now: number) {
  const match = typeof answer === "string" && /^(start|hold|release):([a-zA-Z0-9-]{1,80})$/.exec(answer);
  if (!match) return { valid: false, complete: false };
  const holds = t.holds ??= {};
  for (const r of ROLES) if (holds[r] && now - holds[r]!.at >= HOLD_LEASE_MS) { delete holds[r]; t.startedAt = null; }
  const [, action, id] = match;
  if (action === "start") {
    if (holds[role]?.id !== id) t.startedAt = null;
    holds[role] = { id, at: now };
  } else if (holds[role]?.id === id) {
    if (action === "release") { delete holds[role]; t.startedAt = null; }
    else holds[role]!.at = now;
  }
  const all = ROLES.every(r => !!holds[r]);
  if (!all) t.startedAt = null;
  else if (t.startedAt === null) { t.startedAt = now; t.round++; }
  const complete = all && t.startedAt !== null && ROLES.every(r => holds[r]!.at >= t.startedAt! + HOLD_MS);
  return { valid: true, complete };
}
