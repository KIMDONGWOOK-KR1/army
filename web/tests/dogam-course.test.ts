import { describe, expect, it } from "vitest";
import { DOGAM_GATE_STEPS, dogamFullDemoCourseV2, dogamFullDemoV2Input } from "../supabase/functions/_shared/dogam-course-v2";
import { ROLES } from "../supabase/functions/_shared/types";
import { DOGAM_PAGES, dogamPageFor, dogamSlotDone, isDogamStep } from "../lib/dogam";

describe("안 2 현장 도감 시연 코스", () => {
  it("정문만 도감 문항으로 바꾸고 나머지 세 곳은 그대로 둔다", async () => {
    const { content, privateInput } = dogamFullDemoV2Input("jnu-demo-dev-dogam-test");
    expect(content.stages.map((s) => s.id)).toEqual(["gate", "yongbong", "wall", "bongji"]);
    const gate = content.stages[0];
    for (const role of ROLES)
      expect(gate.roles[role]!.steps.map((s) => s.id)).toEqual([...DOGAM_GATE_STEPS[role]]);
    // hh 2026-11-09: 지휘관은 퀴즈 세 문제, 정찰원은 불꽃 찾기 확인, 통신원은 목소리(화면) 뒤 고르기 하나
    expect(gate.roles.commander!.steps.map((s) => s.type)).toEqual(["choice", "order", "choice"]);
    expect(gate.roles.scout!.steps[0]).toMatchObject({ type: "confirm", grading: "confirm" });
    expect(gate.roles.signal!.steps.map((s) => s.type)).toEqual(["choice"]);
    expect(gate.completion).toEqual({ type: "lock", order: [...ROLES] });
    expect(content.stages[1].roles.signal!.steps[0].id).toBe("Y-03.legacy");
    // 정답은 비공개 입력에만 있고 공개 코스에는 없다
    const priv = privateInput.stages.gate;
    expect(priv.roles.commander!.transferClue).toBeUndefined();
    expect(JSON.stringify(gate)).not.toContain("answer");
    for (const role of ROLES) {
      expect(priv.roles[role]!.hints).toHaveLength(3);
      expect(priv.roles[role]!.hints.join(" ")).not.toMatch(/하라|하시오/);
    }
    expect(priv.steps["G-01.dogam-q3"].answer).toEqual(["2", "3", "1"]);
    await expect(dogamFullDemoCourseV2("jnu-demo-dev-dogam-test", crypto.randomUUID())).resolves.toBeTruthy();
  });
});

describe("도감 화면 데이터", () => {
  const page = DOGAM_PAGES.gate;
  const gate = dogamFullDemoV2Input("jnu-demo-dev-dogam-test").content.stages[0];

  it("칸마다 적은 문항 수가 서버 코스와 같고, 도감 문항일 때만 도감 화면을 연다", () => {
    expect(page.slots.map((s) => s.role).sort()).toEqual([...ROLES].sort());
    for (const slot of page.slots) expect(slot.steps).toBe(DOGAM_GATE_STEPS[slot.role].length);
    for (const role of ROLES) expect(dogamPageFor("gate", gate.roles[role]!.steps)).toBe(page);
    expect(dogamPageFor("gate", [{ id: "G-01.legacy" } as never])).toBeNull();
    expect(dogamPageFor("yongbong", gate.roles.scout!.steps)).toBeNull();
    expect(isDogamStep("G-03.dogam-radio")).toBe(true);
    expect(isDogamStep("G-03.dogamx")).toBe(false);
  });

  it("동료 칸은 공개 개수로만 찬다(서버가 전체 수를 안 주면 칸의 문항 수를 쓴다)", () => {
    const commander = page.slots.find((s) => s.role === "commander")!;
    expect(dogamSlotDone({ step_done_count: { commander: 2 } }, commander)).toBe(false);
    expect(dogamSlotDone({ step_done_count: { commander: 3 } }, commander)).toBe(true);
    expect(dogamSlotDone({ step_done_count: { commander: 1 }, step_total_count: { commander: 1 } }, commander)).toBe(true);
    expect(dogamSlotDone({ step_done_count: {} }, commander)).toBe(false);
  });
});
