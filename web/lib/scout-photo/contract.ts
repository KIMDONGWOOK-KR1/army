// 정찰원 사진 미션(G-02) 화면과 어댑터 사이의 계약 초안.
// 팀원 인계 문서(SCOUT_PHOTO_GATE_HANDOFF, 2026-10-23)를 따른다. 배포된 API 계약에 있는 액션이 아니다.
// 유사도·임계값·임베딩·기준 사진은 화면에 내려오지 않는다.

export type PhotoStatus = "pending" | "verified" | "failed_pass";
export type UnavailableReason = "camera_unavailable" | "photography_prohibited";

export type ChoiceQuestion = { id: string; prompt: string; choices: string[] };

export type PhotoMission = {
  // 정찰원 본인에게만 보이는 상징 단서(합성 placeholder)
  clue: { symbol: string; label: string; text: string };
  photoStep: { id: string; guide: string };
  choiceSteps: ChoiceQuestion[];
  // 실패 몇 번째에 사진 단계만 자동 통과하는지. 미리보기 기본값이며 운영 확정이 아니다.
  maxPhotoFailures: number;
};

export type PhotoGateState = {
  photo: { status: PhotoStatus; failureCount: number; reason?: "photo" | UnavailableReason };
  choiceProgress: Record<string, boolean>;
  completed: boolean;
};

export type PhotoGateResult =
  | { kind: "photo_verified" }
  | { kind: "photo_retry"; failureCount: number }
  | { kind: "photo_failed_pass"; failureCount: number }
  | { kind: "service_error" }
  | { kind: "choice_accepted"; stepId: string }
  | { kind: "choice_rejected"; stepId: string };

export type PhotoGateReply = {
  // "server"는 향후 연결을 위한 예약 값이다. 지금은 항상 "mock"이다.
  source: "mock" | "server";
  requestId: string;
  state: PhotoGateState;
  result: PhotoGateResult;
};

export interface PhotoGateClient {
  getState(): PhotoGateState;
  submitPhoto(input: { requestId: string; stepId: string; photo: Blob }): Promise<PhotoGateReply>;
  reportUnavailable(input: { requestId: string; stepId: string; reason: UnavailableReason }): Promise<PhotoGateReply>;
  // answer는 "1"부터 시작하는 선택 번호 문자열
  submitChoice(input: { requestId: string; stepId: string; answer: string }): Promise<PhotoGateReply>;
}
