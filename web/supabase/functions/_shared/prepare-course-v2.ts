import { answerHashV2 } from "./answer-v2.ts";
import { ROLES } from "./types.ts";
import type {
  CourseV2,
  CourseV2Content,
  FieldSpec,
  Grading,
  Role,
  RoleMission,
  RolePrivate,
  SceneText,
  Stage,
  StagePrivate,
  Step,
  StepAnswer,
  StepPrivate,
  StepType,
} from "./types.ts";

type Obj = Record<string, unknown>;
function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}
function obj(value: unknown, path: string): Obj {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return fail(path, "객체가 필요하다.");
  return value as Obj;
}
function keys(value: Obj, allowed: string[], path: string) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) {
    fail(path, "허용하지 않은 필드가 있다.");
  }
}
function exact(value: Obj, expected: string[], path: string) {
  keys(value, expected, path);
  if (expected.some((k) => !Object.hasOwn(value, k))) {
    fail(path, "필수 역할 또는 항목이 빠졌다.");
  }
}
function str(value: unknown, path: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max) {
    return fail(path, "비어 있지 않은 문자열이 필요하다.");
  }
  return value;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "boolean이 필요하다.");
  return value;
}
function num(value: unknown, path: string, min: number, max: number): number {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < min ||
    value > max
  ) return fail(path, "수치 범위를 확인하라.");
  return value;
}
function integer(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) return fail(path, "정수가 필요하다.");
  return n;
}
function one<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(path, "허용된 값이 아니다.");
  }
  return value as T;
}
function arr(value: unknown, path: string, min = 0, max = 100): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return fail(path, "목록 길이를 확인하라.");
  }
  return value;
}
function strings(value: unknown, path: string, min = 0, max = 100): string[] {
  return arr(value, path, min, max).map((v) => str(v, path));
}
function unique(values: string[], path: string) {
  if (new Set(values).size !== values.length) {
    fail(path, "중복 ID 또는 항목이 있다.");
  }
}
function id(value: unknown, path: string, step = false): string {
  const s = str(value, path, 80);
  // Distinct course (lowercase) / step (uppercase scene) namespaces also delimit the v2 hash inputs.
  if (
    !(step ? /^[A-Z]-\d{2}\.[a-z][a-z0-9-]*$/ : /^[a-z][a-z0-9_-]{0,39}$/).test(
      s,
    )
  ) fail(path, "ID 형식이 유효하지 않다.");
  return s;
}
function optionalNote(o: Obj, path: string): { note?: string } {
  return o.note === undefined ? {} : { note: str(o.note, path) };
}
function https(value: unknown, path: string): string {
  const s = str(value, path);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail(path, "HTTPS 주소가 필요하다.");
  }
  if (u.protocol !== "https:" || u.username || u.password) {
    fail(path, "HTTPS 주소가 필요하다.");
  }
  return s;
}
function scene(value: unknown): SceneText {
  const o = obj(value, "scene");
  exact(o, ["id", "channel", "text", "trigger"], "scene");
  return {
    id: str(o.id, "scene.id", 80),
    channel: one(o.channel, ["narration", "guide", "screen"], "scene.channel"),
    text: str(o.text, "scene.text"),
    trigger: one(o.trigger, [
      "enter",
      "role-reveal",
      "ready",
      "retry",
      "role-complete",
      "reports-ready",
      "stage-complete",
      "scout-reported",
    ], "scene.trigger"),
  };
}
function fields(value: unknown): FieldSpec[] {
  const result = arr(value, "fields", 1, 30).map((v) => {
    const o = obj(v, "field");
    exact(o, ["id", "label", "required", "maxLen"], "field");
    return {
      id: id(o.id, "field.id"),
      label: str(o.label, "field.label"),
      required: bool(o.required, "field.required"),
      maxLen: integer(o.maxLen, "field.maxLen", 1, 300),
    };
  });
  unique(result.map((f) => f.id), "fields");
  return result;
}
const compatible: Record<StepType, Grading[]> = {
  truefalse: ["hash"],
  order: ["order-hash"],
  match: ["map-hash"],
  choice: ["hash"],
  "multi-choice": ["set-hash"],
  frequency: ["hash"],
  words: ["set-hash"],
  "spot-correct": ["set-hash"],
  text: ["hash", "record", "open"],
  observation: ["hash", "record"],
  "record-form": ["record"],
  "fill-blank": ["record", "open"],
  confirm: ["confirm"],
};
function step(value: unknown, production: boolean, sourceIds: string[]): Step {
  const o = obj(value, "step");
  keys(o, [
    "id",
    "confirmed",
    "type",
    "prompt",
    "choices",
    "statements",
    "fields",
    "requires",
    "requiresReports",
    "grading",
    "sourceRequired",
    "sourceIds",
    "answerCount",
    "maxLen",
    "note",
  ], "step");
  const s: Step = {
    id: id(o.id, "step.id", true),
    confirmed: bool(o.confirmed, "step.confirmed"),
    type: one(o.type, Object.keys(compatible) as StepType[], "step.type"),
    prompt: str(o.prompt, "step.prompt"),
    grading: one(o.grading, [
      "hash",
      "set-hash",
      "order-hash",
      "map-hash",
      "record",
      "open",
      "confirm",
    ], "step.grading"),
    ...optionalNote(o, "step.note"),
  };
  if (production && !s.confirmed) {
    fail(s.id, "문항 confirmed=true 확정이 필요하다.");
  }
  if (!compatible[s.type].includes(s.grading)) {
    fail(s.id, "유형과 채점 방식이 맞지 않는다.");
  }
  if (o.choices !== undefined) {
    s.choices = strings(o.choices, s.id, 1, 100);
    unique(s.choices, s.id);
  }
  if (
    ["order", "match", "choice", "multi-choice", "spot-correct"].includes(
      s.type,
    ) && !s.choices
  ) fail(s.id, "선택지가 필요하다.");
  if (o.statements !== undefined) {
    s.statements = strings(o.statements, s.id, 1, 20);
  }
  if (s.type === "truefalse" && !s.statements) {
    fail(s.id, "진위 문장이 필요하다.");
  }
  if (o.fields !== undefined) s.fields = fields(o.fields);
  if (["match", "record-form"].includes(s.type) && !s.fields) {
    fail(s.id, "입력 필드가 필요하다.");
  }
  if (o.requires !== undefined) {
    s.requires = arr(o.requires, s.id).map((v) => {
      const r = obj(v, s.id);
      exact(r, ["role", "stepId"], s.id);
      return {
        role: one(r.role, ROLES, s.id),
        stepId: id(r.stepId, s.id, true),
      };
    });
  }
  if (o.requiresReports !== undefined) {
    s.requiresReports = arr(o.requiresReports, s.id, 1, 4).map((v) =>
      one(v, ROLES, s.id)
    );
    unique(s.requiresReports, s.id);
  }
  if (o.sourceRequired !== undefined) {
    s.sourceRequired = bool(o.sourceRequired, s.id);
  }
  if (o.sourceIds !== undefined) {
    s.sourceIds = strings(o.sourceIds, s.id, 1);
    if (s.sourceIds.some((i) => !sourceIds.includes(i))) {
      fail(s.id, "출처 ID가 존재하지 않는다.");
    }
  }
  if (o.answerCount !== undefined) {
    s.answerCount = integer(o.answerCount, s.id, 1, s.choices?.length ?? 100);
  }
  s.maxLen = o.maxLen === undefined ? 300 : integer(o.maxLen, s.id, 1, 300); // 기본값 적용 — 확정 필요(D1)
  return s;
}

