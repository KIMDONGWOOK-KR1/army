import { describe, expect, it } from "vitest";
import { fullTeam } from "./helpers/full-v2";
import { fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { prepareCourseV2, validateCourseV2Content } from "../supabase/functions/_shared/prepare-course-v2";
import { prepareWallTributeV2 } from "../supabase/functions/_shared/prepare-wall-tribute-v2";
import { prepareSeedCourse } from "../supabase/functions/_shared/prepare-seed-course";
import { projectPublicStageV2 } from "../supabase/functions/_shared/project-course-v2";
import { answerHashV2 } from "../supabase/functions/_shared/answer-v2";
import { ROLES, type Command, type CourseV2PrivateInput, type Role, type Stage } from "../supabase/functions/_shared/types";
import schemaSource from "../../docs/planning/data/courses/jnu-v2.course.json";
import schemaExample from "../../docs/planning/data/courses/jnu-v2.private.example.json";

const offer = (role: Role, stepId?: string): Command => ({
  action: "submit-step", step_id: stepId ?? { commander: "W-04.tribute", scout: "W-01.tribute", signal: "W-02.tribute", cipher: "W-03.tribute" }[role],
  answer: `start:${role}`,
});

const pulse = (role: Role) => ({ ...offer(role), answer: `hold:${role}` });
async function together(t: Awaited<ReturnType<typeof fullTeam>>, seconds: number) {
  for (let i=0; i<seconds; i++) { t.advance(1000); for (const r of ROLES) await t.call(r,pulse(r)); }
}
describe("four-person continuous hold tribute", () => {
  it("requires all arrivals, own role, and 15 seconds of overlap", async () => {
    const t=await fullTeam({wallMode:"tribute"});
    await expect(t.call("scout",offer("scout"))).rejects.toMatchObject({code:"WRONG_PHASE"});
    await t.arrive(); const score=t.game.score;
    await expect(t.call("scout",offer("commander"))).rejects.toMatchObject({code:"NO_STEP"});
    expect(await t.call("scout",{...offer("scout"),answer:"confirmed"})).toMatchObject({accepted:false,gathered:0});
    for (const r of ROLES.slice(0,3)) await t.call(r,offer(r));
    expect(t.view("scout").game.tribute!.started_at).toBeNull();
    for(let i=0;i<6;i++){t.advance(1000);for(const r of ROLES.slice(0,3))await t.call(r,pulse(r));}
    await t.call("cipher",offer("cipher"));
    expect(t.game.phase).toBe("mission");
    await together(t,14);expect(t.game.phase).toBe("mission");
    t.advance(1000);for(const r of ROLES.slice(0,3))await t.call(r,pulse(r));
    expect(t.game.phase).toBe("mission");
    const cmd={...pulse("cipher"),request_id:"final-hold"};const result=await t.call("cipher",cmd);
    expect(result).toMatchObject({accepted:true,opened:true});expect(t.game.phase).toBe("cleared");
    expect(t.game.score).toBe(score);expect(t.view("scout").game.report_mask).toEqual([true,true,true,true]);
    const version=t.game.version;expect(await t.call("cipher",cmd)).toEqual(result);expect(t.game.version).toBe(version);
    expect(JSON.stringify(t.events.filter(e=>e.stage_id==="wall"))).not.toMatch(/start:|hold:|release:/);
  });
  it("release resets the full duration and late pulses cannot resume it",async()=>{
    const t=await fullTeam({wallMode:"tribute"});await t.arrive();for(const r of ROLES)await t.call(r,offer(r));
    await together(t,10);
    await t.call("scout",{...offer("scout"),answer:"release:scout"});
    expect(t.view("scout").game.tribute!.started_at).toBeNull();
    await t.call("scout",pulse("scout"));expect(t.view("scout").game.tribute!.pressed[1]).toBe(false);
    await t.call("scout",offer("scout"));await together(t,14);expect(t.game.phase).toBe("mission");
    await together(t,1);expect(t.game.phase).toBe("cleared");
  });
  it("lost connection expires holding, including at the completion boundary",async()=>{
    const t=await fullTeam({wallMode:"tribute"});await t.arrive();for(const r of ROLES)await t.call(r,offer(r));
    await together(t,12);t.advance(4000);
    expect(t.view("scout").game.tribute!.pressed).toEqual([false,false,false,false]);
    for(const r of ROLES)await t.call(r,pulse(r));expect(t.game.phase).toBe("mission");
    expect(t.view("scout").game.tribute!.started_at).toBeNull();
  });
  it("a stale release cannot cancel a new physical press",async()=>{
    const t=await fullTeam({wallMode:"tribute"});await t.arrive();await t.call("scout",offer("scout"));
    await t.call("scout",{...offer("scout"),answer:"start:new"});
    await t.call("scout",{...offer("scout"),answer:"release:scout"});
    expect(t.view("scout").game.tribute!.pressed[1]).toBe(true);
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
