import type { PhotoGateMockClient, PhotoGateState, PhotoOutcome } from "./contract";
import { createMockPhotoGateClient } from "./mock";
import { scanMission, type ScoutScanSite } from "./sites";

/**
 * 게임 화면의 '사진으로 찾기'는 아직 판정 서버와 이어지지 않아 PR #17의 모의 판정기를 쓴다(개발 서버에서만).
 * 방·장소마다 판정기를 하나씩 두어, 혼자 데모 체험에서 보직을 바꿨다 돌아와도 실패 횟수와 결과가 남는다.
 * 사진은 판정기에 넘긴 뒤 어디에도 남기지 않는다(판정기도 크기·형식만 본다).
 */
type Session = { client: PhotoGateMockClient; state: PhotoGateState | null; outcome: PhotoOutcome };
const sessions = new Map<string, Session>();

export const scanEnabled = () => process.env.NODE_ENV !== "production";

export function scanSession(key: string, site: ScoutScanSite): Session {
  let session = sessions.get(key);
  if (!session) {
    session = {
      client: createMockPhotoGateClient({ mission: scanMission(site), delayMs: 1100 }),
      state: null,
      outcome: "match",
    };
    session.client.setPhotoOutcome(session.outcome);
    sessions.set(key, session);
  }
  return session;
}

/** 지난 판정 결과(없으면 아직 찾는 중) */
export const scanState = (key: string) => sessions.get(key)?.state ?? null;
