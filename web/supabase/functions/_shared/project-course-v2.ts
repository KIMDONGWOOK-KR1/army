import type { CourseV2, Role, RoleMission, SceneText, Step } from "./types.ts";
import { DomainError } from "./game-core.ts";

export function stagePrivateV2(course: CourseV2, stageId: string) {
  const data = course.private?.stages?.[stageId];
  if (!data?.roles || !data.steps) {
    throw new DomainError(
      "CONTENT_UNCONFIRMED",
      "현재 단계의 비공개 자료 준비가 필요하다.",
    );
  }
  return data;
}

const scenes = (list: SceneText[]) =>
  list.map((s) => ({
    id: s.id,
    channel: s.channel,
    text: s.text,
    trigger: s.trigger,
  }));
const fields = (s: Step) =>
  s.fields?.map((f) => ({
    id: f.id,
    label: f.label,
    required: f.required,
    maxLen: f.maxLen,
  }));
function mission(m: RoleMission | null) {
  if (!m) return null;
  return {
    intro: scenes([m.intro])[0],
    scenes: scenes(m.scenes),
    digit: m.digit,
    ...(m.asset
      ? {
        asset: {
          url: m.asset.url,
          alt: m.asset.alt,
          confirmed: m.asset.confirmed,
        },
      }
      : {}),
    steps: m.steps.map((s) => ({
      id: s.id,
      confirmed: s.confirmed,
      type: s.type,
      prompt: s.prompt,
      grading: s.grading,
      ...(s.choices ? { choices: [...s.choices] } : {}),
      ...(s.statements ? { statements: [...s.statements] } : {}),
      ...(s.fields ? { fields: fields(s) } : {}),
      ...(s.requires
        ? {
          requires: s.requires.map((r) => ({ role: r.role, stepId: r.stepId })),
        }
        : {}),
      ...(s.requiresReports ? { requiresReports: [...s.requiresReports] } : {}),
      ...(s.recordFrom ? { recordFrom: { ...s.recordFrom } } : {}),
      ...(s.sourceIds ? { sourceIds: [...s.sourceIds] } : {}),
      sourceRequired: s.sourceRequired ?? false,
      maxLen: s.maxLen ?? 300,
      ...(s.normalize
        ? {
          normalize: {
            ...(s.normalize.caseInsensitive !== undefined
              ? { caseInsensitive: s.normalize.caseInsensitive }
              : {}),
            ...(s.normalize.ignoreSpaces !== undefined
              ? { ignoreSpaces: s.normalize.ignoreSpaces }
              : {}),
          },
        }
        : {}),
      ...(s.answerCount !== undefined ? { answerCount: s.answerCount } : {}),
    })),
  };
}

/** Metadata for the CURRENT stage only. Never serialize the stored CourseV2 directly. */
export function projectPublicStageV2(course: CourseV2, stageId: string) {
  const s = course.stages.find((s) => s.id === stageId);
  if (!s) throw new DomainError("NO_STAGE", "단계를 찾을 수 없다.");
  const completion = s.completion.type === "lock"
    ? { type: "lock" as const, order: [...s.completion.order] }
    : s.completion.type === "confirm"
    ? {
      type: "confirm" as const,
      labels: {
        commander: s.completion.labels.commander,
        scout: s.completion.labels.scout,
        signal: s.completion.labels.signal,
        cipher: s.completion.labels.cipher,
      },
    }
    : { type: "joint-record" as const };
  return {
    schema_version: 2 as const,
    id: s.id,
    seq: s.seq,
    name: s.name,
    kind: s.kind,
    quiet: s.quiet,
    arrival: {
      mode: s.arrival.mode,
      confirmed: s.arrival.confirmed,
      require: s.arrival.require,
      lat: s.arrival.lat,
      lng: s.arrival.lng,
      radiusM: s.arrival.radiusM,
      noticeM: s.arrival.noticeM,
      dwellSec: s.arrival.dwellSec,
    },
    scoring: {
      enabled: s.scoring.enabled,
      confirmed: s.scoring.confirmed,
      hintPenalty: {
        1: s.scoring.hintPenalty[1],
        2: s.scoring.hintPenalty[2],
        3: s.scoring.hintPenalty[3],
      },
      noHintBonus: s.scoring.noHintBonus,
    },
    narration: scenes(s.narration),
    completion,
    sources: course.sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
    })),
    ...(s.sacho
      ? {
        sacho: {
          id: s.sacho.id,
          name: s.sacho.name,
          sections: [...s.sacho.sections],
        },
      }
      : {}),
    ...(s.altModes
      ? { altModes: s.altModes.map((m) => ({ id: m.id, label: m.label })) }
      : {}),
  };
}

/** role MUST come from the authenticated membership, never a client-supplied role. */
export function projectStageV2(course: CourseV2, stageId: string, role: Role) {
  const stage = projectPublicStageV2(course, stageId);
  const s = course.stages.find((s) => s.id === stageId)!;
  const privateStage = stagePrivateV2(course, stageId);
  if (s.roles[role] && !privateStage.roles[role]) {
    throw new DomainError(
      "CONTENT_UNCONFIRMED",
      "본인 역할의 비공개 자료 준비가 필요하다.",
    );
  }
  const clue = role === "commander"
    ? privateStage.roles.commander?.transferClue
    : undefined;
  return {
    stage,
    self: {
      role,
      mission: mission(s.roles[role]),
      ...(clue
        ? {
          transfer_clue: {
            kind: clue.kind,
            label: clue.label,
            value: clue.value,
            target_step_id: clue.targetStepId,
          },
        }
        : {}),
    },
  };
}
