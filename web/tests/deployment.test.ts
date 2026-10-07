import { describe, expect, it } from "vitest";
import { prepareDemoSeed } from "../scripts/seed-demo-course";
import {
  assertEdgeCourseAllowed,
  corsForRequest,
} from "../supabase/functions/_shared/deployment";
import { demoCourse } from "../supabase/functions/_shared/course";
import {
  answerHash,
  createGame,
  dispatch,
  project,
} from "../supabase/functions/_shared/engine";
import { type Role, ROLES } from "../supabase/functions/_shared/types";

const projectRef = "abcdefghijklmnopqrst";
const args = [
  "--dev-project-ref",
  projectRef,
  "--course-id",
  "jnu-demo-dev-r1",
];
function environment() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key-not-a-real-credential",
    ANSWER_SALT: crypto.randomUUID(),
  };
}

describe("Edge CORS", () => {
  const primary = "https://app.example.com",
    preview = "https://preview.example.com";
  it("keeps the legacy origin and supports explicitly listed previews", () => {
    expect(
      corsForRequest(primary, primary, "")
        .headers["Access-Control-Allow-Origin"],
    ).toBe(primary);
    for (const origin of [primary, preview]) {
      const result = corsForRequest(
        origin,
        primary,
        ` ${preview}, ${primary}, `,
      );
      expect(result.status).toBe(200);
      expect(result.headers["Access-Control-Allow-Origin"]).toBe(origin);
      expect(result.headers.Vary).toBe("Origin");
      expect(result.headers["Cache-Control"]).toBe("no-store, private");
    }
    expect(corsForRequest(preview, "", preview).status).toBe(200);
  });
  it.each([
    "null",
    "https://app.example.com.evil.test",
    "https://other.example.com",
    "http://app.example.com",
  ])(
    "rejects unlisted origin %s without reflecting it",
    (origin) => {
      const result = corsForRequest(origin, primary, preview);
      expect(result.status).toBe(403);
      expect(result.headers).not.toHaveProperty("Access-Control-Allow-Origin");
    },
  );
  it.each([
    "",
    "*",
    "https://*.example.com",
    primary + "/path",
    primary + "/",
    "https://user:pass@example.com",
    "null",
  ])(
    "fails closed for invalid or absent configuration %s",
    (value) => {
      const result = corsForRequest(primary, value, "");
      expect(result.status).toBe(503);
      expect(result.headers).not.toHaveProperty("Access-Control-Allow-Origin");
    },
  );
  it("keeps non-browser requests available, without emitting a CORS origin", () => {
    const result = corsForRequest(null, primary, "");
    expect(result.status).toBe(200);
    expect(result.headers).not.toHaveProperty("Access-Control-Allow-Origin");
  });
});

