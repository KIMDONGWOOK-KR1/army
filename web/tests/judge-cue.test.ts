import { describe, expect, it } from "vitest";
import { judgeCue } from "../lib/judge-cue";

const at = (reverent: boolean, ok: boolean) =>
  ({
    result: { ok },
    current_site: { reverent },
  }) as unknown as Parameters<typeof judgeCue>[1];

describe("판정 소리", () => {
  it("v2 문제 판정과 해설 개방의 응답에 맞는 소리를 낸다", () => {
    const response = (result: Record<string, unknown>) => ({ result, current_site: { reverent: true } }) as Parameters<typeof judgeCue>[1];
    expect(judgeCue({ action: "submit-step" }, response({ accepted: true }))?.name).toBe("clue-correct");
    expect(judgeCue({ action: "submit-step" }, response({ accepted: false }))?.name).toBe("clue-wrong");
    expect(judgeCue({ action: "open-after-explanation" }, response({ opened: true }))).toEqual({ name: "lock-open", calm: true });
  });
  it("추모 거점에서는 맞음·자물쇠 열림도 차분한 소리로 낸다", () => {
    expect(judgeCue({ action: "submit-report" }, at(true, true))).toEqual({
      name: "clue-correct",
      calm: true,
    });
    expect(judgeCue({ action: "open-lock" }, at(true, true))).toEqual({
      name: "lock-open",
      calm: true,
    });
  });
  it("다른 거점에서는 밝은 소리, 틀리면 실패 소리", () => {
    expect(judgeCue({ action: "open-lock" }, at(false, true))).toEqual({
      name: "lock-open",
      calm: false,
    });
    expect(judgeCue({ action: "submit-report" }, at(false, false))).toEqual({
      name: "clue-wrong",
      calm: false,
    });
  });
  it("판정이 없는 명령이나 응답에는 소리를 내지 않는다", () => {
    expect(judgeCue({ action: "ready" }, at(false, true))).toBeNull();
    expect(judgeCue({ action: "open-lock" }, null)).toBeNull();
    expect(
      judgeCue({ action: "open-lock" }, {
        current_site: { reverent: false },
      } as unknown as Parameters<typeof judgeCue>[1]),
    ).toBeNull();
  });
});
