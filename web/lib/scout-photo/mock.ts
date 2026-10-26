import type {
  ChoiceOutcome,
  PhotoGateErrorCode,
  PhotoGateMockClient,
  PhotoGateReply,
  PhotoGateResult,
  PhotoGateState,
  PhotoOutcome,
  PhotoUnavailableReason,
  ScoutPhotoMission,
} from "./contract";
import { scoutPhotoMission } from "./fixture";

type Receipt = { fingerprint: string; result: PhotoGateResult };

function abortError(): DOMException {
  return new DOMException("요청을 취소했습니다.", "AbortError");
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) reject(abortError());
      else resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * In-memory, dev/test-only simulation. No fetch, persistence, scoring, or inference.
 * Receipts retain action metadata/results only, never a Blob, filename, image URL,
 * image bytes, or embedding. Photo fingerprints use MIME + size, so this mock does
 * not detect different images with the same metadata; real BE must validate that.
 */
export function createMockPhotoGateClient(options: {
  mission?: ScoutPhotoMission;
  delayMs?: number;
} = {}): PhotoGateMockClient {
  if (process.env.NODE_ENV === "production") {
    throw new Error("사진 검증 mock은 개발 환경에서만 사용할 수 있습니다.");
  }
  const mission = structuredClone(options.mission ?? scoutPhotoMission);
  const ids = [mission.photoStep.id, ...mission.choiceSteps.map((step) => step.id)];
  if (mission.choiceSteps.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error("사진 단계 뒤에는 고유 ID의 객관식 단계가 하나 이상 필요합니다.");
  }
  const delayMs = options.delayMs ?? 500;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("잘못된 mock 대기 시간입니다.");
  const state: PhotoGateState = {
    photo: {
      status: "pending",
      failureCount: 0,
      verified: false,
      completionReason: null,
    },
    choiceProgress: Object.fromEntries(mission.choiceSteps.map((step) => [step.id, false])),
    completed: false,
  };
  let photoOutcome: PhotoOutcome = "no_match";
  let choiceOutcome: ChoiceOutcome = "accepted";
  const receipts = new Map<string, Receipt>();

  const reply = (requestId: string | null, result: PhotoGateResult): PhotoGateReply => ({
    source: "mock",
    requestId,
    state: structuredClone(state),
    result: structuredClone(result),
  });
  const error = (
    code: PhotoGateErrorCode,
    message: string,
    retryable = false,
  ): PhotoGateResult => ({ kind: "error", error: { code, message, retryable } });

  const run = async (
    requestId: string,
    fingerprint: string,
    apply: () => PhotoGateResult,
    signal?: AbortSignal,
  ): Promise<PhotoGateReply> => {
    await wait(delayMs, signal);
    if (!requestId.trim()) {
      return reply(requestId, error("INVALID_REQUEST", "requestId가 필요합니다."));
    }
    const prior = receipts.get(requestId);
    if (prior) {
      return reply(requestId, prior.fingerprint === fingerprint
        ? prior.result
        : error("REQUEST_CONFLICT", "같은 requestId에 다른 요청을 사용할 수 없습니다."));
    }
    // No await between receipt check and mutation: concurrent retries apply once.
    const result = apply();
    // Errors (including simulated service outages) allow a retry with the same ID.
    if (result.kind !== "error") receipts.set(requestId, { fingerprint, result });
    return reply(requestId, result);
  };

  const photoGuard = (stepId: string): PhotoGateResult | undefined => {
    if (stepId !== mission.photoStep.id) return error("STEP_NOT_FOUND", "사진 단계가 아닙니다.");
    if (state.photo.status !== "pending") return error("STEP_COMPLETED", "사진 단계가 이미 완료되었습니다.");
  };

  const failPhoto = (reason: "no_match" | PhotoUnavailableReason): PhotoGateResult => {
    state.photo.failureCount += 1;
    if (state.photo.failureCount >= mission.photoStep.maxFailures) {
      state.photo.status = "failed_pass";
      state.photo.completionReason = "photo_failed_3";
      // verified stays false. Passing this stage never completes the choice steps.
      return { kind: "photo_failed_pass", reason };
    }
    return { kind: "photo_retry", reason };
  };

  return {
    getState: async () => reply(null, { kind: "state" }),
    setPhotoOutcome: (outcome) => { photoOutcome = outcome; },
    setChoiceOutcome: (outcome) => { choiceOutcome = outcome; },
    submitPhoto: (input, signal) => {
      const validPhoto = input.photo instanceof Blob && input.photo.size > 0;
      const fingerprint = JSON.stringify([
        "photo", input.stepId, validPhoto ? input.photo.type : null,
        validPhoto ? input.photo.size : null,
      ]);
      // Only primitives enter the delayed operation; the input Blob is not retained.
      const { requestId, stepId } = input;
      const outcome = photoOutcome;
      return run(requestId, fingerprint, () => {
        const guard = photoGuard(stepId);
        if (guard) return guard;
        if (!validPhoto) return error("PHOTO_REQUIRED", "촬영한 사진을 선택해 주세요.");
        if (outcome === "service_error") {
          return error("SERVICE_UNAVAILABLE", "검증 서비스를 사용할 수 없습니다. 다시 시도해 주세요.", true);
        }
        if (outcome === "no_match") return failPhoto("no_match");
        state.photo.status = "verified";
        state.photo.verified = true;
        state.photo.completionReason = "photo_verified";
        return { kind: "photo_verified" };
      }, signal);
    },
    reportUnavailable: ({ requestId, stepId, reason }, signal) => run(
      requestId,
      JSON.stringify(["unavailable", stepId, reason]),
      () => {
        const guard = photoGuard(stepId);
        if (guard) return guard;
        if (reason !== "camera_unavailable" && reason !== "photography_prohibited") {
          return error("INVALID_REQUEST", "촬영 불가 사유를 선택해 주세요.");
        }
        return failPhoto(reason);
      },
      signal,
    ),
    submitChoice: ({ requestId, stepId, answer }, signal) => {
      const outcome = choiceOutcome;
      return run(requestId, JSON.stringify(["choice", stepId, answer]), () => {
        const index = mission.choiceSteps.findIndex((step) => step.id === stepId);
        if (index < 0) return error("STEP_NOT_FOUND", "객관식 단계가 아닙니다.");
        if (state.photo.status === "pending" || mission.choiceSteps.slice(0, index)
          .some((step) => !state.choiceProgress[step.id])) {
          return error("STEP_LOCKED", "앞 단계를 먼저 완료해 주세요.");
        }
        if (state.choiceProgress[stepId]) return error("STEP_COMPLETED", "이미 완료한 문항입니다.");
        if (!mission.choiceSteps[index].choices.some((choice) => choice.value === answer)) {
          return error("INVALID_REQUEST", "선택지 중 하나를 골라 주세요.");
        }
        // The synthetic fixture contains no correct answer. A dev control decides.
        if (outcome === "rejected") return { kind: "choice_rejected", stepId };
        state.choiceProgress[stepId] = true;
        state.completed = mission.choiceSteps.every((step) => state.choiceProgress[step.id]);
        return { kind: "choice_accepted", stepId };
      }, signal);
    },
  };
}
