import { expect, it } from "vitest";
import { isTributeCompletion } from "../lib/completion-view";

it("uses the completion kind even when display copy changes or conflicts", () => {
  expect(isTributeCompletion({ completion_type: "tribute", label: "[합성] 꽃을 함께 놓았음" })).toBe(true);
  expect(isTributeCompletion({ completion_type: "tribute", completion: "[합성] 추모를 마침" })).toBe(true);
  expect(isTributeCompletion({ completion_type: "confirm", label: "헌화 완료" })).toBe(false);
  expect(isTributeCompletion({ completion_type: "lock", completion: "헌화 완료" })).toBe(false);
});

it("supports old Edge journals and results only when the discriminator is absent", () => {
  expect(isTributeCompletion({ label: "헌화 완료" })).toBe(true);
  expect(isTributeCompletion({ completion: "헌화 완료" })).toBe(true);
  expect(isTributeCompletion({ label: "공동 확인 완료" })).toBe(false);
  expect(isTributeCompletion({ completion: "해설 확인 후 복원" })).toBe(false);
  expect(isTributeCompletion({})).toBe(false);
});
