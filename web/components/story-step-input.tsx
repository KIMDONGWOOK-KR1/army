"use client";

import { Check, Minus, Plus } from "lucide-react";
import type { Step, StepAnswer } from "@/supabase/functions/_shared/types";
import { VerifyInput } from "./verify-input";
import { StoryOrder } from "./story-order";
import { FrequencyTuner } from "./frequency-tuner";
import styles from "./story-mission.module.css";
import { StoryConnections, StoryJudge, StoryMarkedReport, StoryNotebook } from "./story-puzzle-cards";

/** Selection controls only. Every judgement still comes from submit-step. */
export function StoryStepInput({ step, value, onChange, disabled }: {
  step: Step; value: StepAnswer; onChange: (answer: StepAnswer) => void; disabled: boolean;
}) {
  const values = Array.isArray(value) ? value : [];
  if (step.type === "frequency") return <FrequencyTuner value={typeof value === "string" ? value : ""} onChange={onChange} min={40} max={120} strictInput compact disabled={disabled} />;
  if (step.type === "truefalse") return <StoryJudge step={step} value={value} onChange={onChange} />;
  if (step.type === "match" || step.type === "classification") return <StoryConnections step={step} value={value} onChange={onChange} />;
  if (step.grading === "record" && step.fields?.length) return <StoryNotebook step={step} value={value} onChange={onChange} />;
  if (step.id === "G-04.spots") return <StoryMarkedReport step={step} value={value} onChange={onChange} />;
  if (step.id === "G-02.shape") return <div className={styles.observationCounter}>
    <span className={styles.paperLabel}>관찰 계수기</span>
    <div><button type="button" aria-label="관찰 수 하나 줄이기" disabled={!Number(value)} onClick={() => onChange(String(Math.max(0, Number(value) - 1)))}><Minus /></button>
      <label><span className="sr-only">답안 또는 기록</span><input aria-label="답안 또는 기록" inputMode="numeric" pattern="[0-9]+" value={typeof value === "string" ? value : ""}
        placeholder="—" onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
      <button type="button" aria-label="관찰 수 하나 늘리기" disabled={Number(value) >= 99} onClick={() => onChange(String(Math.min(99, Number(value) + 1)))}><Plus /></button></div>
  </div>;
  if (step.type === "order") return <StoryOrder step={step} value={value} onChange={onChange} disabled={disabled} />;
  if (step.type === "choice" || (step.grading === "set-hash" && step.choices)) {
    const multiple = step.type !== "choice";
    return <div className={styles.choices}>
      {multiple && <p>{step.answerCount ? `${step.answerCount}개를 골라주세요.` : "해당하는 항목을 골라주세요."}</p>}
      {step.choices?.map((choice, i) => {
        const id = String(i + 1), selected = multiple ? values.includes(id) : value === id;
        return <label key={id} data-selected={selected}>
          <input type={multiple ? "checkbox" : "radio"} name={step.id} value={id} required={!multiple} checked={selected}
            onChange={() => onChange(multiple ? selected ? values.filter((v) => v !== id) : [...values, id] : id)} />
          <span>{choice}</span>{selected && <Check size={18} aria-hidden />}
        </label>;
      })}
    </div>;
  }
  return <div className={step.type === "words" ? styles.wordSlots : styles.answerSlip}><VerifyInput step={step} value={value} onChange={onChange} /></div>;
}