export function validateCourseV2Content(input: unknown): CourseV2Content {
  const o = obj(input, "course");
  keys(o, [
    "schemaVersion",
    "id",
    "name",
    "confirmed",
    "demo",
    "sources",
    "settings",
    "stages",
    "note",
  ], "course");
  if (o.schemaVersion !== 2) fail("course", "schemaVersion=2가 필요하다.");
  const demo = bool(o.demo, "course.demo"),
    confirmed = bool(o.confirmed, "course.confirmed");
  if (!demo && !confirmed) {
    fail("course", "운영 코스 confirmed=true 확정이 필요하다.");
  }
  const courseId = id(o.id, "course.id");
  if (demo && (confirmed || !/^jnu-demo-dev-/.test(courseId))) {
    fail("course", "시연은 confirmed=false, dev 전용 ID가 필요하다.");
  }
  const sources = arr(o.sources, "sources", 1, 30).map((v) => {
    const a = obj(v, "source");
    exact(a, ["id", "title", "url"], "source");
    return {
      id: str(a.id, "source.id", 40),
      title: str(a.title, "source.title"),
      url: https(a.url, "source.url"),
    };
  });
  unique(sources.map((s) => s.id), "sources");
  const settings = obj(o.settings, "settings");
  exact(
    settings,
    ["teamSize", "roleSwapEnabled", "roleSwapSeconds", "note"],
    "settings",
  );
  if (settings.teamSize !== 4 || settings.roleSwapSeconds !== 30) {
    fail("settings", "4인·30초 설정이 필요하다."); // 기본값 적용 — 확정 필요(D7)
  }
  const seen = new Set<string>();
  const stages: Stage[] = arr(o.stages, "stages", 1, 30).map((value, index) => {
    const a = obj(value, "stage");
    keys(a, [
      "id",
      "seq",
      "kind",
      "name",
      "confirmed",
      "arrival",
      "quiet",
      "scoring",
      "narration",
      "roles",
      "completion",
      "sacho",
      "altModes",
    ], "stage");
    const stageId = id(a.id, "stage.id");
    if (seen.has(stageId)) fail(stageId, "중복 ID가 있다.");
    seen.add(stageId);
    if (a.seq !== index + 1) {
      fail(stageId, "seq는 배열 순서대로 1부터 연속이어야 한다.");
    }
    const stageConfirmed = bool(a.confirmed, stageId);
    if (!demo && !stageConfirmed) fail(stageId, "단계 확정이 필요하다.");
    const r = obj(a.arrival, stageId);
    keys(r, [
      "mode",
      "confirmed",
      "require",
      "lat",
      "lng",
      "radiusM",
      "noticeM",
      "dwellSec",
      "note",
    ], stageId);
    const arrival: Stage["arrival"] = {
      mode: one(r.mode, ["gps", "qr", "manual", "none"], stageId),
      confirmed: bool(r.confirmed, stageId),
      require: one(r.require, ["all", "any"], stageId),
      lat: r.lat === null ? null : num(r.lat, stageId, -90, 90),
      lng: r.lng === null ? null : num(r.lng, stageId, -180, 180),
      ...optionalNote(r, stageId),
    };
    if ((arrival.lat === null) !== (arrival.lng === null)) {
      fail(stageId, "좌표 쌍을 확인하라.");
    }
    if (!demo && !arrival.confirmed) {
      fail(stageId, "도착 좌표·설정 확정이 필요하다.");
    }
    if (!demo && arrival.mode === "gps" && arrival.lat === null) {
      fail(stageId, "GPS 좌표를 확정하라.");
    }
    for (const k of ["radiusM", "noticeM", "dwellSec"] as const) {
      if (r[k] !== undefined) {
        arrival[k] = num(
          r[k],
          stageId,
          k === "radiusM" ? 5 : 0,
          k === "dwellSec" ? 120 : 200,
        );
      }
    }
    if (
      arrival.mode === "gps" &&
      (arrival.radiusM === undefined || arrival.noticeM === undefined ||
        arrival.dwellSec === undefined || arrival.noticeM < arrival.radiusM)
    ) fail(stageId, "GPS 도착 범위·안내 거리·체류 시간이 필요하다.");
    const q = obj(a.scoring, stageId);
    keys(
      q,
      ["enabled", "confirmed", "hintPenalty", "noHintBonus", "note"],
      stageId,
    );
    const penalties = obj(q.hintPenalty, stageId);
    exact(penalties, ["1", "2", "3"], stageId);
    const nullableScore = (v: unknown) =>
      v === null ? null : num(v, stageId, 0, 1000);
    const scoring: Stage["scoring"] = {
      enabled: bool(q.enabled, stageId),
      confirmed: bool(q.confirmed, stageId),
      hintPenalty: {
        1: nullableScore(penalties[1]),
        2: nullableScore(penalties[2]),
        3: nullableScore(penalties[3]),
      },
      noHintBonus: nullableScore(q.noHintBonus),
      ...optionalNote(q, stageId),
    };
    if (
      !demo &&
      (!scoring.confirmed ||
        Object.values(scoring.hintPenalty).includes(null) ||
        scoring.noHintBonus === null)
    ) fail(stageId, "점수·힌트 수치 확정이 필요하다.");
    if (scoring.hintPenalty[1] !== 0) {
      fail(stageId, "힌트 1단계는 감점이 없다.");
    }
    if (
      !scoring.enabled &&
      (Object.values(scoring.hintPenalty).some((v) => v !== 0) ||
        scoring.noHintBonus !== 0)
    ) fail(stageId, "점수 비활성 단계의 점수는 0이어야 한다.");
    const rolesInput = obj(a.roles, stageId);
    exact(rolesInput, [...ROLES], stageId);
    const roles = {} as Stage["roles"];
    for (const role of ROLES) {
      if (rolesInput[role] === null) {
        roles[role] = null;
        continue;
      }
      const m = obj(rolesInput[role], `${stageId}/${role}`);
      keys(
        m,
        ["intro", "scenes", "steps", "digit", "asset"],
        `${stageId}/${role}`,
      );
      const mission: RoleMission = {
        intro: scene(m.intro),
        scenes: arr(m.scenes, stageId).map(scene),
        steps: arr(m.steps, stageId, 1, 30).map((v) =>
          step(v, !demo, sources.map((s) => s.id))
        ),
        digit: bool(m.digit, stageId),
      };
      if (m.asset !== undefined) {
        const asset = obj(m.asset, stageId);
        exact(asset, ["url", "alt", "confirmed"], stageId);
        mission.asset = {
          url: asset.url === null ? null : https(asset.url, stageId),
          alt: str(asset.alt, stageId),
          confirmed: bool(asset.confirmed, stageId),
        };
        if (!demo && (!mission.asset.confirmed || !mission.asset.url)) {
          fail(stageId, "사진 자료·사용 권한 확정이 필요하다.");
        }
      }
      roles[role] = mission;
    }
    const c = obj(a.completion, stageId);
    let completion: Stage["completion"];
    if (c.type === "lock") {
      exact(c, ["type", "order"], stageId);
      const order = arr(c.order, stageId, 4, 4).map((v) =>
        one(v, ROLES, stageId)
      );
      unique(order, stageId);
      if (ROLES.some((role) => !roles[role]?.digit)) {
        fail(stageId, "잠금 단계에는 네 역할·완료 숫자 설정이 필요하다.");
      }
      completion = { type: "lock", order };
    } else if (c.type === "confirm") {
      exact(c, ["type", "labels"], stageId);
      const labels = obj(c.labels, stageId);
      exact(labels, [...ROLES], stageId);
      completion = {
        type: "confirm",
        labels: Object.fromEntries(
          ROLES.map((role) => [role, str(labels[role], stageId)]),
        ) as Record<Role, string>,
      };
    } else {
      exact(c, ["type"], stageId);
      if (c.type !== "joint-record") {
        fail(stageId, "완료 유형이 유효하지 않다.");
      }
      completion = { type: "joint-record" };
    }
    const stage: Stage = {
      id: stageId,
      seq: index + 1,
      name: str(a.name, stageId),
      confirmed: stageConfirmed,
      kind: one(
        a.kind,
        ["prologue", "mission", "memorial", "epilogue"],
        stageId,
      ),
      arrival,
      quiet: bool(a.quiet, stageId),
      scoring,
      narration: arr(a.narration, stageId).map(scene),
      roles,
      completion,
    };
    if (
      stage.kind === "memorial" &&
      (!stage.quiet || scoring.enabled || completion.type === "lock" ||
        ROLES.some((role) => roles[role]?.digit))
    ) fail(stageId, "추모 단계에는 점수·숫자·자물쇠를 둘 수 없다.");
    if (a.sacho !== undefined) {
      const s = obj(a.sacho, stageId);
      exact(s, ["id", "name", "sections"], stageId);
      stage.sacho = {
        id: id(s.id, stageId),
        name: str(s.name, stageId),
        sections: strings(s.sections, stageId, 1),
      };
    }
    if (a.altModes !== undefined) {
      stage.altModes = arr(a.altModes, stageId, 1).map((v) => {
        const t = obj(v, stageId);
        exact(t, ["id", "label"], stageId);
        return { id: id(t.id, stageId), label: str(t.label, stageId) };
      });
    }
    return stage;
  });
  validateDependencies(stages);
  const result: CourseV2Content = {
    schemaVersion: 2,
    id: courseId,
    name: str(o.name, "course.name"),
    confirmed,
    demo,
    sources,
    settings: {
      teamSize: 4,
      roleSwapEnabled: bool(settings.roleSwapEnabled, "settings"),
      roleSwapSeconds: 30,
      note: str(settings.note, "settings"),
    },
    stages,
    ...optionalNote(o, "course.note"),
  };
  if (!demo && /TODO|확인필요|TBD/.test(JSON.stringify(result))) {
    fail("course", "미확정 문구를 확정하라.");
  }
  return result;
}

