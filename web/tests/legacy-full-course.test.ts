import { describe, expect, it } from "vitest";
import { legacyFullDemoCourseV2, legacyFullDemoV2Input } from "../supabase/functions/_shared/legacy-full-course-v2";

describe("용봉관 v1 문항 전체 코스", () => {
  it("정문 → 용봉관(v1) → 추모의 벽 → 봉지", async () => {
    const { content, privateInput } = legacyFullDemoV2Input("jnu-demo-dev-legacy-test");
    expect(content.stages.map((s) => s.id)).toEqual(["gate", "yongbong", "wall", "bongji"]);
    const yb = content.stages[1];
    expect(yb.roles.signal!.steps[0]).toMatchObject({ id: "Y-03.legacy", type: "frequency" });
    expect(yb.roles.cipher!.steps[0].choices).toContain("鳳");
    expect(yb.altModes).toBeUndefined();
    expect(privateInput.stages.yongbong.roles.commander?.transferClue?.value).toBe("19.9");
    // 공개 단계에는 [합성]·정답이 없다
    expect(JSON.stringify(yb)).not.toContain("[합성]");
    expect(JSON.stringify(content.sources)).not.toContain("[합성]");
    expect(JSON.stringify(yb)).not.toContain("19.9");
    await expect(legacyFullDemoCourseV2("jnu-demo-dev-legacy-test", "s".repeat(40))).resolves.toBeTruthy();
  });
});
