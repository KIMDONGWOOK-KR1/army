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
    expect(content.sources.some((source) => source.id === "MOCK-Y")).toBe(false);
    expect(JSON.stringify(yb)).not.toContain("19.9");
    expect(yb.sacho).toMatchObject({ char: "層", name: "겹친 시간의 사초" });
    // 힌트 3단계·해설에 정답 값이 없다(정답은 서버 비공개 입력에만)
    const priv = privateInput.stages.yongbong;
    const said = (role: "commander" | "scout" | "signal" | "cipher") =>
      [...priv.roles[role]!.hints, ...Object.values(priv.steps).map((s) => s.explanation ?? "")].join(" ");
    for (const role of ["commander", "scout", "signal", "cipher"] as const) {
      expect(priv.roles[role]!.hints).toHaveLength(3);
      expect(said(role)).not.toContain("19.9");
      expect(said(role)).not.toContain("鳳");
      expect(said(role)).not.toContain("대학의 역사와 오월의 기록");
    }
    expect(priv.roles.scout!.hints.join(" ")).not.toContain("용봉관");
    expect(JSON.stringify(yb.roles.commander!.scenes)).not.toContain("대학의 역사와 오월의 기록");
    await expect(legacyFullDemoCourseV2("jnu-demo-dev-legacy-test", crypto.randomUUID())).resolves.toBeTruthy();
  });
});
