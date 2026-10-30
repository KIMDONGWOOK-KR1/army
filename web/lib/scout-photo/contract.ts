/** UI prototype contract; this is not a deployed game action or Snapshot schema. */
/** retake: the verifier skipped judging for quality (dark/blurred). Not counted as a failure. */
export type PhotoOutcome = "match" | "no_match" | "retake" | "service_error";
export type ChoiceOutcome = "accepted" | "rejected";
export type PhotoUnavailableReason =
  | "camera_unavailable"
  | "photography_prohibited";

export type UnconfirmedPhotoSetting = {
  value: null;
  confirmed: false;
  note: string;
};

export type ScoutPhotoMission = {
  id: string;
  stageId: string;
  role: "scout";
  title: string;
  instruction: string;
  asset: { url: string | null; alt: string; confirmed: boolean };
  photoStep: {
    id: string;
    prompt: string;
    maxFailures: 3;
    failurePenalty: UnconfirmedPhotoSetting;
  };
  choiceSteps: Array<{
    id: string;
    type: "choice";
    title: string;
    prompt: string;
    choices: Array<{ value: string; label: string }>;
    confirmed: boolean;
  }>;
};

export type PhotoGateState = {
  photo: {
    status: "pending" | "verified" | "failed_pass";
    failureCount: number;
    verified: boolean;
    completionReason: null | "photo_verified" | "photo_failed_3";
  };
  choiceProgress: Record<string, boolean>;
  completed: boolean;
};

export type PhotoGateErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_CONFLICT"
  | "PHOTO_REQUIRED"
  | "STEP_NOT_FOUND"
  | "STEP_LOCKED"
  | "STEP_COMPLETED"
  | "SERVICE_UNAVAILABLE";

export type PhotoGateResult =
  | { kind: "state" }
  | { kind: "photo_verified" }
  | { kind: "photo_retake" }
  | {
      kind: "photo_retry" | "photo_failed_pass";
      reason: "no_match" | PhotoUnavailableReason;
    }
  | { kind: "choice_accepted" | "choice_rejected"; stepId: string }
  | {
      kind: "error";
      error: { code: PhotoGateErrorCode; message: string; retryable: boolean };
    };

/** server is reserved for a future authenticated adapter, not implemented here. */
export type PhotoGateReply = {
  source: "mock" | "server";
  requestId: string | null;
  state: PhotoGateState;
  result: PhotoGateResult;
};

export type PhotoSubmission = {
  requestId: string;
  stepId: string;
  photo: Blob;
};
export type PhotoUnavailableSubmission = {
  requestId: string;
  stepId: string;
  reason: PhotoUnavailableReason;
};
export type PhotoChoiceSubmission = {
  requestId: string;
  stepId: string;
  answer: string;
};

/** No URL, authentication, HTTP action names, or actual server validation is implied. */
export interface PhotoGateClient {
  getState(): Promise<PhotoGateReply>;
  submitPhoto(input: PhotoSubmission, signal?: AbortSignal): Promise<PhotoGateReply>;
  reportUnavailable(
    input: PhotoUnavailableSubmission,
    signal?: AbortSignal,
  ): Promise<PhotoGateReply>;
  submitChoice(
    input: PhotoChoiceSubmission,
    signal?: AbortSignal,
  ): Promise<PhotoGateReply>;
}

export interface PhotoGateMockClient extends PhotoGateClient {
  setPhotoOutcome(outcome: PhotoOutcome): void;
  setChoiceOutcome(outcome: ChoiceOutcome): void;
}
