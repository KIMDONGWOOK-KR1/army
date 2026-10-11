import { describe, expect, it } from "vitest";
import { team } from "./helpers/v2";
import { fullTeam } from "./helpers/full-v2";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { ROLES, type Command } from "../supabase/functions/_shared/types";

describe("missions without evidence metadata controls", () => {
  it("completes the existing full course without fabricating sources or verification methods", async () => {
    const t = await fullTeam({ evidence: false, confirmFixture: true });
    const storedCourse = structuredClone(t.course);
    const wall = t.course.stages.find((s) => s.id === "wall")!;
    expect(wall.roles.scout!.steps.some((s) => s.sourceRequired)).toBe(true);
    await t.arrive();
    expect(t.view("scout").self.mission!.steps.every((s) => s.sourceRequired === false)).toBe(true);
    await t.wallComplete();
    const cipherJournal = t.view("cipher").self.journal.find((j) => j.stage_id === "yongbong")!;
    expect(cipherJournal.shared_records?.[0]).toMatchObject({ status: "recorded", method: null, source: null });
    expect(cipherJournal.shared_records?.[0].record).not.toBeNull();
    for (const role of ROLES) {
      for (const journal of t.view(role).self.journal) {
        expect(journal.entries.every((entry) => entry.verified && entry.method === null && !entry.source)).toBe(true);
      }
      for (const other of ROLES.filter((r) => r !== role)) {
        expect(JSON.stringify(t.view(role))).not.toContain(`wall-${other} 비공개`);
      }
    }
    await t.depart(); await t.arrive();
    for (const role of ROLES) await t.call(role, { action: "submit-retro", text: `[합성] ${role} 회고` });
    await t.draft("draft-joint-record");
    for (const role of ROLES) await t.call(role, { action: "consent-joint-record", draft_version: 1 });
    expect(t.game.status).toBe("done");
    expect(t.view("scout").self.result).toMatchObject({ investigation: { completed: 3, total: 3 }, sacho: { completed: 3, total: 3 } });
    for (const stage of t.view("scout").self.result!.stages) {
      expect(stage.roles.every((r) => r.methods.length === 0 && r.explained === 0)).toBe(true);
    }
    for (const sacho of Object.values(t.game.v2!.sacho)) {
      expect(sacho.sources).toEqual([]);
      expect(sacho.eventOrder.every((entry) => entry.verified && entry.method === null)).toBe(true);
    }
    expect(t.events.filter((e) => e.action === "submit-step").length).toBeGreaterThan(0);
    for (const event of t.events.filter((e) => e.action === "submit-step")) {
      expect(Object.keys(event.data).sort()).toEqual(["accepted", "step_id"]);
    }
    expect(t.course).toEqual(storedCourse);
  });

  it("still grades answers and replays the same request only once without metadata", async () => {
    const t = await team();
    const request = { action: "submit-step", step_id: "G-03.freq", answer: "1.0", request_id: "without-evidence" };
    const beforeLock = structuredClone(t.game.locks), beforeScore = t.game.score;
    expect(await t.call("signal", request)).toMatchObject({ accepted: false });
    const version = t.game.version, count = t.events.length;
    await t.call("signal", request);
    expect(t.game.version).toBe(version);
    expect(t.events).toHaveLength(count);
    expect(t.game.v2!.progress.gate.signal.steps[request.step_id].attempts).toBe(1);
    expect(await t.call("signal", { ...request, request_id: "without-evidence-correct",
      answer: t.input.stages.gate.steps[request.step_id].answer })).toMatchObject({ accepted: true, status: "done" });
    const progress = t.game.v2!.progress.gate.signal.steps[request.step_id];
    expect(progress).not.toHaveProperty("method");
    expect(progress).not.toHaveProperty("source");
    expect(t.game.score).toBe(beforeScore);
    expect(t.game.locks).toEqual(beforeLock);
  });

  it.each([
    { extra: { method: "explained" }, code: "BAD_REQUEST" },
    { extra: { method: "proxy" }, code: "BAD_REQUEST" },
    { extra: { method: "gps" }, code: "BAD_REQUEST" },
    { extra: { method: null }, code: "BAD_REQUEST" },
    { extra: { source: null }, code: "SOURCE_REQUIRED" },
    { extra: { source: { text: "" } }, code: "SOURCE_REQUIRED" },
    { extra: { source: { text: "[합성] 자료", source_id: "unknown" } }, code: "SOURCE_REQUIRED" },
  ])("validates metadata if an older client still sends it: $extra", async ({ extra, code }) => {
    const t = await team();
    const before = structuredClone(t.game);
    await expect(t.call("signal", { action: "submit-step", step_id: "G-03.freq",
      answer: t.input.stages.gate.steps["G-03.freq"].answer, ...extra } as Command)).rejects.toMatchObject({ code });
    expect(t.game).toEqual(before);
  });

  it("preserves older client metadata and distinguishes genuine explanation completion", async () => {
    const t = await team();
    await t.call("signal", { action: "submit-step", step_id: "G-03.freq",
      answer: t.input.stages.gate.steps["G-03.freq"].answer,
      method: "official_digital", source: { text: "[합성] 기존 자료", source_id: "MOCK-S1" } });
    expect(t.game.v2!.progress.gate.signal.steps["G-03.freq"]).toMatchObject({
      method: "official_digital", source: { text: "[합성] 기존 자료", source_id: "MOCK-S1" } });
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await t.call("commander", { action: "request-hint", target_role: role, level });
      await t.call(role, { action: "submit-report" });
      await t.call(role, { action: "confirm-explanation" });
    }
    await t.call("commander", { action: "open-after-explanation" });
    const view = projectGameV2(t.game, t.course, t.user("signal"), t.now());
    expect(view.self.journal[0].entries.find((e) => e.step_id === "G-03.freq")?.method).toBe("official_digital");
    expect(view.self.journal[0].entries.filter((e) => !e.verified).every((e) => e.method === "explained")).toBe(true);
    expect(view.game.completion?.label).toBe("해설 확인 후 복원");
  });
});
