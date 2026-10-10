import { answerHashV2, normalizeTextV2 } from "./answer-v2.ts";
import { allowsSimulatedArrival, hasGpsArrival } from "./arrival-policy.ts";
import { DomainError, sha256, validateNickname } from "./game-core.ts";
import {
  projectPublicStageV2,
  projectStageV2,
  stagePrivateV2,
} from "./project-course-v2.ts";
import { ROLES } from "./types.ts";
import { projectJournalV2 } from "./project-journal-v2.ts";
import { researchV2, sharedRecordsV2, visitV2 } from "./yongbong-v2.ts";
import { closingProjectionV2, draftV2, requireDraftVersion, resultV2 } from "./closing-v2.ts";
import type {
  Command,
  Course,
  CourseV2,
  Game,
  GameEvent,
  GameV2State,
  Role,
  RoleProgress,
  SiteInfo,
  Snapshot,
  Stage,
  Step,
  StepProgress,
  VerifyMethod,
} from "./types.ts";

function fail(code: string, message: string, retry?: number): never {
  throw new DomainError(code, message, retry);
}
export const isCourseV2 = (course: Course | CourseV2): course is CourseV2 =>
  "schemaVersion" in course && course.schemaVersion === 2;
const done = (p: StepProgress) =>
  p.status === "done" || p.status === "explained";
const blankLock = () => ({
  digits: [null, null, null, null] as (number | null)[],
  attempts: 0,
  nextAttemptAt: null as number | null,
  openedAt: null as number | null,
});
const roleProgress = (stage: Stage) =>
  Object.fromEntries(ROLES.map((role) => [role, {
    steps: Object.fromEntries(
      (stage.roles[role]?.steps ?? []).map((step) => [step.id, {
        status: step.requires?.length || step.requiresReports?.length
          ? "locked"
          : "open",
        attempts: 0,
        lastAt: null,
      }]),
    ),
    hintLevel: 0,
    reported: false,
  }])) as Record<Role, RoleProgress>;

