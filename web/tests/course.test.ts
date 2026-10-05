import { it, expect } from "vitest";
import { prepareCourse } from "../supabase/functions/_shared/prepare-course";
import source from "../../codex-handoff-v2/data/courses/jnu.json";
import example from "../../codex-handoff-v2/data/courses/jnu.answers.example.json";
it("refuses unconfirmed field coordinates and placeholder content", async () => {
  await expect(prepareCourse(source, example, "s".repeat(32))).rejects.toThrow(
    /확정/,
  );
});
it("requires a strong server salt", async () => {
  await expect(prepareCourse(source, example, "short")).rejects.toThrow(/32/);
});
