// 코스 파일의 연습용 글은 맨 앞에 "[합성] "이 붙어 있다(실제 문항이 정해지기 전 자리 표시).
// 코스 파일과 서버 값은 그대로 두고, 화면에 보일 때만 앞머리를 지운다.
// 거점 제목 옆에는 '연습 문항' 표시를 하나만 단다(isPracticeStage).
const MARK = /^\s*\[합성\]\s*/;

export const plain = (text: string | null | undefined): string =>
  (text ?? "").replace(MARK, "");

/** 지금 거점(공개된 단계·내 미션)에 연습용 글이 하나라도 있는가 */
export const isPracticeStage = (value: unknown): boolean =>
  JSON.stringify(value ?? null).includes("[합성]");
