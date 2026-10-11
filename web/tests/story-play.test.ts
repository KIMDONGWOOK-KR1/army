import { describe, expect, it } from "vitest";
import { connectChoice, hasCompleteDraft, playCopy, usesGateStory } from "@/lib/story-play";
import type { Step } from "@/supabase/functions/_shared/types";

const step = (overrides: Partial<Step> = {}): Step => ({
  id: "current-question", confirmed: false, type: "text", prompt: "서버에서 받은 현재 질문", grading: "hash", ...overrides,
});

describe("gate story presentation contract", () => {
  it("routes any current gate question IDs and types, preserving other stages and legacy missions", () => {
    const steps = [step({ type: "order" }), step({ id: "another-id", type: "spot-correct" })];
    expect(usesGateStory("gate", steps)).toBe(true);
    expect(usesGateStory("yongbong", steps)).toBe(false);
    expect(usesGateStory("bongji", steps)).toBe(false);
    expect(usesGateStory("gate", [])).toBe(false);
    expect(usesGateStory("gate", [step({ id: "G-01.legacy" })])).toBe(false);
  });

  it("uses the current server prompt without ID-specific question copy", () => {
    const current = step({ id: "G-03.words", type: "words", answerCount: 5 });
    expect(playCopy(current).tip).toBe(current.prompt);
    expect(playCopy(current).title).toBe(playCopy({ ...current, id: "renamed" }).title);
    expect(playCopy(current).title).not.toContain("세");
  });

  it("takes order and word counts from each question", () => {
    const order = step({ type: "order", grading: "order-hash", choices: ["항목 A", "항목 B"] });
    expect(hasCompleteDraft(order, ["2", "1"])).toBe(true);
    expect(hasCompleteDraft(order, ["1"])).toBe(false);
    expect(hasCompleteDraft(order, ["1", "1"])).toBe(false);
    expect(hasCompleteDraft(order, ["1", "3"])).toBe(false);
    const words = step({ type: "words", grading: "set-hash", answerCount: 2 });
    expect(hasCompleteDraft(words, ["첫 낱말", "둘째 낱말"])).toBe(true);
    expect(hasCompleteDraft(words, ["첫 낱말", " "])).toBe(false);
    expect(hasCompleteDraft(words, ["첫 낱말", "둘째 낱말", "초과"])).toBe(false);
  });

  it("supports free-form observation and correction fields without fixed IDs", () => {
    const observation = step({ type: "observation" });
    expect(hasCompleteDraft(observation, "현장에서 관찰한 내용")).toBe(true);
    const correction = step({ type: "spot-correct", grading: "record", fields: [
      { id: "updated", label: "수정 내용", required: true, maxLen: 100 },
      { id: "note", label: "선택 기록", required: false, maxLen: 100 },
    ] });
    expect(hasCompleteDraft(correction, { updated: "참가자 수정 기록" })).toBe(true);
    expect(hasCompleteDraft(correction, { note: "선택 항목만 작성" })).toBe(false);
  });
});

describe("editable match drafts", () => {
  const match = step({ type: "match", grading: "map-hash" });

  it("swaps occupied choices in a complete draft without mutating the original", () => {
    const original = { a: "1", b: "2", c: "3" };
    expect(connectChoice(match, original, "a", "2")).toEqual({ a: "2", b: "1", c: "3" });
    expect(original).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("allows deselection and reassigns an occupied choice to an empty field", () => {
    expect(connectChoice(match, { a: "1", b: "2" }, "a", "1")).toEqual({ b: "2" });
    expect(connectChoice(match, { b: "2" }, "a", "2")).toEqual({ a: "2" });
  });

  it("allows the same category on multiple classification fields", () => {
    expect(connectChoice(step({ type: "classification" }), { a: "1", b: "2" }, "a", "2"))
      .toEqual({ a: "2", b: "2" });
  });
});
