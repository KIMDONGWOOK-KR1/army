import { describe, expect, it } from "vitest";
import { hasCompleteDraft, playCopy } from "../lib/story-play";
import { STORY_B, STORY_B_PLAY, narrationLines } from "../lib/narration";
import type { Step } from "../supabase/functions/_shared/types";

const step = (extra: Partial<Step>): Step => ({ id: "synthetic", type: "text", grading: "hash", prompt: "합성 단서", confirmed: true, ...extra });
describe("playable MINO drafts", () => {
  it("keeps missing or blank card selections from being submitted", () => {
    const truth = step({ type: "truefalse", statements: ["합성 A", "합성 B"] });
    expect(hasCompleteDraft(truth, ["true", ""])).toBe(false);
    expect(hasCompleteDraft(truth, ["false", "true"])).toBe(true);
    const order = step({ type: "order", choices: ["가", "나", "다"] });
    expect(hasCompleteDraft(order, ["1", "2"])).toBe(false);
    expect(hasCompleteDraft(order, ["3", "2", "1"])).toBe(true);
  });
  it("requires every mandatory notebook field even when it is on a hidden page", () => {
    const notebook = step({ grading: "record", fields: [{ id: "first", label: "관찰", required: true, maxLen: 300 }, { id: "source", label: "자료", required: true, maxLen: 300 }, { id: "extra", label: "추가", required: false, maxLen: 300 }] });
    expect(hasCompleteDraft(notebook, { first: "기록", source: "   " })).toBe(false);
    expect(hasCompleteDraft(notebook, { first: "기록", source: "확인 불가" })).toBe(true);
    expect(hasCompleteDraft(notebook, "기록")).toBe(false);
  });
  it("checks amount of selection but never tries to determine correctness", () => {
    const mark = step({ type: "spot-correct", grading: "set-hash", answerCount: 3 });
    expect(hasCompleteDraft(mark, ["1", "2"])).toBe(false);
    expect(hasCompleteDraft(mark, ["1", "2", "3", "4"])).toBe(false);
    expect(hasCompleteDraft(mark, ["5", "2", "4"])).toBe(true);
    expect(hasCompleteDraft(step({}), "어떤 관찰이든 서버가 판정")).toBe(true);
  });
  it("keeps the full script while shortening playable narration and preserving legacy narration", () => {
    expect(STORY_B.prologue).toContain("용봉탑");
    expect(STORY_B_PLAY.intro.join("").length).toBeLessThan(90);
    expect(narrationLines("intro", undefined, true)).toEqual(STORY_B_PLAY.intro);
    expect(narrationLines("intro", undefined, false)[0]).toBe("1980년 5월, 광주.");
    expect(playCopy(step({ id: "G-03.freq" })).action).toBe("신호 연결");
  });
});
