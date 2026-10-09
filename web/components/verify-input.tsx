"use client";

import type { Step, StepAnswer } from "@/supabase/functions/_shared/types";

export function emptyStepAnswer(step: Step): StepAnswer {
  if (step.type === "truefalse") return (step.statements ?? []).map(() => "");
  if (step.type === "order") return (step.choices ?? []).map(() => "");
  if (step.type === "words" && !step.choices) {
    return Array.from({ length: step.answerCount ?? 1 }, () => "");
  }
  if (step.grading === "set-hash") return [];
  if (step.fields?.length) return {};
  return "";
}

export function VerifyInput({
  step,
  value,
  onChange,
}: {
  step: Step;
  value: StepAnswer;
  onChange: (value: StepAnswer) => void;
}) {
  const values = Array.isArray(value) ? value : [];
  const record = typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const text = typeof value === "string" ? value : "";
  const choices = step.choices ?? [];
  const replaceAt = (index: number, next: string) => {
    const changed = [...values];
    changed[index] = next;
    onChange(changed);
  };

  if (step.type === "truefalse") {
    return (step.statements ?? []).map((statement, index) => (
      <label className="verify-field" key={index}>
        <span>{index + 1}. {statement}</span>
        <select
          aria-label={`${index + 1}. ${statement}`}
          required
          value={values[index] ?? ""}
          onChange={(event) =>
            replaceAt(index, event.target.value)}
        >
          <option value="">참 / 거짓 선택</option>
          <option value="true">참</option>
          <option value="false">거짓</option>
        </select>
      </label>
    ));
  }

  if (step.type === "order") {
    return (
      <div className="verify-stack">
        <p>각 순서에 들어갈 항목을 하나씩 선택하세요.</p>
        {choices.map((_, index) => (
          <label className="verify-field" key={index}>
            <span>{index + 1}번째 항목</span>
            <select
              aria-label={`${index + 1}번째 항목`}
              required
              value={values[index] ?? ""}
              onChange={(event) => replaceAt(index, event.target.value)}
            >
              <option value="">선택</option>
              {choices.map((choice, choiceIndex) => {
                const id = String(choiceIndex + 1);
                return (
                  <option
                    key={id}
                    value={id}
                    disabled={values.some((v, i) => i !== index && v === id)}
                  >
                    {choiceIndex + 1}. {choice}
                  </option>
                );
              })}
            </select>
          </label>
        ))}
      </div>
    );
  }

  if (step.type === "match") {
    return (step.fields ?? []).map((field) => (
      <label className="verify-field" key={field.id}>
        <span>{field.label}</span>
        <select
          aria-label={field.label}
          required
          value={record[field.id] ?? ""}
          onChange={(event) =>
            onChange({ ...record, [field.id]: event.target.value })}
        >
          <option value="">연결 항목 선택</option>
          {choices.map((choice, index) => {
            const id = String(index + 1);
            return (
              <option
                key={id}
                value={id}
                disabled={Object.entries(record).some(([key, v]) =>
                  key !== field.id && v === id
                )}
              >
                {index + 1}. {choice}
              </option>
            );
          })}
        </select>
      </label>
    ));
  }

  if (step.type === "choice") {
    return (
      <label className="verify-field">
        <span>선택 항목</span>
        <select
          aria-label="선택 항목"
          required
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">선택</option>
          {choices.map((choice, index) => (
            <option key={index} value={String(index + 1)}>
              {index + 1}. {choice}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (step.grading === "set-hash" && choices.length) {
    return (
      <div className="verify-stack">
        <p>
          {step.answerCount
            ? `${step.answerCount}개 항목을 선택하세요.`
            : "해당하는 항목을 선택하세요."}
        </p>
        {choices.map((choice, index) => {
          const id = String(index + 1);
          return (
            <label key={id}>
              <input
                type="checkbox"
                checked={values.includes(id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...values, id]
                      : values.filter((v) => v !== id),
                  )}
              />{" "}
              {index + 1}. {choice}
            </label>
          );
        })}
      </div>
    );
  }

  if (step.type === "words") {
    return step.answerCount
      ? (
        <div className="verify-stack">
          {Array.from(
            { length: step.answerCount },
            (_, index) => (
              <label className="verify-field" key={index}>
                <span>낱말 {index + 1}</span>
                <input
                  required
                  value={values[index] ?? ""}
                  maxLength={step.maxLen ?? 300}
                  onChange={(event) => replaceAt(index, event.target.value)}
                />
              </label>
            ),
          )}
        </div>
      )
      : (
        <label className="verify-field">
          <span>낱말 (한 줄에 하나)</span>
          <textarea
            required
            value={values.join("\n")}
            onChange={(event) => onChange(event.target.value.split("\n"))}
          />
        </label>
      );
  }

  if (step.fields?.length) {
    return step.fields.map((field) => (
      <label className="verify-field" key={field.id}>
        <span>{field.label}{field.required ? " (필수)" : " (선택)"}</span>
        <textarea
          required={field.required}
          maxLength={field.maxLen}
          value={record[field.id] ?? ""}
          onChange={(event) => {
            const next = { ...record };
            if (event.target.value) {
              next[field.id] = event.target.value;
            } else delete next[field.id];
            onChange(next);
          }}
        />
      </label>
    ));
  }

  if (step.type === "confirm") {
    return (
      <label>
        <input
          type="checkbox"
          required
          checked={text === "confirmed"}
          onChange={(event) =>
            onChange(event.target.checked ? "confirmed" : "")}
        />{" "}
        내용을 확인했습니다.
      </label>
    );
  }

  if (step.type === "frequency") {
    return (
      <label className="verify-field">
        <span>주파수 (소수점 한 자리 이하)</span>
        <input
          required
          inputMode="decimal"
          pattern="[0-9]{1,3}(\.[0-9])?"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="verify-field">
      <span>답안 또는 기록</span>
      <textarea
        required
        maxLength={step.maxLen ?? 300}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
