"use client";
import { useState } from "react";
import type { Snapshot } from "@/supabase/functions/_shared/types";

type LockDraft = { scope: string; digits: string[] };

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
  if (draft.scope !== current.scope) setDraft(current);
  const setDigits = (digits: string[]) => setDraft({ ...current, digits });
  return { digits: current.digits, setDigits };
}
