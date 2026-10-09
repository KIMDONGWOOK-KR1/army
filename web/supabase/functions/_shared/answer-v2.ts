import type { Step, StepAnswer } from "./types.ts";

function invalid(): never {
  throw new Error("v2 답안 형식 또는 선택 번호가 유효하지 않다.");
}
export function normalizeTextV2(value: unknown, maxLen = 300): string {
  if (typeof value !== "string") return invalid();
  const result = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!result || [...result].length > maxLen) return invalid();
  return result;
}
function plainMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** Frozen v2 wire format: strings, arrays, and sorted [key,value] pairs as JSON. */
export function serializeAnswerV2(step: Step, answer: unknown): string {
  const scalar = (v: unknown) => normalizeTextV2(v, step.maxLen ?? 300);
  const text = (v: unknown) => {
    let s = scalar(v);
    // Opt-in applies only to hashed text/words, never choices, frequency or records.
    if (["text", "observation", "words"].includes(step.type)) {
      if (step.normalize?.caseInsensitive) s = s.toLowerCase();
      if (step.normalize?.ignoreSpaces) s = s.replace(/\s/gu, "");
    }
    return s;
  };
  const choice = (v: unknown) => {
    const s = scalar(v);
    if (!/^[1-9]\d*$/.test(s) || Number(s) > (step.choices?.length ?? 0)) {
      return invalid();
    }
    return s;
  };
  const list = (fn: (v: unknown) => string) => {
    if (!Array.isArray(answer) || !answer.length || answer.length > 100) {
      return invalid();
    }
    if (step.answerCount !== undefined && answer.length !== step.answerCount) {
      return invalid();
    }
    return answer.map(fn);
  };
  if (step.grading === "hash") {
    if (step.type === "frequency") {
      const s = scalar(answer);
      // A game dial, not a real radio band. Do not round a wrong answer into a right one.
      if (!/^\d{1,3}(?:\.\d)?$/.test(s)) return invalid();
      return JSON.stringify(Number(s).toFixed(1));
    }
    if (step.type === "truefalse") {
      const values = list(scalar);
      if (
        values.length !== step.statements?.length ||
        values.some((v) => v !== "true" && v !== "false")
      ) return invalid();
      return JSON.stringify(values);
    }
    return JSON.stringify(
      step.type === "choice" ? choice(answer) : text(answer),
    );
  }
  if (step.grading === "set-hash" || step.grading === "order-hash") {
    const values = list(step.choices ? choice : text);
    // A repeated selection/word is not silently discarded.
    if (new Set(values).size !== values.length) return invalid();
    if (
      step.grading === "order-hash" && values.length !== step.choices?.length
    ) return invalid();
    return JSON.stringify(step.grading === "set-hash" ? values.sort() : values);
  }
  if (step.grading === "map-hash") {
    if (!plainMap(answer)) return invalid();
    const keys = (step.fields ?? []).map((f) => f.id).sort();
    if (
      !keys.length ||
      JSON.stringify(Object.keys(answer).sort()) !== JSON.stringify(keys)
    ) return invalid();
    const pairs = keys.map((k) => [k, choice(answer[k])]);
    // Classification may assign multiple statements to the same category. Match stays 1:1.
    if (step.type !== "classification" && new Set(pairs.map((p) => p[1])).size !== pairs.length) return invalid();
    return JSON.stringify(pairs);
  }
  throw new Error("정답 해시 채점 단계가 아니다.");
}

export async function answerHashV2(
  salt: string,
  courseId: string,
  step: Step,
  answer: StepAnswer,
): Promise<string> {
  if (salt.length < 32) throw new Error("ANSWER_SALT는 32자 이상이어야 한다.");
  const bytes = new TextEncoder().encode(
    salt + courseId + step.id + serializeAnswerV2(step, answer),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
