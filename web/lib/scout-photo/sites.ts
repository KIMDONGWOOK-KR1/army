import type { ScoutPhotoMission } from "./contract";

/**
 * 로컬 사진 시연 전용 합성 문구. 실제 대상·위치·개인 단서는 포함하지 않는다.
 * 기준 사진·임베딩·임계값과 실제 판정 서버는 아직 연결하지 않는다.
 * 사진 시연 뒤에는 현재 코스의 서버 문제를 표시하며, 문제 유형과 채점은 변경하지 않는다.
 */
export type ScoutScanSite = {
  stageId: string;
  /** 찾은 뒤에 알려 주는 대상 이름 */
  target: string;
  /** 처음 단서: 수수께끼 한 줄 */
  riddle: string;
  /** 실루엣·조준 틀 모양 */
  shape: "flame";
  /** 1번 틀리면(실루엣이 선명해진다), 2번 틀리면(위치) 보여 주는 힌트 */
  hints: [string, string];
  /** 찾았을 때 한 줄 */
  found: string;
  /** 찾은 뒤 문제로 넘어가는 한 줄 */
  next: string;
  /** 찾기 전, 잠긴 문제 자리에 두는 한 줄 */
  locked: string;
  /** 현장에서 확인한 문구인가. 위치 힌트는 답사로 다시 확인한다 */
  confirmed: boolean;
};

export const SCOUT_SCAN_SITES: Record<string, ScoutScanSite> = {
  // 실제 장소와 무관한 합성 예시. 로컬에서 사용자가 시연을 선택한 경우에만 연결한다.
  gate: {
    stageId: "gate",
    target: "시연용 불꽃 모형",
    riddle: "바람에도 꺼지지 않는 불꽃 모양을 찾아요. 사진 화면을 시험하는 합성 단서예요.",
    shape: "flame",
    hints: [
      "시연 그림의 불꽃 모양을 동그라미 안에 맞춰 보세요. 실제 대상을 판별하지는 않아요.",
      "아래 시연 판정에서 성공 또는 실패를 선택해 다음 화면을 확인할 수 있어요.",
    ],
    found: "사진 시연을 통과했어요. 실제 현장 검증 결과는 아니에요.",
    next: "이제 현재 코스의 정찰원 문제로 이어져요.",
    locked: "사진 시연을 마치면 현재 코스의 정찰원 문제가 열려요.",
    confirmed: false,
  },
  // 다른 거점은 사진 대상과 계약이 정해진 뒤 별도로 연결한다.
};

/** PR #17 모의 판정기에 넘길 사진 단계. 뒤 문제는 게임 서버가 채점하므로 자리만 채운다(정답 없음). */
export function scanMission(site: ScoutScanSite): ScoutPhotoMission {
  return {
    id: `${site.stageId}.scan`,
    stageId: site.stageId,
    role: "scout",
    title: site.riddle,
    instruction: site.hints[0],
    asset: { url: null, alt: "불꽃 실루엣", confirmed: false },
    photoStep: {
      id: `${site.stageId}.scan.photo`,
      prompt: site.riddle,
      maxFailures: 3,
      failurePenalty: { value: null, confirmed: false, note: "TODO(확인필요): 사진 실패 감점 미확정. 점수는 바꾸지 않음" },
    },
    choiceSteps: [{
      id: `${site.stageId}.scan.server-question`,
      type: "choice",
      title: "게임 서버 문제",
      prompt: "사진 뒤 문제는 게임 서버의 정찰원 문제를 쓴다(이 판정기로 채점하지 않는다).",
      choices: [{ value: "1", label: "서버 문제" }],
      confirmed: false,
    }],
  };
}
