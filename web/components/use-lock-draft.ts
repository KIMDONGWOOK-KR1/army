"use client";
import { useState } from "react";
import type { Snapshot } from "@/supabase/functions/_shared/types";

export type LockDraft = { scope: string; digits: string[] };

export function reconcileLockDraft(
  snapshot: Snapshot | null,
  draft: LockDraft | null,
): LockDraft {
  const lock = snapshot?.self.lock;
  // Scene changes keep the draft; identity, site, or a server verdict discards it.
  // attempts also changes when every submitted digit is wrong.
  const scope = JSON.stringify([
    snapshot?.game.id,
    snapshot?.self.id,
    snapshot?.self.role,
    snapshot?.current_site.id,
    lock?.attempts,
    lock?.digits,
  ]);
  const digits = (lock?.digits ?? []).map((digit, index) =>
    digit !== null
      ? String(digit)
      : draft?.scope === scope
        ? (draft.digits[index] ?? "")
        : "",
  );
  return { scope, digits };
}

export function useLockDraft(snapshot: Snapshot | null) {
  const [draft, setDraft] = useState(() => reconcileLockDraft(snapshot, null));
  const current = reconcileLockDraft(snapshot, draft);
  // While no snapshot is loaded yet, keep the draft (a draft handed over from the other
  // mockup view waits here for its snapshot; a new game still gets a new scope).
  if (snapshot && draft.scope !== current.scope) setDraft(current);
  const setDigits = (digits: string[]) => setDraft({ ...current, digits });
  // Phone mockup view switch: restore the draft the previous document was typing.
  const restore = (seed: LockDraft) => setDraft(seed);
  return { digits: current.digits, setDigits, draft: current, restore };
}
