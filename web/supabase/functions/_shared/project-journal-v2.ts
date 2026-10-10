import type { CourseV2, GameV2State, Role } from "./types.ts";
import { sharedRecordsV2, visitV2 } from "./yongbong-v2.ts";
import { projectDraftV2 } from "./closing-v2.ts";

/** Completed public rewards plus the authenticated role's records only. */
export function projectJournalV2(
  course: CourseV2,
  state: GameV2State,
  role: Role | null,
) {
  if (!role) return [];
  return course.stages.flatMap((stage) => {
    const completed = state.completed[stage.id];
    if (!completed || !stage.sacho) return [];
    const progress = state.progress[stage.id]?.[role];
    const secret = course.private.stages[stage.id];
    return [{
      stage_id: stage.id,
      name: stage.sacho?.name ?? stage.name,
      completed_at: completed.at,
      method: completed.method,
      ...(visitV2(stage, state) ? { visit: visitV2(stage, state) } : {}),
      ...(stage.roles[role]?.steps.some((step) => step.recordFrom)
        ? { shared_records: sharedRecordsV2(stage, state, role) } : {}),
      sections: [...(stage.sacho?.sections ?? [])],
      ...(stage.kind === "memorial" ? { memorial_record: projectDraftV2(state.memorialRecords?.[stage.id]) } : {}),
      entries: (stage.roles[role]?.steps ?? []).flatMap((step) => {
        const p = progress?.steps[step.id];
        if (!p || !["done", "explained"].includes(p.status)) return [];
        const fields = step.fields?.map((f) => f.id) ?? ["text"];
        return [{
          step_id: step.id,
          prompt: step.prompt,
          verified: p.status === "done",
          method: p.method ?? "explained",
          ...(p.record
            ? {
              record: Object.fromEntries(
                Object.entries(p.record)
                  .filter(([key]) => fields.includes(key)),
              ),
            }
            : {}),
          ...(p.source
            ? {
              source: {
                text: p.source.text,
                ...(p.source.source_id
                  ? { source_id: p.source.source_id }
                  : {}),
              },
            }
            : {}),
          explanation: secret?.steps[step.id]?.explanation ?? "",
          ...(p.status === "done" && secret?.steps[step.id]?.reward
            ? { reward: secret.steps[step.id].reward }
            : {}),
        }];
      }),
    }];
  });
}