export function initializeV2(course: CourseV2): GameV2State {
  // PR-2 keeps the v1 lobby/briefing/equipment flow. Prologue actions belong to PR-3.
  const stageIndex = course.stages.findIndex((s) => s.kind === "mission");
  if (stageIndex < 0) {
    return fail("CONTENT_UNCONFIRMED", "실행 가능한 미션 단계가 없다.");
  }
  const stage = course.stages[stageIndex];
  return {
    stageIndex,
    stagePhase: "travel",
    progress: { [stage.id]: roleProgress(stage) },
    explanationConfirms: {},
    completed: {},
    sacho: {},
  };
}
function current(game: Game, course: CourseV2) {
  const state = game.v2 ??
    fail("CONTENT_UNCONFIRMED", "게임 진행 버전이 코스와 일치하지 않는다.");
  const stage = course.stages[state.stageIndex] ??
    fail("NO_STAGE", "현재 단계를 찾을 수 없다.");
  const progress = state.progress[stage.id] ??
    fail("CONTENT_UNCONFIRMED", "단계 진행 자료 준비가 필요하다.");
  return { state, stage, progress };
}
function requirements(step: Step, progress: Record<Role, RoleProgress>) {
  return (step.requires ?? []).every((r) =>
    progress[r.role]?.steps[r.stepId] && done(progress[r.role].steps[r.stepId])
  ) &&
    (step.requiresReports ?? []).every((r) => progress[r]?.reported);
}
function unlock(stage: Stage, progress: Record<Role, RoleProgress>) {
  for (const role of ROLES) {
    for (const step of stage.roles[role]?.steps ?? []) {
      const p = progress[role].steps[step.id];
      if (!done(p)) p.status = requirements(step, progress) ? "open" : "locked";
    }
  }
}
function prepared(course: CourseV2, stage: Stage) {
  const p = stagePrivateV2(course, stage.id);
  for (const role of ROLES) {
    const mission = stage.roles[role];
    const privateRole = p.roles[role];
    if (
      !mission || !privateRole || !Array.isArray(privateRole.hints) ||
      privateRole.hints.length !== 3 ||
      privateRole.hints.some((h) => typeof h !== "string" || !h.trim()) ||
      (mission.digit &&
        (!Number.isInteger(privateRole.digit) || privateRole.digit! < 0 ||
          privateRole.digit! > 9))
    ) {
      fail("CONTENT_UNCONFIRMED", "역할별 콘텐츠 준비가 필요하다.");
    }
    for (const step of mission.steps) {
      const secret = p.steps[step.id];
      if (
        !secret || typeof secret.explanation !== "string" ||
        !secret.explanation.trim() ||
        (secret.reward !== undefined && typeof secret.reward !== "string") ||
        (step.grading.includes("hash") &&
          !/^[a-f0-9]{64}$/.test(secret.answerHash ?? ""))
      ) {
        fail("CONTENT_UNCONFIRMED", "문제 판정 자료 준비가 필요하다.");
      }
    }
  }
  if (
    stage.roles.signal?.steps.some((s) => s.type === "frequency") &&
    (!p.roles.commander?.transferClue ||
      typeof p.roles.commander.transferClue.value !== "string")
  ) {
    fail("CONTENT_UNCONFIRMED", "전달형 개인 단서 준비가 필요하다.");
  }
  return p;
}
export function siteInfoV2(stage: Stage, completed = false): SiteInfo {
  return {
    id: stage.id,
    seq: stage.seq,
    name: stage.name,
    lat: stage.arrival.lat,
    lng: stage.arrival.lng,
    radiusM: stage.arrival.radiusM ?? 15,
    reverent: stage.quiet,
    lockOrder: stage.completion.type === "lock"
      ? [...stage.completion.order]
      : [...ROLES],
    sacho: {
      char: completed ? stage.sacho?.char ?? "" : "",
      name: stage.sacho?.name ?? stage.name,
      body: completed ? stage.sacho?.body ?? "" : "",
    },
  };
}
export function projectGameV2(
  game: Game,
  course: CourseV2,
  userId: string,
  now: number,
) {
  const member = game.members.find((m) => m.userId === userId) ??
    fail("FORBIDDEN", "이 작전에 소속된 기기가 아니다.");
  const { state, stage, progress } = current(game, course);
  const visible = game.status === "playing" &&
    ["mission", "cleared"].includes(game.phase) && member.role !== null;
  const secret = visible ? prepared(course, stage) : null;
  const personal = visible
    ? projectStageV2(course, stage.id, member.role!)
    : null;
  const rp = member.role ? progress[member.role] : null;
  const hints = visible && rp
    ? secret!.roles[member.role!]!.hints.slice(0, rp.hintLevel)
    : [];
  const explanations: Record<string, string> = {},
    rewards: Record<string, string> = {};
  const stepProgress: Record<string, Omit<StepProgress, "source" | "lastAt">> =
    {};
  if (visible && rp) {
    for (const step of stage.roles[member.role!]!.steps) {
      const p = rp.steps[step.id];
      stepProgress[step.id] = {
        status: p.status,
        attempts: p.attempts,
        ...(p.method ? { method: p.method } : {}),
        ...(p.record
          ? {
            record: Object.fromEntries(
              Object.entries(p.record).filter(([k]) =>
                (step.fields?.map((f) => f.id) ?? ["text"]).includes(k)
              ),
            ),
          }
          : {}),
      };
      if (done(p)) {
        explanations[step.id] = secret!.steps[step.id].explanation;
        if (p.status === "done" && secret!.steps[step.id].reward) {
          rewards[step.id] = secret!.steps[step.id].reward!;
        }
      }
    }
  }
  const lock = game.locks[stage.id] ?? blankLock();
  const completed = state.completed[stage.id];
  const info = siteInfoV2(stage, !!completed);
  const publicGame: Snapshot["game"] = {
    id: game.id,
    code: game.code,
    status: game.status,
    site_phase: game.phase,
    version: game.version,
    score: game.score,
    current_site_seq: stage.seq,
    host_member_id: game.hostId,
    reveal_at: game.revealAt,
    site_started_at: game.siteStartedAt,
    started_at: game.startedAt,
    ended_at: game.endedAt,
    report_mask: ROLES.map((r) => progress[r].reported),
    locked_mask: lock.digits.map((d) => d !== null),
    attempts_left: stage.completion.type !== "lock" ? 0 : lock.attempts < 3
      ? 3 - lock.attempts
      : lock.nextAttemptAt !== null && now >= lock.nextAttemptAt
      ? 1
      : 0,
    next_attempt_at: lock.nextAttemptAt,
    acquired_sites: course.stages.filter((s) => s.sacho && state.completed[s.id]).map(
      (s) => siteInfoV2(s, true),
    ),
    members: game.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      role: m.role,
      ready: m.ready,
      online: now - m.lastSeen < 45000,
    })),
    demo: course.demo,
  };
  return {
    server_now: now,
    version: game.version,
    course: {
      id: course.id,
      name: course.name,
      confirmed: course.confirmed,
      demo: course.demo,
      sites: course.stages.filter((s) => s.kind !== "prologue")
        .map((s) => siteInfoV2(s, !!state.completed[s.id])),
    },
    current_site: info,
    game: {
      ...publicGame,
      stage_id: stage.id,
      stage_kind: stage.kind,
      stage_phase: state.stagePhase,
      quiet: stage.quiet,
      completion: completed ? {
        at: completed.at,
        method: completed.method,
        label: stage.kind === "memorial" ? "공동 확인 완료" : stage.kind === "epilogue" ? "공동 기록 완료" : completed.method === "explained" ? "해설 확인 후 복원" : "조사 후 복원",
        ...(visitV2(stage, state) ? { visit: visitV2(stage, state) } : {}),
      } : null,
      ...(stage.altModes?.length ? { visit: visitV2(stage, state) } : {}),
      ...(stage.completion.type === "joint-record" ? {
        retro_mask: ROLES.map((r) => !!state.retros?.[stage.id]?.[r]),
      } : {}),
      step_done_count: Object.fromEntries(
        ROLES.map(
          (r) => [r, Object.values(progress[r].steps).filter(done).length],
        ),
      ),
      hint_level: Object.fromEntries(
        ROLES.map((r) => [r, progress[r].hintLevel]),
      ),
      arrival_mask: ROLES.map((r) =>
        game.arrivals.some((a) =>
          a.siteId === stage.id &&
          game.members.find((m) => m.id === a.memberId)?.role === r
        )
      ),
      confirm_mask: ROLES.map((r) =>
        state.explanationConfirms[stage.id]?.[r] !== undefined
      ),
      swap: { window_ends_at: null, used: false, pending: null }, // Compatibility only: participant role exchange is forbidden.
    },
    self: {
      id: member.id,
      nickname: member.nickname,
      role: member.role,
      is_host: member.id === game.hostId,
      ready: member.ready,
      reported: rp?.reported ?? false,
      digit: visible && rp?.reported
        ? secret!.roles[member.role!]!.digit ?? null
        : null,
      clue: null,
      lock: visible && stage.completion.type === "lock" && member.role === "commander"
        ? structuredClone(lock)
        : null,
      mission: personal?.self.mission ?? null,
      ...(personal && "transfer_clue" in personal.self
        ? { transfer_clue: personal.self.transfer_clue }
        : {}),
      step_progress: stepProgress,
      hint_level: visible ? rp!.hintLevel : 0,
      hints,
      explanations,
      rewards,
      journal: projectJournalV2(course, state, member.role),
      ...(member.role ? closingProjectionV2(state, stage, member.role, visible || game.status === "done") : {}),
      ...(game.status === "done" ? { result: resultV2(game, course) } : {}),
      ...(visible && stage.roles[member.role!]?.steps.some((s) => s.recordFrom)
        ? { shared_records: sharedRecordsV2(stage, state, member.role!) } : {}),
    },
    stage: personal?.stage ?? projectPublicStageV2(course, stage.id),
  };
}

