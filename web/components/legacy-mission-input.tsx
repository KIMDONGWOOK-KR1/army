"use client";

import type { Role, Step } from "@/supabase/functions/_shared/types";
import { FrequencyTuner } from "./frequency-tuner";
import { MissionCalendar } from "./mission-calendar";

const legacySteps: Record<Role, { id: string; type: Step["type"] }> = {
  commander: { id: "G-01.legacy", type: "choice" },
  scout: { id: "G-02.legacy", type: "observation" },
  signal: { id: "G-03.legacy", type: "frequency" },
  cipher: { id: "G-04.legacy", type: "choice" },
};

/** Presentation for the migrated dev preset; all content comes from self.mission. */
export function isLegacyMissionStep(
  stageId: string,
  role: Role | null,
  step: Step,
) {
  return stageId === "gate" && role !== null &&
    legacySteps[role].id === step.id && legacySteps[role].type === step.type &&
    step.grading === "hash";
}

export function LegacyMissionInput({
  step,
  role,
  value,
  onChange,
  disabled,
}: {
  step: Step;
  role: Role;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  if (step.type === "frequency") {
    return (
      <FrequencyTuner
        value={value}
        onChange={onChange}
        min={10}
        max={100}
        strictInput
        disabled={disabled}
      />
    );
  }
  if (step.type === "choice") {
    return (
      <>
        {role === "cipher" && <MissionCalendar />}
        <div className="choices" aria-label="답안 선택">
          {(step.choices ?? []).map((choice, index) => (
            <button
              key={index}
              type="button"
              disabled={disabled}
              aria-pressed={value === String(index + 1)}
              className={value === String(index + 1) ? "selected" : ""}
              onClick={() => onChange(String(index + 1))}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {choice}
            </button>
          ))}
        </div>
      </>
    );
  }
  return (
    <label className="field-label">
      찾은 단서의 답
      <input
        value={value}
        required
        maxLength={step.maxLen ?? 300}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="현장에서 찾은 답을 입력하라"
        autoComplete="off"
      />
    </label>
  );
}
