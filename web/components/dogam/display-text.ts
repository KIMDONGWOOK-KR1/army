import { plain } from "@/lib/practice-text";

// 원문·출처는 서버 자료에 보존한다. 플레이 중에는 명시적인 출처 괄호만 덜어 낸다.
// 역사 설명의 괄호·날짜·확인 필요 문구는 그대로 둔다.
export const missionText = (text: string | null | undefined) => plain(text)
  .replace(/[（(]\s*출처\s*[:：][^()（）]*[)）]/g, "")
  .replace(/[ \t]{2,}/g, " ")
  .trim();
