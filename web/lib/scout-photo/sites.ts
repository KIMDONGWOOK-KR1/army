import type { ScoutPhotoMission } from "./contract";

/**
 * 장소별 정찰원 '사진으로 찾기' 화면 설정(hh 2026-10-27). 화면에 보이는 글과 그림 모양만 둔다.
 * 기준 사진·임베딩·임계값·정답은 여기에 없다(photo-verify의 private/에만 있고 FE로 내려오지 않는다).
 * 찾은 뒤 푸는 짧은 문제는 게임 서버의 정찰원 문제(서버 채점)를 그대로 쓴다.
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
  // 전남대 정문: 5·18 민주항쟁 사적지 표지석(둥근 돌판 가운데 청동 불꽃). hh 사진·영상 2026-10-27 기준.
  // 같은 모양의 불꽃 표지석이 다른 사적지에도 있을 수 있어, 네 사람 모두 정문에 도착한 뒤에만 연다.
  gate: {
    stageId: "gate",
    target: "5·18 민주항쟁 사적지 표지석의 불꽃",
    riddle: "정문 곁 커다란 둥근 돌판에서 꺼지지 않는 불꽃을 찾아요.",
    shape: "flame",
    hints: [
      "불꽃은 청동빛이고 아래에 작은 받침이 있어요. 불꽃을 동그라미에 맞춰 가까이 비추거나, 둥근 돌판 전체를 비춰도 돼요.",
      "정문 가까운 잔디밭에 선 큰 원형 돌 표지석이에요. 앞에 정문 안내판이 놓여 있어요.",
    ],
    found: "찾았어요! 5·18 민주항쟁 사적지 표지석의 불꽃이에요.",
    next: "이제 불꽃 아래 검은 판의 글을 읽고 문제를 풀어요.",
    locked: "표지석을 찾으면, 그 글을 읽고 푸는 짧은 문제가 열려요.",
    confirmed: false,
  },
  // 용봉관: 찍을 대상 미정(hh 2026-10-27). 정해지면 같은 모양으로 더한다.
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
