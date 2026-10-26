import type { PhotoMission } from "./contract";

// [합성] 화면 확인용 자료. 실제 조형물·문항·정답이 아니며 운영 코스 시드로 쓰지 않는다.
// 선택지에 정답 표시를 붙이지 않는다(채점은 어댑터가 정한다).
export const scoutPhotoMission: PhotoMission = {
  clue: {
    symbol: "☆",
    label: "[합성] 정찰원의 상징 스티커",
    text: "[합성] 별 하나를 품은 돌이 정문 가까이에서 오가는 사람을 지켜본다. 그 돌을 찾아 사진으로 남겨라.",
  },
  photoStep: {
    id: "G-02-photo",
    guide: "조형물이 화면 가운데 오도록 찍어요. 다른 사람의 얼굴·명찰·차량번호는 담지 않아요.",
  },
  choiceSteps: [
    { id: "G-02-q1", prompt: "[합성] 사진으로 남긴 조형물 가까이에 있는 것은?", choices: ["[합성] 안내판", "[합성] 분수", "[합성] 시계탑"] },
    { id: "G-02-q2", prompt: "[합성] 조형물이 바라보는 방향은?", choices: ["[합성] 정문 쪽", "[합성] 도서관 쪽"] },
  ],
  maxPhotoFailures: 3,
};
