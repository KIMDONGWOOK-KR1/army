import { composeRecordSentence } from "../supabase/functions/_shared/record-sentence";
import { describe, expect, it } from "vitest";
import { team } from "./helpers/v2";
import { syntheticStoryAnswers } from "./helpers/story-b";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { storyBDemoV2Input } from "../supabase/functions/_shared/story-b-course-v2";
import { validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { draftV2 } from "../supabase/functions/_shared/closing-v2";
import type { Command } from "../supabase/functions/_shared/types";

describe("MINO 2026-10-11 contract", () => {
  it("accepts omitted method/source on immutable legacy content without inventing verification", async () => {
    const t = await team();
    const step = t.course.stages[1].roles.scout!.steps[0];
    expect(step.sourceRequired).toBe(true);
    await t.call("scout", { action: "submit-step", step_id: step.id, answer: t.input.stages.gate.steps[step.id].answer });
    const view = projectGameV2(t.game, t.course, t.user("scout"), t.now());
    expect(view.self.step_progress[step.id]).toMatchObject({ status: "done" });
    expect(view.self.step_progress[step.id]).not.toHaveProperty("method");
    expect(view.self.mission!.steps.every((s) => s.sourceRequired === false)).toBe(true);
    expect(t.events.at(-1)!.data).not.toHaveProperty("method");
  });
  it("still rejects forged verification methods and invalid legacy source IDs", async () => {
    const t = await team(), step = t.course.stages[1].roles.scout!.steps[0];
    const cmd = { action: "submit-step", step_id: step.id, answer: t.input.stages.gate.steps[step.id].answer };
    await expect(t.call("scout", { ...cmd, method: "explained" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(t.call("scout", { ...cmd, source: { text: "합성 출처", source_id: "unknown" } })).rejects.toMatchObject({ code: "SOURCE_REQUIRED" });
    expect(t.game.v2!.progress.gate.scout.steps[step.id].status).toBe("open");
  });
  it("uses free written gate evidence and confirmed server hint costs only in the new course", () => {
    const { content, privateInput } = storyBDemoV2Input("jnu-demo-dev-mino-current", syntheticStoryAnswers());
    const step = content.stages[0].roles.commander!.steps.at(-1)!;
    expect(step).toMatchObject({ id: "G-01.evidence", type: "record-form", grading: "record", fields: [{ id: "reason", required: true }] });
    expect(privateInput.stages.gate.steps[step.id]).not.toHaveProperty("answer");
    for (const stage of content.stages.slice(0, 2)) expect(stage.scoring).toMatchObject({ hintPenalty: { 1: 0, 2: 10, 3: 10 }, noHintBonus: 0 });
    expect(content.stages[2].completion.type).toBe("tribute");
  });
  it("never appends a phantom blank to a complete sentence preview", () => {
    expect(composeRecordSentence(["", "와 ", "를 기억한다."], ["기록", "질문"], "______")).toBe("기록와 질문를 기억한다.");
    expect(composeRecordSentence(["", " / ", ""], ["", ""], "______")).toBe("______ / ______");
  });
  it("requires the composed sentence, preserves identical draft consent, invalidates changed prose", () => {
    const stage = storyBDemoV2Input("jnu-demo-dev-mino-current").content.stages[3];
    const words = stage.recordTemplate!.wordChoices.slice(0, 3);
    const text = stage.recordTemplate!.sentenceParts!.map((p, i) => p + (words[i] ?? "")).join("");
    const cmd: Command = { action: "draft-joint-record", draft_version: 0, words, text, reason: "합성 근거" };
    expect(() => draftV2({ ...cmd, text: "선택 낱말과 무관한 문장" }, stage)).toThrow();
    const draft = draftV2(cmd, stage); draft.confirms.scout = 1;
    expect(draftV2({ ...cmd, draft_version: 1 }, stage, draft)).toBe(draft);
    expect(draftV2({ ...cmd, draft_version: 1, reason: "수정한 합성 근거" }, stage, draft)).toMatchObject({ version: 2, confirms: {} });
    expect(() => draftV2(cmd, stage, draft)).toThrow();
  });
  it("validates optional sentence fragments without breaking old free-form templates", () => {
    const { content } = storyBDemoV2Input("jnu-demo-dev-mino-current");
    const template = content.stages[3].recordTemplate!;
    template.sentenceParts = ["", "", "", ""];
    expect(() => validateCourseV2Content(content)).not.toThrow();
    template.sentenceParts = ["missing"];
    expect(() => validateCourseV2Content(content)).toThrow();
    delete template.sentenceParts;
    expect(() => validateCourseV2Content(content)).not.toThrow();
  });
});
