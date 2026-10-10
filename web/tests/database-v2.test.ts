import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createGame, project } from "../supabase/functions/_shared/engine";
import { demoCourseV2 } from "../supabase/functions/_shared/demo-course-v2";
import type {
  Game,
  GameEvent,
  PublicGame,
} from "../supabase/functions/_shared/types";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create schema realtime;create table realtime.messages(extension text,topic text);
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ select $$;
    grant usage on schema realtime to authenticated;
    alter table realtime.messages enable row level security;create publication supabase_realtime;`,
  );
  for (const name of ["202610060001_game.sql", "202610080001_game_v2.sql", "202610090001_yongbong_alt_mode.sql", "202610100001_wall_bongji.sql"]) {
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  }
}, 30000);
afterAll(() => db.close());
async function fixture() {
  const user = crypto.randomUUID(),
    course = await demoCourseV2("jnu-demo-dev-db-r2", crypto.randomUUID());
  const game = createGame(
    user,
    "연습1",
    course,
    100000,
    crypto.randomUUID().slice(0, 4),
  );
  game.members[0].role = "commander";
  await db.query("select create_game_atomic($1,$2,$3,$4::jsonb,$5::jsonb)", [
    user,
    crypto.randomUUID(),
    "synthetic-fingerprint",
    JSON.stringify(game),
    JSON.stringify(project(game, course, user, 100000).game),
  ]);
  const event: GameEvent = {
    request_id: "hint-2",
    at: 100000,
    actor_member: game.hostId,
    role: "commander",
    stage_id: "gate",
    action: "request-hint",
    data: { target_role: "signal", level: 2, penalty: 10 },
  };
  return { game, course, user, event };
}
async function commit(
  game: Game,
  expected: number,
  pub: PublicGame,
  events: GameEvent[],
) {
  return db.query<{ ok: boolean }>(
    "select commit_game_v2($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) ok",
    [
      game.id,
      expected,
      JSON.stringify(game),
      JSON.stringify(pub),
      JSON.stringify(events),
    ],
  );
}
describe("v2 transaction and append-only events", () => {
  it.each(["draft-memorial-record", "confirm-stage", "draft-joint-record", "consent-joint-record", "submit-retro"])(
    "commits %s metadata once under CAS and rolls back prose or forged draft versions", async (action) => {
      const { game, course, user, event } = await fixture();
      game.version = 2;
      const memorial = ["draft-memorial-record", "confirm-stage"].includes(action);
      const stage_id = memorial ? "wall" : "bongji";
      const draft = { version: 1, words: ["[합성] 선택"], text: "[합성] 공동 문장", reason: "[합성] 근거", confirms: {} };
      game.v2!.memorialRecords = { wall: draft }; game.v2!.jointRecords = { bongji: draft };
      const data: GameEvent["data"] = action === "submit-retro" ? {} : { draft_version: 1 };
      const next = { ...event, action, stage_id, data };
      const pub = project(game, course, user, 100000).game;
      await expect(commit(game, 1, pub, [{ ...next, data: { ...data, text: "SYNTHETIC-PRIVATE" } }])).rejects.toThrow("INVALID_GAME_EVENT");
      if (action !== "submit-retro") {
        await expect(commit(game, 1, pub, [{ ...next, data: { draft_version: 2 } }])).rejects.toThrow("INVALID_GAME_EVENT");
      }
      expect((await db.query<{ version: number }>("select version::int from games_private where id=$1", [game.id])).rows[0].version).toBe(1);
      expect((await commit(game, 1, pub, [next])).rows[0].ok).toBe(true);
      expect((await commit(game, 1, pub, [next])).rows[0].ok).toBe(false);
      expect((await db.query("select data from game_events where game_id=$1", [game.id])).rows).toEqual([{ data }]);
    },
  );
  it("commits the outdoor event atomically and rejects stale retries", async () => {
    const { game, course, user, event } = await fixture();
    game.version = 2; game.v2!.altMode = { yongbong: "outdoor" };
    const outdoor = { ...event, stage_id: "yongbong", action: "select-alt-mode", data: { mode_id: "outdoor" } };
    const pub = project(game, course, user, 100000).game;
    expect((await commit(game, 1, pub, [outdoor])).rows[0].ok).toBe(true);
    expect((await commit(game, 1, pub, [outdoor])).rows[0].ok).toBe(false);
    expect((await db.query("select data from game_events where game_id=$1", [game.id])).rows).toEqual([{ data: { mode_id: "outdoor" } }]);
  });
  it("rolls back invalid outdoor metadata, missing state and extra private fields", async () => {
    const { game, course, user, event } = await fixture(); game.version = 2;
    const pub = project(game, course, user, 100000).game;
    const outdoor = { ...event, stage_id: "yongbong", action: "select-alt-mode", data: { mode_id: "outdoor" } };
    await expect(commit(game, 1, pub, [outdoor])).rejects.toThrow("INVALID_GAME_EVENT");
    game.v2!.altMode = { yongbong: "outdoor" };
    for (const invalid of [{ ...outdoor, stage_id: "gate" },
      { ...outdoor, data: { mode_id: "onsite" } },
      { ...outdoor, data: { mode_id: "outdoor", record: "SYNTHETIC-PRIVATE" } }]) {
      await expect(commit(game, 1, pub, [invalid])).rejects.toThrow("INVALID_GAME_EVENT");
    }
    expect((await db.query<{ version: number }>("select version::int from games_private where id=$1", [game.id])).rows[0].version).toBe(1);
    expect((await db.query("select data from game_events where game_id=$1", [game.id])).rows).toEqual([]);
  });
  it("commits one CAS winner with one event and rejects the stale writer", async () => {
    const { game, course, user, event } = await fixture();
    game.version = 2;
    game.score = 90;
    const pub = project(game, course, user, 100000).game;
    const [a, b] = await Promise.all([
      commit(game, 1, pub, [event]),
      commit(game, 1, pub, [event]),
    ]);
    expect([a.rows[0].ok, b.rows[0].ok].filter(Boolean)).toHaveLength(1);
    expect(
      (await db.query("select * from game_events where game_id=$1", [game.id]))
        .rows,
    ).toHaveLength(1);
    const state = await db.query<{ score: number }>(
      "select (state->>'score')::int score from game_public where game_id=$1",
      [game.id],
    );
    expect(state.rows[0].score).toBe(90);
  });
  it("rolls private/public versions back when an event contains forbidden data or duplicates", async () => {
    const { game, course, user, event } = await fixture();
    game.version = 2;
    game.score = 90;
    const pub = project(game, course, user, 100000).game;
    await expect(
      commit(game, 1, pub, [{
        ...event,
        data: { ...event.data, answer: "SYNTHETIC-FORBIDDEN" },
      }]),
    ).rejects.toThrow("INVALID_GAME_EVENT");
    const versions = await db.query<
      { private_version: number; public_version: number }
    >(
      "select g.version::int private_version,p.version::int public_version from games_private g join game_public p on p.game_id=g.id where g.id=$1",
      [game.id],
    );
    expect(versions.rows[0]).toEqual({ private_version: 1, public_version: 1 });
    await commit(game, 1, pub, [event]);
    game.version = 3;
    game.score = 80;
    await expect(
      commit(game, 2, project(game, course, user, 100000).game, [event]),
    ).rejects.toThrow(/unique/);
    expect(
      (await db.query<{ version: number }>(
        "select version::int from games_private where id=$1",
        [game.id],
      )).rows[0].version,
    ).toBe(2);
  });
  it("denies player event reads/RPC writes and denies service direct event mutation", async () => {
    const { game, event, course, user } = await fixture();
    game.version = 2;
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query("select * from game_events")).rejects.toThrow(
          /permission denied/,
        );
        await expect(
          commit(game, 1, project(game, course, user, 100000).game, [event]),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("reset role");
      }
    }
    await db.exec("set role service_role");
    try {
      expect(
        (await commit(game, 1, project(game, course, user, 100000).game, [
          event,
        ])).rows[0].ok,
      ).toBe(true);
      await expect(db.query("update game_events set action='changed'")).rejects
        .toThrow(/permission denied/);
      await expect(db.query("delete from game_events")).rejects.toThrow(
        /permission denied/,
      );
      expect(
        (await db.query("select * from game_events where game_id=$1", [
          game.id,
        ])).rows,
      ).toHaveLength(1);
    } finally {
      await db.exec("reset role");
    }
  });
  it("accepts presence-only version changes without inventing gameplay events", async () => {
    const { game, course, user } = await fixture();
    game.version = 2;
    expect(
      (await commit(game, 1, project(game, course, user, 100000).game, []))
        .rows[0].ok,
    ).toBe(true);
    expect(
      (await db.query("select * from game_events where game_id=$1", [game.id]))
        .rows,
    ).toHaveLength(0);
  });
});
