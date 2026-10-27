import { describe, expect, it } from "vitest";
import { fullTeam } from "./helpers/full-v2";
import { fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { prepareCourseV2, validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { prepareWallTributeV2 } from "../supabase/functions/_shared/prepare-wall-tribute-v2";
import { prepareSeedCourse } from "../supabase/functions/_shared/prepare-seed-course";
import { projectPublicStageV2 } from "../supabase/functions/_shared/project-course-v2";
import { answerHashV2 } from "../supabase/functions/_shared/answer-v2";
import { ROLES, type Command, type CourseV2PrivateInput, type Role, type Stage } from "../supabase/functions/_shared/types";
import schemaSource from "../../codex-handoff-v2/data/courses/jnu-v2.course.json";
import schemaExample from "../../codex-handoff-v2/data/courses/jnu-v2.private.example.json";

const offer = (role: Role, stepId?: string): Command => ({
  action: "submit-step", step_id: stepId ?? { commander: "W-04.tribute", scout: "W-01.tribute", signal: "W-02.tribute", cipher: "W-03.tribute" }[role],
  answer: "confirmed",
});

describe("four-person tribute", () => {
  it("waits for all arrivals and all four offerings, with no hints, reports, lock or shared draft", async () => {
    const t = await fullTeam({ wallMode: "tribute", evidence: false });
    const score = t.game.score;
    for (const role of ROLES.slice(0, 3)) await t.call(role, { action: "report-arrival", method: "simulated" });
    expect(t.view("scout").self.mission).toBeNull();
    const before = structuredClone(t.game);
    await expect(t.call("scout", offer("scout"))).rejects.toMatchObject({ code: "WRONG_PHASE" });
    expect(t.game).toEqual(before);
    await t.call("cipher", { action: "report-arrival", method: "simulated" });
    const view = t.view("scout");
    expect(view.stage.completion).toEqual({ type: "tribute", label: "국화 올리기" });
    expect(view.stage).not.toHaveProperty("recordTemplate");
    for (const action of ["request-hint", "submit-report", "draft-memorial-record", "confirm-stage", "submit-retro", "draft-joint-record", "consent-joint-record", "open-lock", "open-after-explanation", "confirm-explanation"]) {
      const before = structuredClone(t.game);
      await expect(t.call("commander", { action, level: 1, target_role: "scout" })).rejects.toMatchObject({ code: "WRONG_PHASE" });
      expect(t.game).toEqual(before);
    }
    await expect(t.call("scout", offer("commander"))).rejects.toMatchObject({ code: "NO_STEP" });
    await expect(t.call("scout", { ...offer("scout"), role: "commander" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await t.call("scout", { ...offer("scout"), answer: "unconfirmed" })).toMatchObject({ accepted: false });
    expect(t.view("scout").self.reported).toBe(false);
    for (const role of ROLES.slice(0, 3)) {
      await t.call(role, offer(role));
      expect(t.view(role).self).toMatchObject({ reported: true, digit: null, lock: null, hint_level: 0 });
      expect(t.game.phase).toBe("mission");
    }
    const command = { ...offer("cipher"), request_id: "tribute-final-once" };
    const result = await t.call("cipher", command);
    expect(result).toMatchObject({ accepted: true, opened: true, completion_type: "tribute", label: "헌화 완료" });
    expect(t.game.phase).toBe("cleared");
    expect(t.game.score).toBe(score);
    expect(t.game.v2!.memorialRecords).toBeUndefined();
    expect(t.game.locks.wall).toBeUndefined();
    expect(t.view("cipher").game.report_mask).toEqual([true, true, true, true]);
    expect(t.view("cipher").game.completion).toMatchObject({ completion_type: "tribute", label: result.label });
    expect(t.view("cipher").self.journal.find((entry) => entry.stage_id === "wall"))
      .toMatchObject({ completion_type: "tribute", label: result.label });
    expect(t.game.v2!.sacho.wall).toMatchObject({ sources: [], observations: [], eventRecords: [], eventOrder: [] });
    const version = t.game.version, events = t.events.length;
    expect(await t.call("cipher", command)).toEqual(result);
    expect(t.game.version).toBe(version); expect(t.events).toHaveLength(events);
    await expect(t.call("cipher", { ...command, answer: "other" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(JSON.stringify(t.events.filter((event) => event.stage_id === "wall"))).not.toMatch(/answer|confirmed|answerHash/);
    await t.depart();
    expect(t.view("cipher").game.stage_id).toBe("bongji");
    await t.arrive();
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `[합성] ${role} 회고` });
    await t.draft("draft-joint-record");
    for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 1 });
    expect(t.game.status).toBe("done");
    expect(t.view("cipher").self.result?.stages.find((stage) => stage.stage_id === "wall"))
      .toMatchObject({ completion_type: "tribute", completion: result.label });
  });

  it("replays the same offering and keeps independent new request IDs from offering twice", async () => {
    const t = await fullTeam({ wallMode: "tribute" }); await t.arrive();
    const command = { ...offer("scout"), request_id: "tribute-once" };
    await t.call("scout", command);
    const before = structuredClone(t.game), events = t.events.length;
    await t.call("scout", command);
    expect(t.game).toEqual(before); expect(t.events).toHaveLength(events);
    await t.call("scout", offer("scout"));
    expect(t.game.v2!.progress.wall.scout).toEqual(before.v2!.progress.wall.scout);
    expect(t.view("commander").game.report_mask.filter(Boolean)).toHaveLength(1);
    expect(t.game.phase).toBe("mission");
  });
});

describe("new tribute course revisions", () => {
  it("replaces only the wall in cloned authoring input and removes all old wall secrets", async () => {
    const source = fullDemoV2Input("jnu-demo-dev-wall-source", "confirm");
    const before = structuredClone(source);
    const converted = prepareWallTributeV2(source.content, source.privateInput);
    expect(source).toEqual(before);
    expect({ ...converted.content, stages: [] }).toEqual({ ...source.content, stages: [] });
    for (const stage of source.content.stages.filter((stage) => stage.id !== "wall")) {
      expect(converted.content.stages.find((other) => other.id === stage.id)).toEqual(stage);
      expect(converted.privateInput.stages[stage.id]).toEqual(source.privateInput.stages[stage.id]);
    }
    const oldWall = source.content.stages.find((stage) => stage.id === "wall")!;
    const wall = converted.content.stages.find((stage) => stage.id === "wall")!;
    expect(wall.arrival).toEqual(oldWall.arrival);
    expect(wall).toMatchObject({ quiet: true, confirmed: oldWall.confirmed, completion: { type: "tribute" },
      scoring: { enabled: false, hintPenalty: { 1: 0, 2: 0, 3: 0 }, noHintBonus: 0 } });
    expect(wall).not.toHaveProperty("recordTemplate");
    for (const role of ROLES) {
      expect(wall.roles[role]).toMatchObject({ digit: false, scenes: [], steps: [{ type: "confirm", grading: "confirm" }] });
      expect(wall.roles[role]!.steps).toHaveLength(1);
      expect(Object.keys(converted.privateInput.stages.wall.roles[role]!)).toEqual(["hints"]);
    }
    expect(Object.keys(converted.privateInput.stages.wall.steps)).toHaveLength(4);
    for (const step of Object.values(converted.privateInput.stages.wall.steps)) expect(Object.keys(step)).toEqual(["explanation"]);
    expect(prepareWallTributeV2(converted.content, converted.privateInput)).toEqual(converted);
    const course = await prepareCourseV2(converted.content, converted.privateInput, crypto.randomUUID());
    expect(projectPublicStageV2(course, "wall").completion.type).toBe("tribute");
    expect(course.stages[0].scoring.hintPenalty).toEqual(source.content.stages[0].scoring.hintPenalty);
  });

  it("requires one independent confirm per role, all arrivals, quiet mode and no score, digit or joint template", () => {
    const mutations: ((wall: Stage) => void)[] = [
      (wall) => { wall.kind = "mission"; },
      (wall) => { wall.arrival.require = "any"; },
      (wall) => { wall.quiet = false; },
      (wall) => { wall.scoring.enabled = true; },
      (wall) => { wall.roles.scout!.digit = true; },
      (wall) => { wall.roles.scout = null; },
      (wall) => { wall.roles.scout!.steps.push({ ...wall.roles.scout!.steps[0], id: "W-01.extra" }); },
      (wall) => { wall.roles.scout!.steps[0].requiresReports = ["commander"]; },
      (wall) => { wall.recordTemplate = { prompt: "[합성] 이전 양식", wordCount: 1, wordChoices: ["[합성] 낱말"] }; },
    ];
    for (const change of mutations) {
      const { content } = fullDemoV2Input("jnu-demo-dev-wall-invalid");
      change(content.stages.find((stage) => stage.id === "wall")!);
      expect(() => validateCourseV2Content(content)).toThrow();
    }
  });

  it("preserves a separately authored prologue and rejects unconfirmed official GPS", async () => {
    const { content, privateInput } = fullDemoV2Input("jnu-demo-dev-prologue-keep", "confirm");
    const prologue = structuredClone(schemaSource.stages.find((stage) => stage.kind === "prologue")) as Stage;
    expect(prologue).toBeDefined();
    content.stages.forEach((stage) => stage.seq++);
    content.stages.unshift(prologue);
    privateInput.stages[prologue.id] = structuredClone((schemaExample as unknown as CourseV2PrivateInput).stages[prologue.id]);
    const converted = prepareWallTributeV2(content, privateInput);
    expect(converted.content.stages.find((stage) => stage.id === prologue.id)).toEqual(prologue);
    expect(converted.privateInput.stages[prologue.id]).toEqual(privateInput.stages[prologue.id]);

    // Synthetic coordinates validate the official route without inventing field approval.
    const source = fullDemoV2Input("jnu-demo-dev-official-fixture", "confirm");
    source.content.id = source.privateInput.courseId = "synthetic-wall-official-r1";
    source.content.demo = false; source.content.confirmed = true; source.privateInput.synthetic = false;
    delete source.content.note;
    for (const stage of source.content.stages) {
      stage.confirmed = true;
      stage.arrival = { mode: "gps", confirmed: true, require: "all", lat: 1, lng: 2, radiusM: 10, noticeM: 25, dwellSec: 5 };
      stage.scoring.confirmed = true;
      stage.scoring.hintPenalty = stage.scoring.enabled ? { 1: 0, 2: 10, 3: 10 } : { 1: 0, 2: 0, 3: 0 };
      stage.scoring.noHintBonus = 0;
      delete stage.scoring.note;
      for (const role of ROLES) {
        const mission = stage.roles[role]!;
        if (mission.asset) mission.asset = { url: "https://example.com/synthetic.jpg", alt: "[합성] 그림", confirmed: true };
        for (const step of mission.steps) { step.confirmed = true; delete step.note; }
      }
    }
    const options = { wallMode: "tribute" as const, courseId: "synthetic-wall-official-r2" }, salt = crypto.randomUUID();
    const course = await prepareSeedCourse(source.content, source.privateInput, salt, options);
    if (!("stages" in course)) throw new Error("expected v2");
    expect(course).toMatchObject({ id: options.courseId, demo: false, confirmed: true });
    expect(course.stages.find((stage) => stage.id === "wall")!.arrival).toEqual(source.content.stages.find((stage) => stage.id === "wall")!.arrival);
    source.content.stages.find((stage) => stage.id === "wall")!.arrival.confirmed = false;
    await expect(prepareSeedCourse(source.content, source.privateInput, salt, options)).rejects.toThrow("도착 좌표·설정 확정");
  });

  it("requires an explicit new seed revision and hashes retained missions against that ID", async () => {
    const { content, privateInput } = fullDemoV2Input("jnu-demo-dev-wall-old", "confirm");
    const before = structuredClone({ content, privateInput }), salt = crypto.randomUUID();
    for (const courseId of [undefined, content.id]) {
      await expect(prepareSeedCourse(content, privateInput, salt, { wallMode: "tribute", courseId })).rejects.toThrow("새 course-id");
    }
    const legacy = await prepareSeedCourse(content, privateInput, salt);
    expect("stages" in legacy && legacy.stages.find((stage) => stage.id === "wall")!.completion.type).toBe("confirm");
    const course = await prepareSeedCourse(content, privateInput, salt, { wallMode: "tribute", courseId: "jnu-demo-dev-wall-new" });
    if (!("stages" in course)) throw new Error("expected v2");
    expect(course.stages.find((stage) => stage.id === "wall")!.completion.type).toBe("tribute");
    const step = course.stages.find((stage) => stage.id === "gate")!.roles.signal!.steps.find((step) => step.type === "frequency")!;
    const answer = privateInput.stages.gate.steps[step.id].answer!;
    expect(course.private.stages.gate.steps[step.id].answerHash).toBe(await answerHashV2(salt, course.id, step, answer));
    expect(course.private.stages.gate.steps[step.id].answerHash).not.toBe(await answerHashV2(salt, content.id, step, answer));
    expect({ content, privateInput }).toEqual(before);
  });
});
