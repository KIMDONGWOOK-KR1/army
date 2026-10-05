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
import {
  ROLES,
  type Game,
  type Command,
  type Snapshot,
} from "@/supabase/functions/_shared/types";
type Database = {
  games: Record<string, Game>;
  sessions: Record<string, string>;
  creates: Record<string, { hash: string; gameId: string }>;
  failures: Record<string, { count: number; retryAt: number | null }>;
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
    db = await read(),
    course = await demoCourse();
  // Only hashed session identifiers are persisted; raw location fixes never reach this route.
  const userId = await sha256(session);
  let game: Game | undefined;
  if (cmd.action === "create-game" || cmd.action === "create-demo") {
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
      const result = await dispatch(game, course, userId, cmd, now);
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
  const result = await dispatch(game, course, userId, cmd, now);
  await save(db);
  return { ...project(game, course, userId, now), result };
}
export function localRequest(session: string, cmd: Command) {
  const pending = (globalStore.hogukQueue ?? Promise.resolve()).then(() =>
    operation(session, cmd),
  );
  globalStore.hogukQueue = pending.catch(() => undefined);
  return pending;
}
