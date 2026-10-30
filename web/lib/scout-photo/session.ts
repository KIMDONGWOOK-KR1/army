import type { PhotoGateMockClient, PhotoGateState, PhotoOutcome } from "./contract";
import { judgeWithLocalVerifier, localVerifyEnabled } from "./local-verify";
import { createMockPhotoGateClient } from "./mock";
import { scanMission, type ScoutScanSite } from "./sites";

/**
 * 게임 화면의 '사진으로 찾기'는 아직 정식 판정 서버와 이어지지 않아 PR #17의 모의 판정기를 쓴다(개발 서버에서만).
 * NEXT_PUBLIC_PHOTO_VERIFY=local이면 같은 판정기 틀에 로컬 사진 판정 서버의 실제 판정을 넣는다(real: true).
 * 방·장소마다 판정기를 하나씩 두어, 혼자 데모 체험에서 보직을 바꿨다 돌아와도 실패 횟수와 결과가 남는다.
 * 사진은 판정에만 쓰고 어디에도 남기지 않는다.
 */
type Session = { client: PhotoGateMockClient; state: PhotoGateState | null; outcome: PhotoOutcome; real: boolean };
const sessions = new Map<string, Session>();

export const scanEnabled = () => process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_BACKEND !== "supabase";

export function scanSession(key: string, site: ScoutScanSite): Session {
  let session = sessions.get(key);
  if (!session) {
    const real = localVerifyEnabled();
    session = {
      client: createMockPhotoGateClient({
        mission: scanMission(site),
        delayMs: real ? 0 : 1100,
        judge: real ? (photo, _stepId, signal) => judgeWithLocalVerifier(site.stageId, photo, signal) : undefined,
      }),
      state: null,
      outcome: "match",
      real,
    };
    session.client.setPhotoOutcome(session.outcome);
    sessions.set(key, session);
  }
  return session;
}

/** 지난 판정 결과(없으면 아직 찾는 중) */
export const scanState = (key: string) => sessions.get(key)?.state ?? null;
