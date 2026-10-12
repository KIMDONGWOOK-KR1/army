import { describe, expect, it } from "vitest";
import { isPracticeStage, plain } from "../lib/practice-text";

describe("연습용 글 화면 표시", () => {
  it("맨 앞 [합성]만 지우고 보직 영문 이름을 한글로", () => {
    expect(plain("[합성] commander 자료 조사 연습")).toBe("지휘관 자료 조사 연습");
    expect(plain("[합성] 낱말 세 개를 골라라")).toBe("낱말 세 개를 골라라");
  });
  it("연습용이 아닌 글은 그대로", () => {
    expect(plain("scout 기록")).toBe("scout 기록");
    expect(plain(undefined)).toBe("");
  });
  it("연습용 글이 있는 거점만 '연습 문항'", () => {
    expect(isPracticeStage({ steps: [{ prompt: "[합성] 문제" }] })).toBe(true);
    expect(isPracticeStage({ steps: [{ prompt: "국화 한 송이를 올려 추모한다." }] })).toBe(false);
  });
});
