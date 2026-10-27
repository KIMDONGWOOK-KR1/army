import type { V2Response } from "./game-snapshot";
import type { Role } from "@/supabase/functions/_shared/types";

/** Use public counts, never another role's private mission, to hide unavailable hints. */
export function roleStepsComplete(snapshot: Pick<V2Response, "game" | "self">, target: Role) {
  const total = snapshot.game.step_total_count?.[target] ??
    (snapshot.self.role === target ? snapshot.self.mission?.steps.length : undefined);
  // Older Edge responses do not include other roles' totals; do not guess them.
  return total !== undefined && (snapshot.game.step_done_count[target] ?? 0) >= total;
}
