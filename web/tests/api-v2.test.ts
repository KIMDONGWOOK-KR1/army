import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { ROLES } from "../supabase/functions/_shared/types";
import type { Command, Role } from "../supabase/functions/_shared/types";
import { demoV2Input } from "../supabase/functions/_shared/demo-course-v2";
import type { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
type V2Snapshot = ReturnType<typeof projectGameV2>;
let POST: typeof import("../app/api/game/route").POST;
let folder: string;
let now = 1800000000000;
let sequence = 0;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "hoguk-v2-api-"));
  vi.spyOn(process, "cwd").mockReturnValue(folder);
  vi.spyOn(Date, "now").mockImplementation(() => now += 1100);
  vi.stubEnv("NEXT_PUBLIC_BACKEND", "local");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("LOCAL_V2_COURSE_ID", "jnu-demo-dev-http-r2");
  vi.stubEnv("ANSWER_SALT", crypto.randomUUID());
  POST = (await import("../app/api/game/route")).POST;
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (
    folder && dirname(resolve(folder)) === resolve(tmpdir()) &&
    resolve(folder).includes("hoguk-v2-api-")
  ) await rm(folder, { recursive: true, force: true });
});
async function request(session: string, command: Command) {
  const response = await POST(
    new NextRequest("http://localhost/api/game", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
        cookie: `hoguk_session=${session}`,
      },
      body: JSON.stringify({
        request_id: `http-${sequence++}`,
        stage_id: "gate",
        ...command,
      }),
    }),
  );
  return {
    status: response.status,
    body: await response.json() as V2Snapshot & { code?: string },
    response,
  };
}
// All fixture fields must exist with compatible types. Text/IDs/time are synthetic.
// Nullable private digits are deliberately redacted in documentation; map keys vary
// with private earned explanations. Extra server fields remain backwards compatible.
function contract(actual: unknown, fixture: unknown, path = "") {
  if (fixture === null) {
    expect(actual, path).not.toBeUndefined();
    return;
  }
  if (Array.isArray(fixture)) {
    expect(Array.isArray(actual), path).toBe(true);
    if (fixture.length && (actual as unknown[]).length) {
      for (const [i, item] of (actual as unknown[]).entries()) {
        contract(item, fixture[i] ?? fixture[0], `${path}[]`);
      }
    }
    return;
  }
  if (typeof fixture === "object") {
    expect(actual, path).toBeTypeOf("object");
    expect(actual, path).not.toBeNull();
    for (const [k, v] of Object.entries(fixture!)) {
      contract((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
    }
    return;
  }
  // PR-3's swap window is explicitly inactive in PR-2.
  if (path === ".game.swap.window_ends_at" && actual === null) return;
  expect(typeof actual, path).toBe(typeof fixture);
}
it("compares real POST/get-stage Snapshots with all 12 FE fixtures and persists four-device progress", async () => {
  const sessions = Array.from({ length: 4 }, () => crypto.randomUUID());
  const created = await request(sessions[0], {
    action: "create-game",
    nickname: "연습1",
  });
  expect(created.status).toBe(200);
  const id = created.body.game.id;
  for (let i = 1; i < 4; i++) {
    expect(
      (await request(sessions[i], {
        action: "join-game",
        code: created.body.game.code,
        nickname: `연습${i + 1}`,
      })).status,
    ).toBe(200);
  }
  await request(sessions[0], { action: "start-game", game_id: id });
  now += 4000;
  const roleSessions = {} as Record<Role, string>;
  for (const session of sessions) {
    const ready = await request(session, { action: "set-ready", game_id: id });
    expect(ready.status).toBe(200);
    roleSessions[ready.body.self.role!] = session;
  }
  const call = (role: Role, cmd: Command) =>
    request(roleSessions[role], { game_id: id, ...cmd });
  expect((await call("commander", { action: "begin-operation" })).status).toBe(
    200,
  );
  for (const role of ROLES) {
    expect(
      (await call(role, { action: "report-arrival", method: "simulated" }))
        .status,
    ).toBe(200);
  }
  async function compare(state: string) {
    for (const role of ROLES) {
      const { status, body, response } = await call(role, {
        action: "get-stage",
      });
      expect(status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private");
      const fixture = JSON.parse(
        await readFile(
          new URL(
            `../../docs/be/fixtures/get-stage.gate.${role}.${state}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      contract(body, fixture);
      expect(body.self.role).toBe(role);
      expect(body.game.stage_id).toBe("gate");
      expect(body.game.stage_phase).toBe(fixture.game.stage_phase);
      expect(body.game.hint_level).toEqual(fixture.game.hint_level);
      expect(body.game.report_mask).toEqual(fixture.game.report_mask);
      expect(body.game.locked_mask).toEqual(fixture.game.locked_mask);
      expect(Object.keys(body.self.step_progress)).toEqual(
        Object.keys(fixture.self.step_progress),
      );
      for (
        const [stepId, progress] of Object.entries(
          fixture.self.step_progress,
        ) as [string, { status: string }][]
      ) expect(body.self.step_progress[stepId].status).toBe(progress.status);
      if (role !== "commander") {
        expect(body.self).not.toHaveProperty("transfer_clue");
      }
      if (state === "after-hint") {
        expect(body.self.hints.length).toBe(role === "signal" ? 1 : 0);
      }
      expect(JSON.stringify(body)).not.toMatch(
        /answerHash|ANSWER_SALT|"private"|"receipts"|"userId"/,
      );
      expect(body).not.toHaveProperty("result");
    }
  }
  await compare("before-hint");
  expect(
    (await call("commander", {
      action: "request-hint",
      target_role: "signal",
      level: 1,
    })).status,
  ).toBe(200);
  await compare("after-hint");
  const { content, privateInput } = demoV2Input("jnu-demo-dev-http-r2");
  for (const role of ["scout", "signal", "cipher", "commander"] as const) {
    for (const step of content.stages[1].roles[role]!.steps) {
      const answer = privateInput.stages.gate.steps[step.id].answer ??
        Object.fromEntries(
          step.fields!.map((f) => [f.id, `[합성] ${f.id} 기록`]),
        );
      const response = await call(role, {
        action: "submit-step",
        step_id: step.id,
        answer,
        method: "field",
        source: { text: "[합성] 확인 자료", source_id: "MOCK-S1" },
      });
      expect(response.status).toBe(200);
    }
    expect((await call(role, { action: "submit-report" })).status).toBe(200);
  }
  expect(
    (await call("commander", { action: "open-lock", digits: [2, 3, 4, 5] }))
      .status,
  ).toBe(200);
  await compare("stage-completed");
  const saved = JSON.parse(
    await readFile(join(folder, ".demo-data/state.json"), "utf8"),
  );
  expect(saved.games[id].v2.sacho.gate.observations).toHaveLength(1);
  expect(saved.games[id].v2.sacho.gate.eventRecords).toHaveLength(1);
  expect(
    saved.events[id].filter((e: { action: string }) =>
      e.action === "open-lock"
    ),
  ).toHaveLength(1);
  expect(
    (await request(crypto.randomUUID(), { action: "get-stage", game_id: id }))
      .status,
  ).toBe(403);
  delete saved.courses["jnu-demo-dev-http-r2"].private.stages.gate;
  await writeFile(join(folder, ".demo-data/state.json"), JSON.stringify(saved));
  const missing = await call("scout", { action: "get-stage" });
  expect(missing.status).toBe(503);
  expect(missing.body.code).toBe("CONTENT_UNCONFIRMED");
  expect(JSON.stringify(missing.body)).not.toMatch(
    /TypeError|stack|answerHash/,
  );
});