function validateDependencies(stages: Stage[]) {
  const nodes = new Map<string, { step: Step; role: Role; stage: Stage }>();
  for (const stage of stages) {
    for (const role of ROLES) {
      for (const step of stage.roles[role]?.steps ?? []) {
        if (nodes.has(step.id)) fail(step.id, "중복 단계 ID가 있다.");
        nodes.set(step.id, { step, role, stage });
      }
    }
  }
  const graph = new Map<string, string[]>();
  for (const [id, node] of nodes) {
    const edges = (node.step.requires ?? []).map((ref) => {
      const target = nodes.get(ref.stepId);
      if (
        !target || target.role !== ref.role || target.stage.id !== node.stage.id
      ) fail(id, "requires 대상·역할·거점이 유효하지 않다.");
      return ref.stepId;
    });
    for (const role of node.step.requiresReports ?? []) {
      const mission = node.stage.roles[role];
      if (!mission) fail(id, "보고를 받을 역할이 없다.");
      edges.push(...mission.steps.map((s) => s.id));
    }
    unique(edges, id);
    graph.set(id, edges);
  }
  const active = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) fail(id, "requires/보고 조건에 순환이 있다.");
    if (done.has(id)) return;
    active.add(id);
    for (const next of graph.get(id) ?? []) visit(next);
    active.delete(id);
    done.add(id);
  };
  for (const id of graph.keys()) visit(id);
}