const writes = new Set([
  "join-game",
  "start-game",
  "set-ready",
  "begin-operation",
  "report-arrival",
  "submit-step",
  "request-hint",
  "submit-report",
  "confirm-explanation",
  "open-lock",
  "open-after-explanation",
  "depart-next-site",
  "select-alt-mode",
  "draft-memorial-record", "confirm-stage", "submit-retro", "draft-joint-record", "consent-joint-record",
]);
export type SnapshotV2 = ReturnType<typeof projectGameV2>;
function recordInput(step: Step, value: unknown) {
  try {
    if (!step.fields) {
      return { text: normalizeTextV2(value, step.maxLen ?? 300) };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((k) => !step.fields!.some((f) => f.id === k))) {
      throw new Error();
    }
    return Object.fromEntries(step.fields.flatMap((f) => {
      const v = input[f.id];
      if (!f.required && (v === undefined || v === "")) return [];
      return [[
        f.id,
        normalizeTextV2(v, Math.min(f.maxLen, step.maxLen ?? 300)),
      ]];
    }));
  } catch {
    return fail("BAD_ANSWER", "필수 기록 항목과 글자 수를 확인하라.");
  }
}
function sourceInput(step: Step, cmd: Command, course: CourseV2) {
  if (!cmd.source) {
    if (step.sourceRequired) {
      return fail("SOURCE_REQUIRED", "확인한 자료와 확인 방식을 입력하라.");
    }
    return undefined;
  }
  try {
    if (
      typeof cmd.source !== "object" || Array.isArray(cmd.source) ||
      Object.keys(cmd.source).some((k) => !["text", "source_id"].includes(k))
    ) throw new Error();
    const text = normalizeTextV2(cmd.source.text);
    const id = cmd.source.source_id;
    if (
      id !== undefined &&
      (!course.sources.some((s) => s.id === id) ||
        (step.sourceIds && !step.sourceIds.includes(id)))
    ) throw new Error();
    return { text, ...(id ? { source_id: id } : {}) };
  } catch {
    return fail("SOURCE_REQUIRED", "유효한 자료 출처를 입력하라.");
  }
}
function finish(
  game: Game,
  course: CourseV2,
  now: number,
  method: "field" | "explained",
) {
  const { state, stage, progress } = current(game, course);
  const eventOrder: GameV2State["sacho"][string]["eventOrder"] = [];
  const observations: GameV2State["sacho"][string]["observations"] = [];
  const eventRecords: GameV2State["sacho"][string]["eventRecords"] = [];
  const sources: GameV2State["sacho"][string]["sources"] = [];
  for (const role of ROLES) {
    for (const step of stage.roles[role]!.steps) {
      const p = progress[role].steps[step.id];
      if (step.type === "order") {
        eventOrder.push({
          stepId: step.id,
          method: p.method!,
          verified: p.status === "done",
        });
      }
      if (p.record) {
        (role === "scout" ? observations : eventRecords).push({
          role,
          stepId: step.id,
          record: structuredClone(p.record),
        });
      }
      if (p.source) {
        sources.push({ role, stepId: step.id, method: p.method!, ...p.source });
      }
    }
  }
  // Preserve verification and participant records privately; never retain graded answer plaintext.
  state.sacho[stage.id] = {
    completedAt: now,
    eventOrder,
    observations,
    eventRecords,
    sources,
    ...(visitV2(stage, state) ? { visitMode: visitV2(stage, state)!.mode } : {}),
    ...(researchV2(stage, state) ? { research: researchV2(stage, state) } : {}),
  };
  state.completed[stage.id] = { at: now, method };
  state.stagePhase = "done";
  game.phase = "cleared";
  if (stage.completion.type === "lock") {
    const lock = game.locks[stage.id] ??= blankLock();
    lock.openedAt = now;
    lock.nextAttemptAt = null;
  }
  if (
    method !== "explained" && stage.scoring.enabled &&
    ROLES.every((r) => progress[r].hintLevel === 0)
  ) {
    const bonus = stage.scoring.noHintBonus;
    if (bonus === null || !Number.isFinite(bonus) || bonus < 0) {
      fail("CONTENT_UNCONFIRMED", "점수 설정 확정이 필요하다.");
    }
    game.score += bonus;
  }
  return {
    opened: true,
    method,
    label: method === "explained" ? "해설 확인 후 복원" : "조사 후 복원",
    sacho_id: stage.sacho?.id ?? null,
    ...(visitV2(stage, state) ? { visit: visitV2(stage, state) } : {}),
  };
}

