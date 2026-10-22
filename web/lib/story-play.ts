import type { Role, Step, StepAnswer } from "@/supabase/functions/_shared/types";

// Presentation only: no correct choices, target values or grading logic.
export const STORY_TOOLS: Record<Role, { name: string; action: string; handoff: string }> = {
  commander: { name: "지휘 보드", action: "흩어진 보고를 하나로", handoff: "동료의 근거를 듣고 기록을 완성하세요." },
  scout: { name: "탐색 수첩", action: "화면 밖에서 단서를 찾아라", handoff: "찾은 이름과 설명의 위치를 말로 전하세요." },
  signal: { name: "통신기", action: "끊어진 정보를 이어라", handoff: "확인한 단서를 동료에게 말로 전하세요." },
  cipher: { name: "해독판", action: "기록의 빈틈을 찾아라", handoff: "무엇을 왜 고쳤는지 지휘관에게 전하세요." },
};
type PlayCopy = { title: string; action: string; tip: string };
const copy: Record<string, PlayCopy> = {
  "G-01.verdict": { title: "보고서에 판정 도장을", action: "판정 보내기", tip: "동료가 확인한 근거로 한 문장씩 판정하세요." },
  "G-01.order": { title: "흩어진 사건을 이어라", action: "시간선 확인", tip: "먼저 일어난 카드부터 골라 올리세요." },
  "G-01.evidence": { title: "그 순서의 근거는?", action: "근거 남기기", tip: "동료의 어떤 보고가 판단을 도왔나요?" },
  "G-02.name": { title: "이름 없는 단서를 찾아라", action: "발견 확인", tip: "통신원의 설명과 현장 안내를 대조하세요." },
  "G-02.shape": { title: "형태를 세어라", action: "관찰 확인", tip: "작품의 꽃잎을 세어 수첩에 남기세요." },
  "G-02.record": { title: "발견을 수첩에", action: "관찰 기록 저장", tip: "눈으로 본 것과 자료로 안 것을 구분하세요." },
  "G-03.freq": { title: "끊어진 신호를 연결하라", action: "신호 연결", tip: "지휘관에게 주파수를 듣고 다이얼을 맞추세요." },
  "G-03.words": { title: "세 낱말을 모아라", action: "낱말 전송", tip: "정찰원이 찾은 작품의 가치를 기록하세요. 순서는 자유입니다." },
  "G-04.spots": { title: "수상한 구절을 표시하라", action: "표시한 구절 대조", tip: "공식 기록과 다른 표현 세 곳을 누르세요." },
  "G-04.time": { title: "시간의 빈칸", action: "시각 대조", tip: "공식 설명에서 집결 시각을 찾으세요. 오전·오후도 함께." },
  "G-04.reason": { title: "모인 이유의 빈칸", action: "이유 대조", tip: "왜 모였는지 확인하고 짧게 적으세요." },
  "G-04.destination": { title: "이동의 빈칸", action: "장소 대조", tip: "충돌 이후 어디로 이동했는지 확인하세요." },
  "G-04.corrections": { title: "고친 흔적을 남겨라", action: "수정 기록 저장", tip: "바꾼 표현과 그 근거를 연결하세요." },
  "Y-01.features": { title: "건물의 특징을 포착하라", action: "관찰 대조", tip: "현재 모습이나 공식 설명과 맞는 특징 두 개를 고르세요." },
  "Y-01.use": { title: "이 건물의 이전 역할은?", action: "용도 대조", tip: "모양만으로 추측하지 말고 공식 설명을 찾으세요." },
  "Y-01.record": { title: "관찰을 증거로", action: "관찰 기록 저장", tip: "확인한 모습과 확인하지 못한 부분을 남기세요." },
  "Y-02.functions": { title: "자료의 쓰임을 연결하라", action: "연결 확인", tip: "각 자료가 무엇을 전하는지 연결하세요." },
  "Y-02.choice": { title: "믿을 수 있는 전달법", action: "전달법 확인", tip: "자료를 전달할 때 지킬 원칙을 고르세요." },
  "Y-02.record": { title: "동료에게 보낼 자료 묶음", action: "자료 묶음 저장", tip: "자료 하나를 고르세요. 없는 정보는 ‘확인 불가’로." },
  "Y-03.sources": { title: "빠진 출처를 찾아라", action: "출처 연결 확인", tip: "각 자료에서 무엇을 더 확인해야 할까요?" },
  "Y-03.verdict": { title: "확신하기 전에 한 번 더", action: "판정 보내기", tip: "자료를 읽는 태도를 한 문장씩 판정하세요." },
  "Y-03.limits": { title: "전달된 기록의 빈틈", action: "검증 기록 저장", tip: "통신원 자료 묶음을 열고 확인 범위를 적으세요." },
  "Y-04.classify": { title: "보고를 세 갈래로", action: "분류 확인", tip: "사실·거짓·근거 부족을 구분하세요." },
  "Y-04.evidence": { title: "판정과 근거를 연결하라", action: "근거 연결 확인", tip: "각 판단을 뒷받침한 자료를 연결하세요." },
  "Y-04.revision": { title: "마지막 보고를 바로잡아라", action: "보고서 저장", tip: "확인한 사실과 남은 질문을 나누세요." },
};
export const playCopy = (step: Step): PlayCopy => copy[step.id] ?? { title: "다음 단서를 찾아라", action: "단서 확인", tip: step.prompt };

/** Completeness only. Correctness is exclusively decided by the server. */
export function hasCompleteDraft(step: Step, answer: StepAnswer) {
  if (step.fields?.length) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
    return step.fields.every((field) => !field.required || !!answer[field.id]?.trim());
  }
  if (step.type === "truefalse" || step.type === "order" || step.type === "words" || step.grading === "set-hash") {
    if (!Array.isArray(answer)) return false;
    const count = step.type === "truefalse" ? step.statements?.length : step.type === "order" ? step.choices?.length : step.answerCount;
    return answer.filter((v) => v.trim()).length === (count ?? answer.length) && answer.length > 0;
  }
  return typeof answer === "string" && !!answer.trim();
}
