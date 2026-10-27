import type { ScoutPhotoMission } from "./contract";

/** Synthetic UI copy only. No answer, reference photograph, or real-course data. */
export const scoutPhotoMission: ScoutPhotoMission = {
  id: "G-02.preview",
  stageId: "gate",
  role: "scout",
  title: "상징이 가리키는 대상을 찾아라",
  instruction: "개인 단서와 통신원이 전한 말을 함께 살펴라. 현장에서 대상을 찾아 촬영하라.",
  asset: {
    url: null,
    alt: "상징 이미지 준비 중",
    confirmed: false,
  },
  photoStep: {
    id: "G-02.photo",
    prompt: "나는 날개가 없어도 바람의 방향을 이야기한다. 이 상징이 가리키는 대상을 찾아라.",
    maxFailures: 3,
    failurePenalty: {
      value: null,
      confirmed: false,
      note: "TODO(확인필요): D5 사진 검증 실패 감점 확정. 이 mock은 점수를 적용하지 않음",
    },
  },
  choiceSteps: [
    {
      id: "G-02.quiz-1",
      type: "choice",
      title: "대상을 살펴보자",
      prompt: "대상의 이름을 나타내는 항목을 골라라. 실제 문항은 추후 코스 데이터로 교체한다.",
      choices: [
        { value: "1", label: "바람을 담은 모양" },
        { value: "2", label: "빛을 모은 모양" },
        { value: "3", label: "길을 잇는 모양" },
      ],
      confirmed: false,
    },
  ],
};