describe("isolated dev course deployment", () => {
  it("requires exact opt-in; unconfirmed real courses remain forbidden", async () => {
    const { course } = await prepareDemoSeed(args, environment());
    for (const value of ["", "false", "1", "TRUE", " true "]) {
      expect(() => assertEdgeCourseAllowed(course, value)).toThrow();
    }
    expect(() => assertEdgeCourseAllowed(course, "true")).not.toThrow();
    expect(() => assertEdgeCourseAllowed({ ...course, demo: false }, "true"))
      .toThrow();
    expect(() => assertEdgeCourseAllowed({ ...course, id: "jnu-real" }, "true"))
      .toThrow();
    expect(() =>
      assertEdgeCourseAllowed({ ...course, confirmed: true }, "true")
    ).toThrow();
    expect(() =>
      assertEdgeCourseAllowed({ ...course, demo: false, confirmed: true }, "")
    ).not.toThrow();
    expect(() => assertEdgeCourseAllowed(course, "")).toThrow(); // disabling also closes existing games
  });
  it("rejects ambiguous targets, real course paths, weak salt and missing credentials", async () => {
    const env = environment();
    await expect(prepareDemoSeed([], env)).rejects.toThrow(/사용법/);
    await expect(prepareDemoSeed([...args, "real-course.json"], env)).rejects
      .toThrow();
    await expect(prepareDemoSeed([...args.slice(0, 3), "jnu-real"], env))
      .rejects.toThrow(/사용법/);
    await expect(
      prepareDemoSeed(args, {
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      }),
    ).rejects.toThrow(/일치/);
    await expect(prepareDemoSeed(args, { ...env, ANSWER_SALT: "short" }))
      .rejects.toThrow(/32/);
    await expect(
      prepareDemoSeed(args, { ...env, SUPABASE_SERVICE_ROLE_KEY: "" }),
    ).rejects.toThrow(/key/);
  });
  it("hashes with the supplied salt while preserving unconfirmed synthetic coordinates", async () => {
    const env = environment(), { course } = await prepareDemoSeed(args, env);
    const local = await demoCourse();
    expect(course).toMatchObject({
      id: "jnu-demo-dev-r1",
      demo: true,
      confirmed: false,
    });
    for (const site of course.sites) {
      expect(site.lat).toBeNull();
      expect(site.lng).toBeNull();
      for (const role of ROLES) {
        expect(site.answers[role].answerHash).not.toBe(
          local.sites.find((s) => s.id === site.id)!.answers[role].answerHash,
        );
      }
    }
    expect(course.sites[0].answers.commander.answerHash).toBe(
      await answerHash(
        env.ANSWER_SALT,
        "gate",
        "commander",
        course.sites[0].clues.commander,
        "2",
      ),
    );
  });
  it("completes two sites with four members, server rules and private responses using the seed salt", async () => {
    const env = environment(), { course } = await prepareDemoSeed(args, env);
    const game = createGame("host", "배포시험", course, 0, "ABCD");
    let now = 0, sequence = 0;
    const call = (userId: string, command: Parameters<typeof dispatch>[3]) =>
      dispatch(
        game,
        course,
        userId,
        { request_id: `req-${sequence++}`, ...command },
        now,
        env.ANSWER_SALT,
      );
    for (const user of ["b", "c", "d"]) {
      await call(user, { action: "join-game", nickname: user });
    }
    await call("host", { action: "start-game" });
    now = 4000;
    for (const member of game.members) {
      await call(member.userId, { action: "set-ready" });
    }
    const commander = game.members.find((m) => m.role === "commander")!;
    await call(commander.userId, { action: "begin-operation" });
    expect(game.demoOwner).toBeNull();
    for (const site of course.sites) {
      const arrival = {
        action: "report-arrival",
        site_id: site.id,
        manual: true,
      };
      await expect(call(commander.userId, arrival)).rejects.toMatchObject({
        code: "COOLDOWN",
      });
      await expect(
        call(commander.userId, { action: "demo-arrival", site_id: site.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      now += 30000;
      await call(commander.userId, arrival);
      const answers: Record<Role, string> = site.id === "gate"
        ? { commander: "2", scout: "1", signal: "51.8", cipher: "일요일" }
        : { commander: "3", scout: "용봉관", signal: "19.9", cipher: "8" };
      await expect(
        call(commander.userId, {
          action: "open-lock",
          site_id: site.id,
          digits: [0, 0, 0, 0],
        }),
      )
        .rejects.toMatchObject({ code: "REPORTS_INCOMPLETE" });
      for (const member of game.members) {
        const role = member.role!;
        await call(member.userId, {
          action: "submit-report",
          site_id: site.id,
          role,
          answer: answers[role],
        });
        const view = project(game, course, member.userId, now);
        expect(view.self.digit).toBe(site.answers[role].digit);
        expect(view.self.clue).toEqual(site.clues[role]);
        expect(view.game.demo).toBe(false);
        expect(view.course.demo).toBe(true);
        expect(JSON.stringify(view.game)).not.toMatch(
          /answerHash|"digit"|"clues"/,
        );
        if (role !== "commander") expect(view.self.lock).toBeNull();
      }
      // 기본값 적용 — 확정 필요(D4): existing 3 attempts / -10 / 60-second rules.
      const wrong = {
        action: "open-lock",
        site_id: site.id,
        digits: [0, 0, 0, 0],
        request_id: `wrong-${site.id}`,
      };
      const score = game.score;
      await call(commander.userId, wrong);
      await call(commander.userId, wrong);
      expect(game.score).toBe(score - 10);
      expect(game.locks[site.id].attempts).toBe(1);
      for (let i = 0; i < 2; i++) {
        await call(commander.userId, {
          ...wrong,
          request_id: `wrong-${site.id}-${i}`,
        });
      }
      await expect(
        call(commander.userId, { ...wrong, request_id: `wait-${site.id}` }),
      ).rejects.toMatchObject({ code: "COOLDOWN" });
      now += 60000;
      await call(commander.userId, {
        action: "open-lock",
        site_id: site.id,
        digits: site.lockOrder.map((r) => site.answers[r].digit),
      });
      if (site.id === "gate") {
        await call(commander.userId, {
          action: "depart-next-site",
          site_id: site.id,
        });
      }
    }
    expect(game.status).toBe("done");
    expect(game.arrivals.every((a) => a.manual && !a.simulated)).toBe(true);
    expect(project(game, course, commander.userId, now).game.acquired_sites)
      .toHaveLength(2);
  });
});
