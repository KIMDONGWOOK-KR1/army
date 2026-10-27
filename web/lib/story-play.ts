import type { Role, Step, StepAnswer, StepType } from "@/supabase/functions/_shared/types";

// Presentation only. Questions, choices, records and judgements come from the server.
export const STORY_TOOLS: Record<Role, { name: string; handoff: string }> = {
  commander: { name: "지휘 보드", handoff: "동료의 근거를 듣고 기록을 완성하세요." },
  scout: { name: "탐색 수첩", handoff: "관찰한 내용을 동료에게 말로 전하세요." },
  signal: { name: "통신기", handoff: "확인한 단서를 동료에게 말로 전하세요." },
  cipher: { name: "해독판", handoff: "수정한 내용과 그 근거를 지휘관에게 전하세요." },
};

const inputCopy: Record<StepType, { title: string; action: string }> = {
  truefalse: { title: "보고에 판정 도장을", action: "판정 보내기" },
  order: { title: "흩어진 사건을 이어라", action: "시간선 확인" },
  match: { title: "자료와 근거를 연결하라", action: "연결 확인" },
  classification: { title: "보고를 분류하라", action: "분류 확인" },
  choice: { title: "단서를 대조하라", action: "선택 확인" },
  "multi-choice": { title: "해당하는 단서를 모아라", action: "선택 확인" },
  frequency: { title: "끊어진 신호를 연결하라", action: "신호 연결" },
  words: { title: "낱말을 모아라", action: "낱말 전송" },
  "spot-correct": { title: "기록의 빈틈을 바로잡아라", action: "수정 기록 확인" },
  text: { title: "판단의 근거를 남겨라", action: "기록 저장" },
  observation: { title: "현장의 단서를 찾아라", action: "관찰 확인" },
  "record-form": { title: "발견을 수첩에", action: "기록 저장" },
  "fill-blank": { title: "기록의 빈칸을 채워라", action: "기록 확인" },
  confirm: { title: "함께 확인한 기록", action: "내용 확인" },
};

export const playCopy = (step: Step) => ({ ...inputCopy[step.type], tip: step.prompt });

/** Gate routing depends on the active server mission, never the course's name or ID. */
export function usesGateStory(stageId: string, steps: readonly Step[]) {
  return stageId === "gate" && steps.length > 0 &&
    steps.every((step) => !step.id.endsWith(".legacy") && step.type in inputCopy);
}

/** Completeness and input shape only. Correctness is exclusively decided by the server. */
export function hasCompleteDraft(step: Step, answer: StepAnswer) {
  if (step.grading === "map-hash") {
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return false;
    const fields = step.fields ?? [];
    if (!fields.length || Object.keys(answer).length !== fields.length) return false;
    const choices = fields.map((field) => answer[field.id]);
    if (choices.some((value) => typeof value !== "string" ||
      !/^[1-9]\d*$/.test(value.trim()) || Number(value) > (step.choices?.length ?? 0))) return false;
    return step.type === "classification" || new Set(choices.map((value) => value.trim())).size === fields.length;
  }
  if (step.fields?.length) {
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return false;
    return step.fields.every((field) => !field.required || !!answer[field.id]?.trim());
  }
  if (step.type === "truefalse" || step.type === "order" || step.type === "words" || step.grading === "set-hash") {
    if (!Array.isArray(answer) || answer.length === 0 || answer.some((value) => !value.trim())) return false;
    const count = step.type === "truefalse" ? step.statements?.length
      : step.type === "order" ? step.choices?.length : step.answerCount;
    if (count !== undefined && answer.length !== count) return false;
    if ((step.type === "order" || step.grading === "set-hash") && step.choices?.length) {
      return new Set(answer).size === answer.length &&
        answer.every((id) => /^[1-9]\d*$/.test(id) && Number(id) <= step.choices!.length);
    }
    return true;
  }
  return typeof answer === "string" && !!answer.trim();
}

/** Selecting an occupied match swaps connections so a complete draft stays editable. */
export function connectChoice(step: Step, record: Record<string, string>, fieldId: string, choiceId: string) {
  const next = { ...record };
  if (next[fieldId] === choiceId) {
    delete next[fieldId];
    return next;
  }
  if (step.type === "match") {
    const previous = next[fieldId];
    const other = Object.keys(next).find((key) => key !== fieldId && next[key] === choiceId);
    if (other) {
      if (previous) next[other] = previous;
      else delete next[other];
    }
  }
  next[fieldId] = choiceId;
  return next;
}