/** Mutate only after success, so rejected writes cannot leak partial state into local persistence. */
export async function dispatchV2(
  game: Game,
  course: CourseV2,
  userId: string,
  cmd: Command,
  now: number,
  salt: string,
  events: GameEvent[],
) {
  const next = structuredClone(game);
  const pending: GameEvent[] = [];
  const result = await execute(next, course, userId, cmd, now, salt, pending);
  Object.assign(game, next);
  events.push(...pending);
  return result;
}
async function execute(
  game: Game,
  course: CourseV2,
  userId: string,
  cmd: Command,
  now: number,
  salt: string,
  events: GameEvent[],
): Promise<Record<string, unknown>> {
  const mutating = writes.has(cmd.action);
  if (!mutating && !["get-game", "get-stage", "get-result"].includes(cmd.action)) {
    fail("INVALID_ACTION", "이 버전에서 지원하지 않는 요청이다.");
  }
  if (
    mutating &&
    (typeof cmd.request_id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.request_id))
  ) fail("BAD_REQUEST", "요청 식별자가 필요하다.");
  if (cmd.role !== undefined || cmd.demo_role !== undefined) {
    fail("FORBIDDEN", "역할은 인증된 멤버 정보로 확인한다.");
  }
  if (salt.length < 32) fail("SERVER_ERROR", "서버 정답 보호 설정이 필요하다.");
  let member = game.members.find((m) => m.userId === userId);
  if (!member && cmd.action !== "join-game") {
    fail("FORBIDDEN", "이 작전에 소속된 기기가 아니다.");
  }
  const key = `${userId}:${cmd.request_id}`;
  const hash = mutating ? await sha256(JSON.stringify(cmd)) : "";
  if (mutating && game.receipts[key]) {
    if (game.receipts[key].hash !== hash) {
      fail("IDEMPOTENCY_CONFLICT", "같은 요청 번호의 내용이 다르다.");
    }
    return structuredClone(game.receipts[key].result);
  }
  if (game.expiresAt <= now && game.status !== "done") {
    fail("EXPIRED", "작전이 만료되었다.");
  }
  if (mutating && Object.keys(game.receipts).length >= 2000) {
    fail("RATE_LIMITED", "요청 수를 초과했다.");
  }
  if (game.status === "briefing" && now >= game.revealAt!) {
    game.status = "equip";
    game.version++;
  }
  const { state, stage, progress } = current(game, course);
  const phase = (status: Game["status"], value?: Game["phase"]) => {
    if (game.status !== status || (value && game.phase !== value)) {
      fail("WRONG_PHASE", "현재 진행 상태에서 사용할 수 없는 요청이다.");
    }
  };
  const commander = () => {
    if (member?.role !== "commander") {
      fail("FORBIDDEN", "지휘관만 실행할 수 있다.");
    }
  };
  const stageAction = () => {
    if (cmd.stage_id !== stage.id) {
      fail("STALE_STAGE", "현재 단계를 다시 조회하라.");
    }
  };
  const reports = () => {
    if (
      !ROLES.every((r) =>
        progress[r].reported && Object.values(progress[r].steps).every(done)
      )
    ) fail("REPORTS_REQUIRED", "전원의 조사와 보고를 완료하라.");
  };
  let result: Record<string, unknown> = {};
  let metadata: GameEvent["data"] = {};
  if (cmd.action === "get-stage") {
    stageAction();
    phase("playing");
    if (!["mission", "cleared"].includes(game.phase)) {
      fail("WRONG_PHASE", "도착 후 미션을 조회하라.");
    }
    prepared(course, stage);
  }
  if (!mutating) {
    if (cmd.action === "get-result") {
      phase("done");
      return resultV2(game, course)!;
    }
    if (member && now - member.lastSeen >= 15000) {
      member.lastSeen = now;
      game.version++;
    }
    return result;
  }
  if (game.status === "done") {
    fail("WRONG_PHASE", "종료된 작전은 변경할 수 없다.");
  }
  if (stage.completion.type !== "lock" && ["confirm-explanation", "open-after-explanation", "open-lock"].includes(cmd.action)) {
    fail("WRONG_PHASE", "공동 기록 단계에는 자물쇠 개방을 사용할 수 없다.");
  }
  if (stage.completion.type === "joint-record" && ["submit-step", "submit-report", "request-hint"].includes(cmd.action)) {
    fail("WRONG_PHASE", "회고 작성과 공동 동의로 진행하라.");
  }
  switch (cmd.action) {
    case "draft-memorial-record":
    case "draft-joint-record": {
      stageAction(); phase("playing", "mission"); commander();
      const memorial = cmd.action === "draft-memorial-record";
      if (stage.completion.type !== (memorial ? "confirm" : "joint-record")) {
        fail("WRONG_PHASE", "현재 단계의 공동 기록 요청을 사용하라.");
      }
      reports();
      if (!memorial && !ROLES.every((r) => state.retros?.[stage.id]?.[r])) {
        fail("RETROS_REQUIRED", "전원의 회고 작성이 필요하다.");
      }
      const records = memorial ? state.memorialRecords ??= {} : state.jointRecords ??= {};
      const draft = records[stage.id] = draftV2(cmd, stage, records[stage.id]);
      result = { draft_version: draft.version };
      metadata = { draft_version: draft.version };
      break;
    }
    case "confirm-stage":
    case "consent-joint-record": {
      stageAction(); phase("playing", "mission");
      const memorial = cmd.action === "confirm-stage";
      if (stage.completion.type !== (memorial ? "confirm" : "joint-record")) {
        fail("WRONG_PHASE", "현재 단계의 확인 요청을 사용하라.");
      }
      reports();
      if (!memorial && !ROLES.every((r) => state.retros?.[stage.id]?.[r])) {
        fail("RETROS_REQUIRED", "전원의 회고 작성이 필요하다.");
      }
      const draft = (memorial ? state.memorialRecords : state.jointRecords)?.[stage.id];
      if (!draft) fail("RECORD_REQUIRED", "공동 문장과 근거를 먼저 작성하라.");
      requireDraftVersion(cmd, draft.version);
      draft.confirms[member!.role!] ??= now;
      if (ROLES.every((r) => draft.confirms[r] !== undefined)) {
        if (memorial) finish(game, course, now, "field");
        else {
          state.completed[stage.id] = { at: now, method: "field" };
          state.stagePhase = "done";
          game.phase = "cleared";
          game.status = "done";
          game.endedAt = now;
        }
      }
      result = { confirmed: true, draft_version: draft.version };
      metadata = { draft_version: draft.version };
      break;
    }
    case "submit-retro": {
      stageAction(); phase("playing", "mission");
      if (stage.completion.type !== "joint-record") fail("WRONG_PHASE", "회고 단계가 아니다.");
      let text: string;
      try { text = normalizeTextV2(cmd.text, 600); }
      catch { return fail("BAD_RECORD", "회고를 1~600자로 작성하라."); }
      const role = member!.role!;
      const retros = (state.retros ??= {})[stage.id] ??= {};
      if (retros[role]?.text !== text) {
        retros[role] = { text, at: now };
        const draft = state.jointRecords?.[stage.id];
        if (draft) { draft.version++; draft.confirms = {}; }
      }
      for (const p of Object.values(progress[role].steps)) {
        p.status = "done"; p.lastAt = now;
      }
      progress[role].reported = true;
      result = { saved: true };
      break;
    }
    case "join-game": {
      if (!member) {
        phase("lobby");
        if (game.members.length >= 4) fail("ROOM_FULL", "네 자리가 모두 찼다.");
        const nickname = validateNickname(cmd.nickname);
        if (game.members.some((m) => m.nickname === nickname)) {
          fail("INVALID_NICKNAME", "이미 사용 중인 호출명이다.");
        }
        member = {
          id: crypto.randomUUID(),
          userId,
          nickname,
          role: null,
          ready: false,
          lastSeen: now,
        };
        game.members.push(member);
      }
      result = { joined: true };
      break;
    }
    case "start-game": {
      phase("lobby");
      if (member!.id !== game.hostId) {
        fail("FORBIDDEN", "방장만 보직을 공개할 수 있다.");
      }
      if (game.members.length !== 4) {
        fail("NOT_READY", "네 명이 모두 합류해야 한다.");
      }
      prepared(course, stage);
      const roles = [...ROLES];
      for (let i = roles.length - 1; i > 0; i--) {
        const n = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
        [roles[i], roles[n]] = [roles[n], roles[i]];
      }
      game.members.forEach((m, i) => m.role = roles[i]);
      game.status = "briefing";
      game.revealAt = now + 3000;
      break;
    }
    case "set-ready":
      phase("equip");
      member!.ready = true;
      break;
    case "begin-operation":
      phase("equip");
      commander();
      if (!game.members.every((m) => m.ready)) {
        fail("NOT_READY", "전원의 준비를 확인하라.");
      }
      game.status = "playing";
      game.phase = "travel";
      game.startedAt = now;
      game.siteStartedAt = now;
      break;
    case "report-arrival": {
      stageAction();
      phase("playing", "travel");
      const method = cmd.manual ? "manual" : cmd.method ?? "gps";
      if (method === "simulated") {
        if (!allowsSimulatedArrival(course, stage.arrival)) {
          fail("FORBIDDEN", "GPS 코스에서는 모의 도착할 수 없다.");
        }
      } else if (method !== "gps") {
        fail("FORBIDDEN", "GPS로 본인의 도착을 확인하라. 수동·QR 도착은 사용할 수 없다.");
      } else if (!hasGpsArrival(stage.arrival)) {
        fail("CONTENT_UNCONFIRMED", "전원 GPS 도착 좌표·반경·체류 설정 확인이 필요하다.");
      }
      if (
        !game.arrivals.some((a) =>
          a.siteId === stage.id && a.memberId === member!.id
        )
      ) {
        game.arrivals.push({
          siteId: stage.id,
          memberId: member!.id,
          manual: false,
          simulated: method === "simulated",
          at: now,
        });
      }
      const all = game.members.length === 4 && game.members.every((m) =>
        game.arrivals.some((a) => a.siteId === stage.id && a.memberId === m.id &&
          !a.manual && (allowsSimulatedArrival(course, stage.arrival) || !a.simulated))
      );
      if (all) {
        game.phase = "mission";
        state.stagePhase = "mission";
      } else state.stagePhase = "arrival";
      result = { arrived: true };
      metadata = { method };
      break;
    }
    case "submit-step": {
      stageAction();
      phase("playing", "mission");
      const role = member!.role!;
      const step = stage.roles[role]?.steps.find((s) => s.id === cmd.step_id) ??
        fail("NO_STEP", "본인 문제를 찾을 수 없다.");
      const privateStage = prepared(course, stage),
        p = progress[role].steps[step.id];
      if (!requirements(step, progress)) {
        fail("STEP_LOCKED", "선행 문제 또는 보고를 완료하라.");
      }
      if (done(p)) {
        result = { step_id: step.id, accepted: true, status: p.status };
        break;
      }
      const method = cmd.method;
      if (
        !(["field", "official_digital"].includes(method ?? "") ||
          (method === "simulated" && course.demo))
      ) fail("BAD_REQUEST", "허용된 확인 방식을 선택하라.");
      const source = sourceInput(step, cmd, course);
      if (p.lastAt !== null && now - p.lastAt < 1000) {
        fail("RATE_LIMITED", "잠시 뒤 다시 제출하라.", p.lastAt + 1000);
      }
      let accepted = false, record: Record<string, string> | undefined;
      if (step.grading.includes("hash")) {
        try {
          accepted = await answerHashV2(salt, course.id, step, cmd.answer!) ===
            privateStage.steps[step.id].answerHash;
        } catch {
          fail("BAD_ANSWER", "답안 형식과 입력 범위를 확인하라.");
        }
      } else if (step.grading === "confirm") {
        accepted = cmd.answer === "confirmed";
      } else {
        record = recordInput(step, cmd.answer);
        accepted = true;
      }
      p.attempts++;
      p.lastAt = now;
      if (accepted) {
        p.status = "done";
        p.method = method as VerifyMethod;
        if (record) p.record = record;
        if (source) p.source = source;
      }
      unlock(stage, progress);
      result = { step_id: step.id, accepted, status: p.status };
      metadata = { step_id: step.id, accepted, method: method! };
      break;
    }
    case "request-hint": {
      stageAction();
      phase("playing", "mission");
      commander();
      if (!ROLES.includes(cmd.target_role!)) {
        fail("BAD_REQUEST", "힌트를 받을 역할을 지정하라.");
      }
      const target = cmd.target_role!, rp = progress[target];
      const level = cmd.level;
      if (![1, 2, 3].includes(level!) || level !== rp.hintLevel + 1) {
        fail("HINT_ORDER", "힌트는 1·2·3단계 순서로 요청하라.");
      }
      if (rp.reported || Object.values(rp.steps).every(done)) {
        fail("WRONG_PHASE", "이미 완료한 역할에는 힌트를 요청할 수 없다.");
      }
      prepared(course, stage);
      const penalty = stage.scoring.hintPenalty[level as 1 | 2 | 3];
      if (penalty === null || !Number.isFinite(penalty) || penalty < 0) {
        fail("CONTENT_UNCONFIRMED", "힌트 감점 설정 확정이 필요하다.");
      }
      rp.hintLevel = level as 1 | 2 | 3;
      if (stage.scoring.enabled) game.score = Math.max(0, game.score - penalty);
      if (level === 3) {
        for (const p of Object.values(rp.steps)) {
          if (!done(p)) {
            p.status = "explained";
            p.method = "explained";
            p.lastAt = now;
          }
        }
        state.explanationConfirms[stage.id] ??= {};
        delete state.explanationConfirms[stage.id][target];
      }
      unlock(stage, progress);
      result = { target_role: target, level };
      metadata = {
        target_role: target,
        level: level!,
        penalty: stage.scoring.enabled ? penalty : 0,
      };
      break;
    }
    case "select-alt-mode": {
      stageAction();
      phase("playing", "mission");
      commander();
      if (stage.id !== "yongbong" || cmd.mode_id !== "outdoor" ||
        !stage.altModes?.some((mode) => mode.id === cmd.mode_id)) {
        fail("BAD_REQUEST", "현재 거점에서 허용된 외부 대체 모드를 선택하라.");
      }
      state.altMode ??= {};
      state.altMode[stage.id] = "outdoor";
      result = { visit: visitV2(stage, state) };
      metadata = { mode_id: "outdoor" };
      break;
    }
    case "submit-report": {
      stageAction();
      phase("playing", "mission");
      const role = member!.role!, rp = progress[role];
      prepared(course, stage);
      if (
        !stage.roles[role]!.steps.every((s) =>
          done(rp.steps[s.id]) && requirements(s, progress)
        )
      ) fail("REPORTS_REQUIRED", "본인 조사와 선행 보고를 완료하라.");
      rp.reported = true;
      // No digit in result or events; only this caller's self.digit may expose it.
      unlock(stage, progress);
      result = { reported: true };
      break;
    }
    case "confirm-explanation": {
      stageAction();
      phase("playing", "mission");
      const role = member!.role!;
      prepared(course, stage);
      if (!Object.values(progress[role].steps).every(done)) {
        fail(
          "EXPLANATION_REQUIRED",
          "본인 문제의 해설 공개 조건을 먼저 충족하라.",
        );
      }
      state.explanationConfirms[stage.id] ??= {};
      state.explanationConfirms[stage.id][role] ??= now;
      result = { confirmed: true };
      break;
    }
    case "open-after-explanation": {
      stageAction();
      phase("playing", "mission");
      commander();
      reports();
      if (
        !ROLES.every((r) =>
          state.explanationConfirms[stage.id]?.[r] !== undefined
        )
      ) fail("EXPLANATION_REQUIRED", "전원의 해설 읽음 확인이 필요하다.");
      result = finish(game, course, now, "explained");
      metadata = { method: "explained" };
      break;
    }
    case "open-lock": {
      stageAction();
      phase("playing", "mission");
      commander();
      reports();
      const privateStage = prepared(course, stage);
      if (stage.completion.type !== "lock") {
        fail("WRONG_PHASE", "자물쇠 단계가 아니다.");
      }
      if (
        !Array.isArray(cmd.digits) || cmd.digits.length !== 4 ||
        !cmd.digits.every((n) => Number.isInteger(n) && n >= 0 && n <= 9)
      ) fail("BAD_REQUEST", "네 자리 숫자를 입력하라.");
      const lock = game.locks[stage.id] ??= blankLock();
      if (lock.attempts >= 3 && now < (lock.nextAttemptAt ?? Infinity)) {
        fail(
          "COOLDOWN",
          "다음 시도까지 기다리라.",
          lock.nextAttemptAt ?? undefined,
        );
      }
      if (lock.digits.some((n, i) => n !== null && n !== cmd.digits![i])) {
        fail("BAD_REQUEST", "이미 잠긴 숫자는 변경할 수 없다.");
      }
      lock.attempts++;
      const mask = stage.completion.order.map((r, i) =>
        cmd.digits![i] === privateStage.roles[r]!.digit
      );
      mask.forEach((ok, i) => {
        if (ok) lock.digits[i] = cmd.digits![i];
      });
      const opened = mask.every(Boolean);
      if (opened) {
        result = {
          ...finish(game, course, now, "field"),
          ok: true,
          correct_mask: mask,
        };
      } else {
        game.score = Math.max(0, game.score - 10);
        if (lock.attempts >= 3) lock.nextAttemptAt = now + 60000;
        result = { ok: false, correct_mask: mask };
      }
      metadata = { opened, attempts: lock.attempts };
      break;
    }
    case "depart-next-site": {
      stageAction();
      phase("playing", "cleared");
      commander();
      const index = state.stageIndex + 1, next = course.stages[index];
      if (!next || !["mission", "memorial", "epilogue"].includes(next.kind)) {
        fail("NO_STAGE", "다음 단계 연결이 필요하다.");
      }
      prepared(course, next);
      state.stageIndex = index;
      state.stagePhase = "travel";
      state.progress[next.id] = roleProgress(next);
      game.siteIndex++;
      game.phase = "travel";
      game.siteStartedAt = now;
      break;
    }
  }
  member!.lastSeen = now;
  game.version++;
  game.receipts[key] = { hash, result: structuredClone(result) };
  events.push({
    request_id: cmd.request_id!,
    at: now,
    actor_member: member!.id,
    role: member!.role,
    action: cmd.action,
    stage_id: stage.id,
    data: metadata,
  });
  return result;
}
