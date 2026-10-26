import type {
  PhotoGateClient, PhotoGateReply, PhotoGateResult, PhotoGateState, PhotoMission,
} from "./contract";

export type PhotoOutcome = "match" | "no_match" | "service_error";
export type ChoiceOutcome = "accepted" | "rejected";

// 브라우저 메모리에서만 상태를 갖는 모의 어댑터. 사진을 어디로도 보내지 않는다.
// 같은 requestId로 다시 보내면 처음 응답을 돌려준다(응답을 잃은 재전송).
export function createMockPhotoGateClient({ mission, delayMs = 0 }: { mission: PhotoMission; delayMs?: number }) {
  let photoOutcome: PhotoOutcome = "match";
  let choiceOutcome: ChoiceOutcome = "accepted";
  const state: PhotoGateState = {
    photo: { status: "pending", failureCount: 0 },
    choiceProgress: Object.fromEntries(mission.choiceSteps.map((q) => [q.id, false])),
    completed: false,
  };
  const replies = new Map<string, PhotoGateReply>();
  const snapshot = (): PhotoGateState => structuredClone(state);
  const finish = () => {
    state.completed = state.photo.status !== "pending" && Object.values(state.choiceProgress).every(Boolean);
  };
  const reply = async (requestId: string, run: () => PhotoGateResult): Promise<PhotoGateReply> => {
    const seen = replies.get(requestId);
    if (seen) return structuredClone(seen);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const result = run();
    finish();
    const out: PhotoGateReply = { source: "mock", requestId, state: snapshot(), result };
    // 서버 오류는 같은 요청을 다시 시도할 수 있어야 하므로 기억하지 않는다
    if (result.kind !== "service_error") replies.set(requestId, out);
    return structuredClone(out);
  };
  const fail = (reason: "photo" | "camera_unavailable" | "photography_prohibited"): PhotoGateResult => {
    state.photo.failureCount += 1;
    state.photo.reason = reason;
    if (state.photo.failureCount >= mission.maxPhotoFailures) {
      // 자동 통과는 검증 성공이 아니다(verified로 바꾸지 않는다)
      state.photo.status = "failed_pass";
      return { kind: "photo_failed_pass", failureCount: state.photo.failureCount };
    }
    return { kind: "photo_retry", failureCount: state.photo.failureCount };
  };
  const photoOpen = (stepId: string) => stepId === mission.photoStep.id && state.photo.status === "pending";

  const client: PhotoGateClient & {
    setPhotoOutcome(o: PhotoOutcome): void;
    setChoiceOutcome(o: ChoiceOutcome): void;
  } = {
    getState: snapshot,
    setPhotoOutcome: (o) => { photoOutcome = o; },
    setChoiceOutcome: (o) => { choiceOutcome = o; },
    submitPhoto: ({ requestId, stepId }) => reply(requestId, () => {
      if (!photoOpen(stepId)) throw new Error("photo step is not open");
      if (photoOutcome === "service_error") return { kind: "service_error" };
      if (photoOutcome === "match") { state.photo.status = "verified"; return { kind: "photo_verified" }; }
      return fail("photo");
    }),
    reportUnavailable: ({ requestId, stepId, reason }) => reply(requestId, () => {
      if (!photoOpen(stepId)) throw new Error("photo step is not open");
      return fail(reason);
    }),
    submitChoice: ({ requestId, stepId }) => reply(requestId, () => {
      if (state.photo.status === "pending") throw new Error("photo step first");
      if (!(stepId in state.choiceProgress)) throw new Error("unknown step");
      if (choiceOutcome === "rejected") return { kind: "choice_rejected", stepId };
      state.choiceProgress[stepId] = true;
      return { kind: "choice_accepted", stepId };
    }),
  };
  return client;
}
