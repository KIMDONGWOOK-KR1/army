import { normalizeTextV2 } from "./answer-v2.ts";
import { DomainError } from "./game-core.ts";
import { ROLES } from "./types.ts";
import type { Command, CourseV2, Game, GameV2State, Role, SharedDraftV2, Stage } from "./types.ts";

export function requireDraftVersion(cmd: Command, version: number) {
  if (!Number.isSafeInteger(cmd.draft_version) || cmd.draft_version !== version) {
    throw new DomainError("STALE_DRAFT", "공동 기록이 변경되었다. 최신 문장과 근거를 다시 확인하라.");
  }
}
export function draftV2(cmd: Command, stage: Stage, previous?: SharedDraftV2): SharedDraftV2 {
  requireDraftVersion(cmd, previous?.version ?? 0);
  try {
    const template = stage.recordTemplate;
    if (!template || !Array.isArray(cmd.words) || cmd.words.length !== template.wordCount ||
      cmd.words.some((w) => !template.wordChoices.includes(w))) throw new Error();
    const text = normalizeTextV2(cmd.text, 600), reason = normalizeTextV2(cmd.reason, 600);
    if (previous && previous.text === text && previous.reason === reason &&
      JSON.stringify(previous.words) === JSON.stringify(cmd.words)) return previous;
    return { version: (previous?.version ?? 0) + 1, words: [...cmd.words], text, reason, confirms: {} };
  } catch {
    throw new DomainError("BAD_RECORD", "낱말·공동 문장·근거와 글자 수를 확인하라.");
  }
}
export function projectDraftV2(draft?: SharedDraftV2) {
  return draft ? { draft_version: draft.version, words: [...draft.words], text: draft.text,
    reason: draft.reason, confirm_mask: ROLES.map((r) => draft.confirms[r] !== undefined) } : null;
}
export function closingProjectionV2(state: GameV2State, stage: Stage, role: Role, visible: boolean) {
  if (!visible) return {};
  if (stage.completion.type === "confirm") {
    return { memorial_record: projectDraftV2(state.memorialRecords?.[stage.id]) };
  }
  if (stage.completion.type === "joint-record") {
    return { joint_record: projectDraftV2(state.jointRecords?.[stage.id]),
      retro: state.retros?.[stage.id]?.[role]?.text ?? null };
  }
  return {};
}
/** Whitelist result aggregates. Never serialize stored progress, personal prose or grading data. */
export function resultV2(game: Game, course: CourseV2) {
  if (game.status !== "done" || !game.v2) return null;
  const state = game.v2;
  const stages = course.stages.filter((s) => s.kind === "mission" || s.kind === "memorial");
  return {
    completed_at: game.endedAt,
    investigation: { completed: stages.filter((s) => state.completed[s.id]).length, total: stages.length },
    sacho: { completed: stages.filter((s) => s.sacho && state.sacho[s.id]).length,
      total: stages.filter((s) => s.sacho).length },
    stages: stages.map((s) => {
      const progress = state.progress[s.id];
      return { stage_id: s.id, name: s.name, summary: s.sacho?.body ?? "", quiet: s.quiet,
        completion: state.completed[s.id]?.method === "explained" ? "해설 확인 후 복원" :
          s.kind === "memorial" ? "공동 확인 완료" : "조사 후 복원",
        visit_mode: state.altMode?.[s.id] ?? "onsite",
        arrival_method: game.arrivals.some((a) => a.siteId === s.id && a.simulated) ? "simulated" : "gps",
        roles: ROLES.map((role) => {
          const rp = progress?.[role], steps = Object.values(rp?.steps ?? {});
          return { role, completed: steps.filter((p) => ["done", "explained"].includes(p.status)).length,
            total: s.roles[role]?.steps.length ?? 0, reported: rp?.reported ?? false,
            hint_level: rp?.hintLevel ?? 0, explained: steps.filter((p) => p.status === "explained").length,
            records: steps.filter((p) => p.record).length,
            cross_checks: (s.roles[role]?.steps ?? []).filter((step) =>
              (step.recordFrom || step.requiresReports?.length) && rp?.steps[step.id]?.status === "done").length,
            methods: [...new Set(steps.flatMap((p) => p.method ? [p.method] : []))] };
        }),
        memorial_record: projectDraftV2(state.memorialRecords?.[s.id]),
      };
    }),
    joint_records: course.stages.filter((s) => s.completion.type === "joint-record").map((s) => ({
      stage_id: s.id, ...projectDraftV2(state.jointRecords?.[s.id]),
      retro_mask: ROLES.map((r) => !!state.retros?.[s.id]?.[r]),
    })),
    supplementary_score: game.score,
    time_score: null,
    ranking: null,
  };
}
