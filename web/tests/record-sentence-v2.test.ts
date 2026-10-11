import { describe, expect, it } from "vitest";
import { draftV2 } from "../supabase/functions/_shared/closing-v2";
import { validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { projectPublicStageV2 } from "../supabase/functions/_shared/project-course-v2";
import { fullDemoCourseV2, fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { ROLES, type Command } from "../supabase/functions/_shared/types";
import { fullTeam } from "./helpers/full-v2";

// These sentences are synthetic authoring fixtures, never source scenario prose.
const parts = ["[합성] ", "와 ", "를 살피고 ", "를 남긴다."];
const words = ["구름", "바람", "질문"];
const sentence = "[합성] 구름와 바람를 살피고 질문를 남긴다.";
function fixture() {
  const { content } = fullDemoV2Input("jnu-demo-dev-sentence-test", "confirm");
  const stage = content.stages.find((stage) => stage.id === "wall")!;
  stage.recordTemplate = { prompt: "[합성] 세 낱말을 고르라.", wordChoices: [...words], wordCount: 3, sentenceParts: [...parts] };
  const command: Command = { action: "draft-memorial-record", draft_version: 0, words: [...words], text: sentence, reason: "[합성] 선택 근거" };
  return { content, stage, command };
}

describe("optional fixed record sentences", () => {
  it("validates and projects only an explicitly provided template without sharing arrays", async () => {
    const { content, stage } = fixture();
    expect(validateCourseV2Content(content).stages.find((s) => s.id === "wall")?.recordTemplate?.sentenceParts).toEqual(parts);
    const course = await fullDemoCourseV2(content.id, crypto.randomUUID(), false, "confirm");
    expect(projectPublicStageV2(course, "wall").recordTemplate).not.toHaveProperty("sentenceParts");
    course.stages.find((s) => s.id === "wall")!.recordTemplate = stage.recordTemplate;
    const projected = projectPublicStageV2(course, "wall");
    expect(projected.recordTemplate?.sentenceParts).toEqual(parts);
    projected.recordTemplate!.sentenceParts![0] = "[합성] 외부 변경";
    expect(stage.recordTemplate!.sentenceParts).toEqual(parts);
  });

  it.each([null, undefined, "not-an-array", {}, [], ["", ""], ["", "", "", 1], ["", "", "", null], Array(4)])(
    "rejects malformed sentence parts %#", (value) => {
      const { content, stage } = fixture();
      Object.assign(stage.recordTemplate!, { sentenceParts: value });
      expect(() => validateCourseV2Content(content)).toThrow();
    },
  );

  it("allows empty first and last pieces, mixed selections and repeated words", () => {
    const { content, stage, command } = fixture();
    stage.recordTemplate!.sentenceParts = ["", " / ", " / ", ""];
    expect(() => validateCourseV2Content(content)).not.toThrow();
    expect(draftV2({ ...command, words: ["질문", "구름", "질문"], text: "질문 / 구름 / 질문" }, stage)).toMatchObject({
      version: 1, text: "질문 / 구름 / 질문", words: ["질문", "구름", "질문"], confirms: {},
    });
  });

  it("bounds the complete sentence including the longest choice repeated in every blank", () => {
    const { content, stage } = fixture();
    stage.recordTemplate!.wordChoices = ["가", "😀"];
    stage.recordTemplate!.sentenceParts = ["가".repeat(597), "", "", ""];
    expect(() => validateCourseV2Content(content)).not.toThrow();
    stage.recordTemplate!.sentenceParts[0] += "가";
    expect(() => validateCourseV2Content(content)).toThrow("600자");
    stage.recordTemplate!.sentenceParts[0] = "가".repeat(595);
    stage.recordTemplate!.wordChoices.push("가나");
    expect(() => validateCourseV2Content(content)).toThrow("600자");
  });

  it("compares server-normalized NFC and whitespace and preserves unchanged consent", () => {
    const { stage, command } = fixture();
    stage.recordTemplate!.wordChoices = ["가", "나", "다"];
    stage.recordTemplate!.sentenceParts = ["", "\n", "\t", "  "];
    const draft = draftV2({ ...command, words: ["가", "나", "다"], text: " 가  나\n다 " }, stage);
    expect(draft.text).toBe("가 나 다");
    draft.confirms.scout = 123;
    expect(draftV2({ ...command, draft_version: 1, words: draft.words, text: "가\t나 다" }, stage, draft)).toBe(draft);
  });

  it("rejects seed sentences that exceed 600 after NFC expansion, including fragment boundaries", () => {
    const { content, stage } = fixture();
    stage.recordTemplate!.wordChoices = ["\u0344".repeat(200)];
    stage.recordTemplate!.sentenceParts = ["", "", "", ""];
    expect(() => validateCourseV2Content(content)).toThrow("600자");
    // NFC of each fragment has two characters total, but the joined result has three.
    // The ogonek changes which marks compose with the U in U-diaeresis-macron.
    const prefix = "가".repeat(598);
    stage.recordTemplate!.wordCount = 1;
    stage.recordTemplate!.wordChoices = ["\u0328"];
    stage.recordTemplate!.sentenceParts = [`${prefix}\u01d5`, ""];
    expect([...`${prefix}\u01d5\u0328`.normalize("NFC")]).toHaveLength(601);
    expect(() => validateCourseV2Content(content)).toThrow("600자");
  });

  it("enforces the server's 600-character boundary using Unicode characters", () => {
    const { stage, command } = fixture();
    const word = "😀".repeat(200);
    stage.recordTemplate!.wordChoices = [word];
    stage.recordTemplate!.sentenceParts = ["", "", "", ""];
    const draftCommand = { ...command, words: [word, word, word], text: word.repeat(3) };
    expect(draftV2(draftCommand, stage).text).toBe(draftCommand.text);
    stage.recordTemplate!.sentenceParts[3] = "가";
    expect(() => draftV2({ ...draftCommand, text: `${draftCommand.text}가` }, stage)).toThrow(expect.objectContaining({ code: "BAD_RECORD" }));
  });

  it("rejects tampered or reordered text, unknown words and overlong output without mutating a draft", () => {
    const { stage, command } = fixture();
    const draft = draftV2(command, stage);
    draft.confirms.scout = 123;
    const before = structuredClone(draft);
    for (const extra of [{ text: "[합성] 임의 문장" }, { words: ["바람", "구름", "질문"] }, { words: ["없는 낱말", "바람", "질문"] }]) {
      expect(() => draftV2({ ...command, draft_version: 1, ...extra }, stage, draft)).toThrow(expect.objectContaining({ code: "BAD_RECORD" }));
      expect(draft).toEqual(before);
    }
    stage.recordTemplate!.sentenceParts![0] = "가".repeat(601);
    expect(() => draftV2({ ...command, draft_version: 1 }, stage, draft)).toThrow(expect.objectContaining({ code: "BAD_RECORD" }));
  });

  it("keeps free-form prose and duplicate choices unchanged when sentenceParts is absent", () => {
    const { stage, command } = fixture();
    delete stage.recordTemplate!.sentenceParts;
    const draft = draftV2({ ...command, words: ["질문", "질문", "바람"], text: "[합성] 별도로 쓴 자유 문장" }, stage);
    expect(draft.text).toBe("[합성] 별도로 쓴 자유 문장");
    expect(draft.words).toEqual(["질문", "질문", "바람"]);
  });

  it("preserves receipts, stale-version rejection, renewed consent and separate wall/Bongji drafts", async () => {
    const t = await fullTeam(); await t.arrive(); await t.wallReady();
    for (const stage of t.course.stages.filter((s) => s.recordTemplate)) stage.recordTemplate = fixture().stage.recordTemplate;
    const command = { ...fixture().command, request_id: "fixed-draft-once" };
    await t.call("commander", command);
    const version = t.game.version, count = t.events.length;
    await t.call("commander", command);
    expect(t.game.version).toBe(version); expect(t.events).toHaveLength(count);
    await expect(t.call("commander", { ...command, reason: "[합성] 다른 근거" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await t.call("scout", { action: "confirm-stage", draft_version: 1 });
    const before = structuredClone(t.game);
    await expect(t.call("commander", { ...command, request_id: "new-stale-write" })).rejects.toMatchObject({ code: "STALE_DRAFT" });
    expect(t.game).toEqual(before);
    await t.call("commander", { ...command, draft_version: 1, request_id: "fixed-draft-edit", reason: "[합성] 수정 근거" });
    expect(t.view("cipher").self.memorial_record).toMatchObject({ draft_version: 2, text: sentence, confirm_mask: [false, false, false, false] });
    await expect(t.call("scout", { action: "confirm-stage", draft_version: 1 })).rejects.toMatchObject({ code: "STALE_DRAFT" });
    for (const role of ROLES) await t.call(role, { action: "confirm-stage", draft_version: 2 });
    await t.depart(); await t.arrive();
    expect(t.view("commander").self.joint_record).toBeNull();
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `[합성] ${role} 회고` });
    await t.call("commander", { ...fixture().command, action: "draft-joint-record" });
    await t.call("scout", { action: "consent-joint-record", draft_version: 1 });
    await t.call("scout", { action: "submit-retro", text: "[합성] 다시 쓴 회고" });
    expect(t.view("commander").self.joint_record).toMatchObject({ draft_version: 2, text: sentence, confirm_mask: [false, false, false, false] });
    expect(t.game.v2!.memorialRecords!.wall.version).toBe(2);
    expect(Object.keys(t.game.v2!.memorialRecords!.wall.confirms)).toHaveLength(4);
    for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 2 });
    expect(t.game.status).toBe("done");
    expect(JSON.stringify(t.events)).not.toContain(sentence);
  });
});
