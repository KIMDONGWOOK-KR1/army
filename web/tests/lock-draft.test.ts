import { describe, expect, it } from "vitest";
import { reconcileLockDraft } from "../components/use-lock-draft";
import { createGame, project } from "../supabase/functions/_shared/engine";
import { demoCourse } from "../supabase/functions/_shared/course";
import type { Snapshot } from "../supabase/functions/_shared/types";

async function snapshot() {
  const course = await demoCourse();
  const game = createGame("host", "입력시험", course, 0, "TEST");
  game.members[0].role = "commander";
  return project(game, course, "host", 0);
}

describe("lock draft reconciliation", () => {
  it("preserves blanks, zero, and edits across repeated snapshots and unrelated updates", async () => {
    const initial = await snapshot();
    const draft = {
      ...reconcileLockDraft(initial, null),
      digits: ["", "0", "", "7"],
    };
    const polled = structuredClone(initial);
    polled.server_now++;
    polled.version++;
    polled.game.report_mask[1] = true;
    expect(reconcileLockDraft(polled, draft)).toEqual(draft);
    expect(
      reconcileLockDraft(polled, { ...draft, digits: ["", "0", "", ""] })
        .digits,
    ).toEqual(["", "0", "", ""]);
  });

  it("clears rejected digits even when an attempt locks no new digit", async () => {
    const initial = await snapshot();
    const draft = {
      ...reconcileLockDraft(initial, null),
      digits: ["0", "0", "0", "0"],
    };
    const next = structuredClone(initial);
    next.self.lock!.attempts++;
    expect(reconcileLockDraft(next, draft).digits).toEqual(["", "", "", ""]);
  });

  it("gives server-locked digits priority and preserves later edits only in unlocked slots", async () => {
    const initial = await snapshot();
    const draft = {
      ...reconcileLockDraft(initial, null),
      digits: ["9", "0", "0", "0"],
    };
    initial.self.lock!.attempts++;
    initial.self.lock!.digits[0] = 2;
    const confirmed = reconcileLockDraft(initial, draft);
    expect(confirmed.digits).toEqual(["2", "", "", ""]);
    expect(
      reconcileLockDraft(initial, { ...confirmed, digits: ["9", "1", "", ""] })
        .digits,
    ).toEqual(["2", "1", "", ""]);
  });

  it.each(["game", "member", "role", "site", "reset"])(
    "discards drafts after a %s change",
    async (change) => {
      const initial = await snapshot();
      const draft = {
        ...reconcileLockDraft(initial, null),
        digits: ["2", "1", "3", "7"],
      };
      let next: Snapshot | null = structuredClone(initial);
      if (change === "game") next.game.id = "new-game";
      if (change === "member") next.self.id = "new-member";
      if (change === "role") {
        next.self.role = "scout";
        next.self.lock = null;
      }
      if (change === "site") next.current_site = next.course.sites[1];
      if (change === "reset") next = null;
      const cleared = reconcileLockDraft(next, draft);
      expect(cleared.digits.every((digit) => digit === "")).toBe(true);
      expect(reconcileLockDraft(initial, cleared).digits).toEqual([
        "",
        "",
        "",
        "",
      ]);
    },
  );
});
