import type { GameV2State, Role, Stage } from "./types.ts";

export function visitV2(stage: Stage, state: GameV2State) {
  if (!stage.altModes?.length) return undefined;
  const mode = state.altMode?.[stage.id] === "outdoor" ? "outdoor" : "onsite";
  return { mode, label: mode === "outdoor" ? "외부 대체 조사 · 실내 관람 아님" : "현장 조사" } as const;
}

/** Explicit course-declared exception: a free-form record, never a graded answer or digit. */
export function sharedRecordsV2(stage: Stage, state: GameV2State, role: Role) {
  return (stage.roles[role]?.steps ?? []).flatMap((step) => {
    const ref = step.recordFrom;
    if (!ref) return [];
    const sourceStep = stage.roles[ref.role]?.steps.find((s) => s.id === ref.stepId);
    const p = state.progress[stage.id]?.[ref.role]?.steps[ref.stepId];
    if (!sourceStep || sourceStep.grading !== "record" || !sourceStep.fields ||
      !p || !["done", "explained"].includes(p.status)) return [];
    const record = p.record ? Object.fromEntries(sourceStep.fields.flatMap((f) =>
      typeof p.record?.[f.id] === "string" ? [[f.id, p.record[f.id]]] : [])) : null;
    return [{
      step_id: step.id, from_role: ref.role, from_step_id: ref.stepId,
      status: record ? "recorded" as const : "explained_without_record" as const,
      fields: sourceStep.fields.map((f) => ({ id: f.id, label: f.label })),
      record,
      method: p.method ?? "explained",
      source: p.source ? { text: p.source.text, ...(p.source.source_id ? { source_id: p.source.source_id } : {}) } : null,
    }];
  });
}

export function researchV2(stage: Stage, state: GameV2State) {
  if (stage.id !== "yongbong") return undefined;
  const read = (role: Role, id: string) => {
    const step = stage.roles[role]?.steps.find((s) => s.id === id);
    const p = state.progress[stage.id]?.[role]?.steps[id];
    if (!step || step.grading !== "record" || !p?.record) return null;
    return Object.fromEntries((step.fields ?? []).flatMap((f) =>
      typeof p.record?.[f.id] === "string" ? [[f.id, p.record[f.id]]] : []));
  };
  return {
    material: read("signal", "Y-02.record"),
    assessment: read("cipher", "Y-03.limits"),
    revision: read("commander", "Y-04.revision"),
  };
}
