import { describe, expect, it } from "vitest";
import { prepareReviewSeed, REVIEW_DEV_PROJECT_REF } from "../scripts/seed-review-course";
import { fullDemoV2Input } from "../supabase/functions/_shared/wall-bongji-course-v2";
import { assertEdgeCourseAllowed } from "../supabase/functions/_shared/deployment";
import { allowsSimulatedArrival } from "../supabase/functions/_shared/arrival-policy";
import { answerHashV2 } from "../supabase/functions/_shared/answer-v2";
import { projectStageV2 } from "../supabase/functions/_shared/project-course-v2";
import { ROLES } from "../supabase/functions/_shared/types";

// Synthetic fixtures only. Tests never read private authoring files or deployed credentials.
function setup() {
  const source = fullDemoV2Input("jnu-demo-dev-test-source", "confirm");
  source.content.demo = false; source.privateInput.synthetic = false;
  const before = structuredClone(source);
  const args = ["--dev-project-ref", REVIEW_DEV_PROJECT_REF, "--course-id", "jnu-demo-dev-review-test", "content.json", "answers.json"];
  const env = { NEXT_PUBLIC_SUPABASE_URL: `https://${REVIEW_DEV_PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key", ANSWER_SALT: crypto.randomUUID() };
  const load = (path: string) => Promise.resolve(path === "content.json" ? source.content : source.privateInput);
  return { source, before, args, env, load };
}

describe("private content dev review registration preparation", () => {
  it("creates a separate dev copy without changing the authoring input or GPS", async () => {
    const t = setup(), { course } = await prepareReviewSeed(t.args, t.env, t.load);
    expect(t.source).toEqual(t.before);
    expect(course).toMatchObject({ id: "jnu-demo-dev-review-test", demo: true, confirmed: false });
    expect(course.name).toContain("개발 검수");
    for (const stage of course.stages) {
      expect(stage.arrival).toMatchObject({ mode: "none", confirmed: false, require: "all", lat: null, lng: null });
      expect(allowsSimulatedArrival(course, stage.arrival)).toBe(true);
    }
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow();
    expect(() => assertEdgeCourseAllowed(course, "false")).toThrow();
    expect(() => assertEdgeCourseAllowed(course, "true")).not.toThrow();
  });
  it("uses the supplied salt and new revision to hash; keeps private fields out of initial responses", async () => {
    const t = setup(), { course } = await prepareReviewSeed(t.args, t.env, t.load);
    const stage = course.stages.find((s) => s.id === "gate")!, step = stage.roles.signal!.steps.find((s) => s.type === "frequency")!;
    expect(course.private.stages.gate.steps[step.id].answerHash).toBe(await answerHashV2(t.env.ANSWER_SALT, course.id, step,
      t.source.privateInput.stages.gate.steps[step.id].answer!));
    for (const role of ROLES) {
      const projected = projectStageV2(course, "gate", role);
      expect(JSON.stringify(projected)).not.toMatch(/"(answerHash|private|hints|explanation)"/);
      if (role !== "commander") expect(projected.self).not.toHaveProperty("transfer_clue");
    }
  });
  it("changes the review wall only with the explicit tribute option and leaves the original untouched", async () => {
    const t = setup();
    const oldReview = await prepareReviewSeed(t.args, t.env, t.load);
    const { course } = await prepareReviewSeed([...t.args, "--wall-mode", "tribute"], t.env, t.load);
    expect(oldReview.course.stages.find((stage) => stage.id === "wall")!.completion.type).toBe("confirm");
    expect(course.stages.find((stage) => stage.id === "wall")).toMatchObject({
      completion: { type: "tribute" }, quiet: true, scoring: { enabled: false }, arrival: { mode: "none", require: "all" },
    });
    expect(course.stages.find((stage) => stage.id === "wall")).not.toHaveProperty("recordTemplate");
    for (const stage of course.stages.filter((stage) => stage.id !== "wall")) {
      expect(stage).toEqual(oldReview.course.stages.find((other) => other.id === stage.id));
      expect(course.private.stages[stage.id]).toEqual(oldReview.course.private.stages[stage.id]);
    }
    expect(Object.keys(course.private.stages.wall.steps)).toHaveLength(4);
    for (const step of Object.values(course.private.stages.wall.steps)) expect(Object.keys(step)).toEqual(["explanation"]);
    expect(t.source).toEqual(t.before);
    let reads = 0;
    await expect(prepareReviewSeed([...t.args, "--wall-mode", "unknown"], t.env, async () => { reads++; return null; })).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it("rejects another project or URL and non-review or overlong identifiers before reading input", async () => {
    const t = setup();
    let reads = 0; const load = () => { reads++; return Promise.resolve(null); };
    for (const args of [t.args.map((v) => v === REVIEW_DEV_PROJECT_REF ? "abcdefghijklmnopqrst" : v),
      t.args.map((v) => v === "jnu-demo-dev-review-test" ? "jnu-official-r1" : v),
      t.args.map((v) => v === "jnu-demo-dev-review-test" ? "jnu-demo-dev-review-" + "x".repeat(40) : v)]) {
      await expect(prepareReviewSeed(args, t.env, load)).rejects.toThrow();
    }
    await expect(prepareReviewSeed(t.args, { ...t.env, NEXT_PUBLIC_SUPABASE_URL: "https://other.example.com" }, load)).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it("requires matching real source envelopes, a salt, and credentials only for insertion", async () => {
    const t = setup();
    await expect(prepareReviewSeed(t.args, { ...t.env, ANSWER_SALT: "short" }, t.load)).rejects.toThrow();
    await expect(prepareReviewSeed(t.args, { ...t.env, SUPABASE_SERVICE_ROLE_KEY: "" }, t.load)).rejects.toThrow();
    expect((await prepareReviewSeed(["--validate-only", ...t.args], { ...t.env, SUPABASE_SERVICE_ROLE_KEY: "" }, t.load)).validateOnly).toBe(true);
    t.source.privateInput.courseId = "different-source";
    await expect(prepareReviewSeed(t.args, t.env, t.load)).rejects.toThrow();
    t.source.privateInput.courseId = t.source.content.id; t.source.content.demo = true;
    await expect(prepareReviewSeed(t.args, t.env, t.load)).rejects.toThrow();
  });
});