export async function prepareCourseV2(
  input: unknown,
  privateInput: unknown,
  salt: string,
): Promise<CourseV2> {
  if (salt.length < 32) fail("ANSWER_SALT", "32자 이상이어야 한다.");
  const course = validateCourseV2Content(input);
  const p = obj(privateInput, "private");
  exact(p, ["schemaVersion", "courseId", "synthetic", "stages"], "private");
  if (p.schemaVersion !== 2 || p.courseId !== course.id) {
    fail("private", "코스 버전·ID가 일치하지 않는다.");
  }
  const synthetic = bool(p.synthetic, "private.synthetic");
  if (synthetic !== course.demo) {
    fail("private", "합성 예시는 운영 코스에 사용할 수 없다.");
  }
  if (!course.demo && /TODO|확인필요|TBD/.test(JSON.stringify(p))) {
    fail("private", "비공개 자료의 미확정 값을 확정하라.");
  }
  const rawStages = obj(p.stages, "private.stages");
  exact(rawStages, course.stages.map((s) => s.id), "private.stages");
  const stages: Record<string, StagePrivate> = {};
  for (const stage of course.stages) {
    const raw = obj(rawStages[stage.id], stage.id);
    exact(raw, ["roles", "steps"], stage.id);
    const rawRoles = obj(raw.roles, stage.id);
    exact(rawRoles, [...ROLES], stage.id);
    const rawSteps = obj(raw.steps, stage.id);
    exact(
      rawSteps,
      ROLES.flatMap((role) => stage.roles[role]?.steps.map((s) => s.id) ?? []),
      stage.id,
    );
    const roles = {} as StagePrivate["roles"],
      steps: StagePrivate["steps"] = {};
    for (const role of ROLES) {
      const mission = stage.roles[role];
      if (!mission) {
        if (rawRoles[role] !== null) {
          fail(stage.id, "없는 역할의 비공개 자료가 있다.");
        }
        roles[role] = null;
        continue;
      }
      const a = obj(rawRoles[role], `${stage.id}/${role}`);
      keys(a, ["digit", "hints", "transferClue"], `${stage.id}/${role}`);
      const rolePrivate: RolePrivate = {
        hints: strings(a.hints, "private.hints", 3, 3) as [
          string,
          string,
          string,
        ],
      };
      if (mission.digit) {
        rolePrivate.digit = integer(a.digit, "private.digit", 0, 9);
      } else if (a.digit !== undefined) {
        fail(stage.id, "완료 숫자를 쓰지 않는 역할이다.");
      }
      if (a.transferClue !== undefined) {
        if (role !== "commander") {
          fail(stage.id, "전달형 개인 단서는 지휘관에게만 허용한다.");
        }
        const c = obj(a.transferClue, "private.transferClue");
        exact(
          c,
          ["kind", "label", "value", "targetStepId"],
          "private.transferClue",
        );
        const target = stage.roles.signal?.steps.find((s) =>
          s.id === c.targetStepId && s.type === "frequency"
        );
        if (c.kind !== "relay-frequency" || !target) {
          fail(
            stage.id,
            "전달형 단서는 같은 거점의 통신원 주파수 단계에 연결해야 한다.",
          );
        }
        const targetPrivate = obj(rawSteps[target.id], "private.transferClue");
        const value = str(c.value, "private.transferClue", 20);
        if (
          await answerHashV2(salt, course.id, target, value) !==
            await answerHashV2(
              salt,
              course.id,
              target,
              targetPrivate.answer as StepAnswer,
            )
        ) fail(stage.id, "전달형 단서와 통신원 검증값이 일치하지 않는다.");
        rolePrivate.transferClue = {
          kind: "relay-frequency",
          label: str(c.label, "private.transferClue"),
          value,
          targetStepId: target.id,
        };
      }
      roles[role] = rolePrivate;
      for (const step of mission.steps) {
        const b = obj(rawSteps[step.id], step.id);
        keys(b, ["answer", "rubric", "explanation", "reward"], step.id);
        const prepared: StepPrivate = {
          explanation: str(b.explanation, "private.explanation"),
        };
        if (step.grading.includes("hash")) {
          prepared.answerHash = await answerHashV2(
            salt,
            course.id,
            step,
            b.answer as StepAnswer,
          );
        } else if (b.answer !== undefined) {
          fail(step.id, "자유 서술·확인에는 고정 정답을 둘 수 없다.");
        }
        if (b.rubric !== undefined) {
          if (!["record", "open"].includes(step.grading)) {
            fail(step.id, "rubric은 자유 서술용 필수 항목이다.");
          }
          const rubric = obj(b.rubric, step.id);
          exact(rubric, ["required"], step.id);
          const required = strings(rubric.required, step.id, 1);
          unique(required, step.id);
          const expected = (step.fields ?? []).filter((f) => f.required).map((
            f,
          ) => f.id);
          if (
            JSON.stringify([...required].sort()) !==
              JSON.stringify(expected.sort())
          ) {
            fail(step.id, "필수 항목은 공개 입력 필드와 일치해야 한다.");
          }
          prepared.rubric = { required };
        }
        if (b.reward !== undefined) {
          prepared.reward = str(b.reward, "private.reward");
        }
        steps[step.id] = prepared;
      }
    }
    if (
      stage.roles.signal?.steps.some((s) => s.type === "frequency") &&
      !roles.commander?.transferClue
    ) fail(stage.id, "지휘관 전달형 주파수 단서가 필요하다.");
    stages[stage.id] = { roles, steps };
  }
  return { ...course, private: { stages } };
}
