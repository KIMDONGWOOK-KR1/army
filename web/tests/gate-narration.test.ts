import { describe, expect, it } from "vitest";
import { gateNarrationFrames, nextNarrationFrame, personalMissionBody } from "../lib/gate-narration";
import { ROLES, type RoleMission, type SceneText } from "../supabase/functions/_shared/types";

const scene = (text: string, trigger: SceneText["trigger"] = "enter"): SceneText => ({
  id: `synthetic-${trigger}`, channel: "narration", text, trigger,
});
const mission = (intro = scene("[합성 담당 임무]\n내 안내만 읽는다.")):
  Pick<RoleMission, "intro" | "scenes"> => ({
    intro,
    scenes: [scene("합성 대체 안내"), scene("나중에 열릴 안내", "role-complete")],
  });
const frames = (ownMission: Pick<RoleMission, "intro" | "scenes"> | null = mission()) =>
  gateNarrationFrames({ stageId: "gate", role: "commander", commonLines: ["합성 공통 안내"], mission: ownMission });

describe("정문 본인 나레이션 순서", () => {
  it("공통을 읽은 뒤 개인 안내를 열고 둘 다 읽으면 종료한다", () => {
    const queue = frames();
    const read = new Set<string>();
    const next = () => nextNarrationFrame(queue, (key) => read.has(key));
    expect(next()?.kind).toBe("common");
    read.add(next()!.key);
    expect(next()?.kind).toBe("personal");
    expect(next()?.closeLabel).toBe("임무 시작");
    read.add(next()!.key);
    expect(next()).toBeUndefined();
  });

  it("예전 정문 읽음 기록은 공통 안내만 건너뛰고 새 개인 안내는 남긴다", () => {
    for (const role of ROLES) {
      const queue = gateNarrationFrames({ stageId: "gate", role, commonLines: ["공통"], mission: mission() });
      expect(nextNarrationFrame(queue, (key) => key === "arrive:gate")?.key)
        .toBe(`arrive:gate:personal:${role}`);
      expect(nextNarrationFrame(queue, (key) => key === "arrive:yongbong")?.kind).toBe("common");
    }
  });

  it("본인 intro를 우선하고 다른 이벤트의 안내를 미리 섞지 않는다", () => {
    const personal = frames()[1];
    expect(personal.lines).toEqual(["내 안내만 읽는다."]);
    expect(personal.emphasis).toBeUndefined();
    expect(JSON.stringify(personal)).not.toContain("나중에 열릴 안내");
    expect(JSON.stringify(personal)).not.toContain("합성 대체 안내");
  });

  it("이전 코스의 중복 임무 제목만 없애고 본문의 대괄호 자료는 유지한다", () => {
    expect(personalMissionBody("[합성 담당 임무]\r\n첫 문장.\n[자료 A] 두 번째 문장."))
      .toBe("첫 문장.\n[자료 A] 두 번째 문장.");
    expect(personalMissionBody("[자료 A]\n단서를 확인한다."))
      .toBe("[자료 A]\n단서를 확인한다.");
  });

  it("intro가 비어 있으면 본인 enter 장면만 대체로 사용한다", () => {
    expect(frames(mission(scene(" \n")))[1].lines).toEqual(["합성 대체 안내"]);
    expect(frames(mission(scene("아직 열면 안 되는 intro", "role-complete")))[1].lines)
      .toEqual(["합성 대체 안내"]);
  });

  it("역할별 개인 문구와 읽음 키를 분리한다", () => {
    const keys: string[] = [];
    for (const role of ROLES) {
      const queue = gateNarrationFrames({ stageId: "gate", role, commonLines: ["공통"], mission: mission(scene(`${role} 전용 합성 문구`)) });
      expect(queue[1].lines).toEqual([`${role} 전용 합성 문구`]);
      keys.push(...queue.map((frame) => frame.key));
      for (const other of ROLES.filter((candidate) => candidate !== role))
        expect(JSON.stringify(queue)).not.toContain(`${other} 전용 합성 문구`);
    }
    expect(new Set(keys).size).toBe(ROLES.length * 2);
  });

  it("mission이 아직 없으면 공통만 보이고 나중에 개인 안내를 이어갈 수 있다", () => {
    const readCommon = new Set(frames(null).map((frame) => frame.key));
    expect(frames(null).map((frame) => frame.kind)).toEqual(["common"]);
    expect(nextNarrationFrame(frames(), (key) => readCommon.has(key))?.kind).toBe("personal");
  });

  it("역할이 없거나 본인 enter 문구가 없으면 개인 화면을 만들지 않는다", () => {
    expect(gateNarrationFrames({ stageId: "gate", role: null, commonLines: ["공통"], mission: mission() }))
      .toHaveLength(1);
    expect(frames({ intro: scene(""), scenes: [scene("완료 안내", "stage-complete")] }))
      .toHaveLength(1);
  });

  it("공통 문구가 없는 코스도 빈 화면 없이 개인 안내를 표시한다", () => {
    const queue = gateNarrationFrames({ stageId: "gate", role: "scout", commonLines: ["\n "], mission: mission() });
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("personal");
  });
});
