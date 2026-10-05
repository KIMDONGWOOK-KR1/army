import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createGame, project } from "../supabase/functions/_shared/engine";
import { demoCourse } from "../supabase/functions/_shared/course";
const db = new PGlite();
const user = "11111111-1111-4111-8111-111111111111",
  outsider = "22222222-2222-4222-8222-222222222222";
let id: string;
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;
 create schema realtime;create table realtime.messages(extension text,topic text);
 create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
 create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ select $$;
 grant usage on schema realtime to authenticated;
 alter table realtime.messages enable row level security;create publication supabase_realtime;`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/202610060001_game.sql", import.meta.url),
      "utf8",
    ),
  );
  const course = await demoCourse(),
    game = createGame(user, "기록자", course, Date.now(), "ABCD");
  id = game.id;
  await db.query("select create_game_atomic($1,$2,$3,$4::jsonb,$5::jsonb)", [
    user,
    "create1",
    "hash",
    JSON.stringify(game),
    JSON.stringify(project(game, course, user, Date.now()).game),
  ]);
}, 30000);
afterAll(() => db.close());
describe("PostgreSQL migration and permissions", () => {
  it("makes room creation idempotent and rejects request conflicts", async () => {
    const result = await db.query<{ gid: string }>(
      "select create_game_atomic($1,$2,$3,$4::jsonb,$5::jsonb) gid",
      [user, "create1", "hash", "{}", "{}"],
    );
    expect(result.rows[0].gid).toBe(id);
    await expect(
      db.query("select create_game_atomic($1,$2,$3,$4::jsonb,$5::jsonb)", [
        user,
        "create1",
        "different",
        "{}",
        "{}",
      ]),
    ).rejects.toThrow("REQUEST_CONFLICT");
  });
  it("prevents stale updates and commits public/private state together", async () => {
    const { rows } = await db.query<{ state: Record<string, unknown> }>(
      "select state from games_private where id=$1",
      [id],
    );
    const state = { ...rows[0].state, version: 2, score: 90 };
    const first = await db.query<{ ok: boolean }>(
      "select commit_game($1,1,$2::jsonb,$3::jsonb) ok",
      [id, JSON.stringify(state), JSON.stringify({ score: 90 })],
    );
    expect(first.rows[0].ok).toBe(true);
    const stale = await db.query<{ ok: boolean }>(
      "select commit_game($1,1,$2::jsonb,$3::jsonb) ok",
      [
        id,
        JSON.stringify({ ...state, score: 80 }),
        JSON.stringify({ score: 80 }),
      ],
    );
    expect(stale.rows[0].ok).toBe(false);
    const view = await db.query<{ state: { score: number } }>(
      "select state from game_public where game_id=$1",
      [id],
    );
    expect(view.rows[0].state.score).toBe(90);
  });
  it("allows a member to read only their team projection and no private data/RPC writes", async () => {
    await db.exec(
      `set role authenticated;set request.jwt.claim.sub='${user}';`,
    );
    try {
      expect((await db.query("select * from game_public")).rows).toHaveLength(
        1,
      );
      await expect(db.query("select * from courses_private")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("select * from games_private")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select commit_game($1,2,$2::jsonb,$3::jsonb)", [
          id,
          "{}",
          "{}",
        ]),
      ).rejects.toThrow(/permission denied/);
      await db.exec(`set request.jwt.claim.sub='${outsider}';`);
      expect((await db.query("select * from game_public")).rows).toHaveLength(
        0,
      );
    } finally {
      await db.exec("reset role;");
    }
  });
  it("blocks joining after five failures and clears the counter after success", async () => {
    for (let i = 0; i < 5; i++)
      await db.query("select join_guard($1,$2)", [user, "failure"]);
    const blocked = await db.query<{ guard: { blocked: boolean } }>(
      "select join_guard($1,$2) guard",
      [user, "check"],
    );
    expect(blocked.rows[0].guard.blocked).toBe(true);
    const cleared = await db.query<{ guard: { blocked: boolean | null } }>(
      "select join_guard($1,$2) guard",
      [user, "success"],
    );
    expect(cleared.rows[0].guard.blocked).toBeFalsy();
  });
});
