import { fullDemoCourseV2 } from "@/supabase/functions/_shared/wall-bongji-course-v2";
import "server-only";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  createGame,
  dispatch,
  project,
  DomainError,
  sha256,
} from "@/supabase/functions/_shared/engine";
import { demoCourse } from "@/supabase/functions/_shared/course";
import { demoCourseV2 } from "@/supabase/functions/_shared/demo-course-v2";
import { legacyDemoCourseV2 } from "@/supabase/functions/_shared/legacy-demo-course-v2";
import { yongbongDemoCourseV2 } from "@/supabase/functions/_shared/yongbong-course-v2";
import {
  ROLES,
  type Game,
  type Command,
  type Snapshot,
  type GameEvent,
  type CourseV2,
  type Course,
} from "@/supabase/functions/_shared/types";
type Database = {
  games: Record<string, Game>;
  sessions: Record<string, string>;
  creates: Record<string, { hash: string; gameId: string }>;
  failures: Record<string, { count: number; retryAt: number | null }>;
  events?: Record<string, GameEvent[]>;
  courses?: Record<string, CourseV2>;
};
const folder = join(process.cwd(), ".demo-data"),
  file = join(folder, "state.json");
const globalStore = globalThis as typeof globalThis & {
  hogukQueue?: Promise<unknown>;
};
async function read(): Promise<Database> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { games: {}, sessions: {}, creates: {}, failures: {} };
    throw e;
  }
}
async function save(db: Database) {
  await mkdir(folder, { recursive: true });
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(db), { mode: 0o600 });
  await rename(temp, file);
}
const codeChars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function code() {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (n) => codeChars[n % codeChars.length]).join("");
}
async function operation(session: string, cmd: Command): Promise<Snapshot> {
  const now = Date.now(),
    db = await read();
  const salt = process.env.ANSWER_SALT;
  const courseFor = async (id?: string) => {
    if (!id?.startsWith("jnu-demo-dev-")) return demoCourse();
    db.courses ??= {};
    if (db.courses[id]) return db.courses[id];
    const preset = process.env.LOCAL_V2_PRESET ?? "synthetic";
    if (!["synthetic", "v1-gate", "v1-gate-gps", "gate-yongbong", "gate-yongbong-gps", "full-course"].includes(preset))
      throw new DomainError("SERVER_ERROR", "로컬 v2 preset 설정을 확인하라.");
    const build = preset === "full-course" ? fullDemoCourseV2 : preset.startsWith("gate-yongbong") ? yongbongDemoCourseV2 : preset !== "synthetic" ? legacyDemoCourseV2 : demoCourseV2;
    return db.courses[id] = await build(id, salt ?? "", preset.endsWith("-gps"));
  };
  let course: Course | CourseV2 = await demoCourse();
  const events: GameEvent[] = [];
  const persistEvents = (game: Game) => {
    if (!events.length) return;
    db.events ??= {};
    (db.events[game.id] ??= []).push(...events);
  };
  // Only hashed session identifiers are persisted; raw location fixes never reach this route.
  const userId = await sha256(session);
  let game: Game | undefined;
  if (cmd.action === "create-game" || cmd.action === "create-demo") {
    // Solo rehearsal always uses its own v1 demo room, even on a v2 dev server.
    // The public /api/game route remains disabled on Vercel/Supabase deployments.
    if (cmd.action === "create-game" && process.env.LOCAL_V2_COURSE_ID) {
      if (!process.env.LOCAL_V2_COURSE_ID.startsWith("jnu-demo-dev-"))
        throw new DomainError("SERVER_ERROR", "로컬 v2 dev 코스 설정을 확인하라.");
      course = await courseFor(process.env.LOCAL_V2_COURSE_ID);
    }
    if (cmd.action === "create-demo" && "schemaVersion" in course)
      throw new DomainError("FORBIDDEN", "v2 합성 코스도 네 명이 합류해야 한다.");
    if (!cmd.request_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.request_id))
      throw new DomainError("INVALID_REQUEST", "요청 식별자가 필요하다.");
    const key = userId + ":" + cmd.request_id,
      hash = await sha256(JSON.stringify(cmd)),
      prev = db.creates[key];
    if (prev) {
      if (prev.hash !== hash)
        throw new DomainError(
          "REQUEST_CONFLICT",
          "같은 요청 번호의 내용이 다르다.",
        );
      game = db.games[prev.gameId];
      course = await courseFor(game.courseId);
    } else {
      const active = Object.values(db.games).filter(
        (g) =>
          g.members.some((m) => m.userId === userId) &&
          g.expiresAt > now &&
          g.status !== "done",
      );
      if (active.length >= 5)
        throw new DomainError(
          "RATE_LIMITED",
          "열려 있는 작전이 많다. 기존 작전을 먼저 마치라.",
        );
      let joinCode = code();
      while (Object.values(db.games).some((g) => g.code === joinCode))
        joinCode = code();
      game = createGame(
        userId,
        cmd.nickname ?? "기록자",
        course,
        now,
        joinCode,
      );
      if (cmd.action === "create-demo") {
        game.demoOwner = userId;
        for (const [i, role] of ROLES.entries()) {
          if (i === 0) {
            game.members[0].role = role;
            game.members[0].ready = true;
            continue;
          }
          game.members.push({
            id: crypto.randomUUID(),
            userId: "demo-" + crypto.randomUUID(),
            nickname: ["", "솔빛", "너울", "가람"][i],
            role,
            ready: true,
            lastSeen: now,
          });
        }
        game.status = "playing";
        game.phase = "travel";
        game.startedAt = now;
        game.siteStartedAt = now;
      }
      db.games[game.id] = game;
      db.creates[key] = { hash, gameId: game.id };
    }
    db.sessions[userId] = game!.id;
    await save(db);
    return project(game!, course, userId, now);
  }
  if (cmd.action === "join-game") {
    const failure = db.failures[userId];
    if (failure?.retryAt && now < failure.retryAt)
      throw new DomainError(
        "RATE_LIMITED",
        "합류 요청이 많다. 30초 뒤 다시 시도하라.",
        failure.retryAt,
      );
    game = Object.values(db.games).find(
      (g) => g.code === (cmd.code ?? "").toUpperCase(),
    );
    try {
      if (!game)
        throw new DomainError("INVALID_CODE", "입장 코드를 다시 확인하라.");
      course = await courseFor(game.courseId);
      const result = await dispatch(game, course, userId, cmd, now, game.v2 ? salt : undefined, events);
      persistEvents(game);
      db.sessions[userId] = game.id;
      delete db.failures[userId];
      await save(db);
      return { ...project(game, course, userId, now), result };
    } catch (e) {
      if (e instanceof DomainError) {
        const count =
          (failure?.retryAt && now >= failure.retryAt
            ? 0
            : (failure?.count ?? 0)) + 1;
        db.failures[userId] = {
          count,
          retryAt: count >= 5 ? now + 30000 : null,
        };
        await save(db);
      }
      throw e;
    }
  }
  game = db.games[cmd.game_id ?? db.sessions[userId]];
  if (!game) throw new DomainError("NO_GAME", "진행 중인 작전이 없다.");
  course = await courseFor(game.courseId);
  const result = await dispatch(game, course, userId, cmd, now, game.v2 ? salt : undefined, events);
  persistEvents(game);
  await save(db);
  const snapshot = project(game, course, userId, now);
  return cmd.action === "get-stage" ? snapshot : { ...snapshot, result };
}
export function localRequest(session: string, cmd: Command) {
  const pending = (globalStore.hogukQueue ?? Promise.resolve()).then(() =>
    operation(session, cmd),
  );
  globalStore.hogukQueue = pending.catch(() => undefined);
  return pending;
}
