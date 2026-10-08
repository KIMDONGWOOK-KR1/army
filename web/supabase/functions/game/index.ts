import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createGame,
  dispatch,
  DomainError,
  project,
  sha256,
} from "../_shared/engine.ts";
import type {
  Command,
  Course,
  CourseV2,
  Game,
  GameEvent,
} from "../_shared/types.ts";
import { isCourseV2 } from "../_shared/engine-v2.ts";
import { domainHttpStatus } from "../_shared/game-core.ts";
import {
  assertEdgeCourseAllowed,
  corsForRequest,
} from "../_shared/deployment.ts";
const env = (key: string) => Deno.env.get(key) ?? "";
const service = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = () => {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join("");
};
Deno.serve(async (req) => {
  const { headers, status } = corsForRequest(
    req.headers.get("origin"),
    env("ALLOWED_ORIGIN"),
    env("ALLOWED_ORIGINS"),
  );
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (status === 503) {
    return json(
      { code: "SERVER_ERROR", message: "운영 출처 설정이 필요하다." },
      503,
    );
  }
  if (status === 403) {
    return json({ code: "FORBIDDEN", message: "허용되지 않은 출처다." }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return json(
      { code: "INVALID_REQUEST", message: "POST 요청이 필요하다." },
      405,
    );
  }
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) {
      throw new DomainError("UNAUTHENTICATED", "익명 세션이 필요하다.");
    }
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) {
      throw new DomainError(
        "UNAUTHENTICATED",
        "세션이 만료되었다. 다시 연결하라.",
      );
    }
    const userId = auth.user.id,
      raw = await req.text();
    if (raw.length > 8192) {
      throw new DomainError("INVALID_REQUEST", "요청이 너무 크다.");
    }
    let cmd: Command;
    try {
      cmd = JSON.parse(raw);
    } catch {
      throw new DomainError("INVALID_REQUEST", "요청 형식이 올바르지 않다.");
    }
    if (
      !cmd ||
      typeof cmd.action !== "string" ||
      cmd.action.startsWith("demo") ||
      cmd.action === "create-demo"
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "운영 환경에서는 시연 우회를 사용할 수 없다.",
      );
    }
    const salt = env("ANSWER_SALT");
    if (salt.length < 32) {
      throw new DomainError("SERVER_ERROR", "서버 정답 보호 설정이 필요하다.");
    }
    const devOptIn = env("DEV_ALLOW_SYNTHETIC_COURSE");
    let game: Game;
    if (cmd.action === "create-game") {
      if (!cmd.request_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.request_id)) {
        throw new DomainError("INVALID_REQUEST", "요청 식별자가 필요하다.");
      }
      const { data: c, error } = await service
        .from("courses_private")
        .select("state")
        .eq("id", env("ACTIVE_COURSE_ID"))
        .single();
      if (error) {
        throw new DomainError(
          "UNCONFIRMED_COURSE",
          "운영 코스가 등록되지 않았다.",
        );
      }
      const course = c.state as Course | CourseV2;
      assertEdgeCourseAllowed(course, devOptIn);
      const hash = await sha256(JSON.stringify(cmd));
      for (let attempt = 0; attempt < 5; attempt++) {
        game = createGame(
          userId,
          cmd.nickname ?? "",
          course,
          Date.now(),
          randomCode(),
        );
        const { data: id, error: e } = await service.rpc("create_game_atomic", {
          p_user: userId,
          p_request: cmd.request_id,
          p_hash: hash,
          p_state: game,
          p_public: project(game, course, userId, Date.now()).game,
        });
        if (e?.code === "23505") continue;
        if (e) {
          if (e.message.includes("REQUEST_CONFLICT")) {
            throw new DomainError(
              "REQUEST_CONFLICT",
              "동일한 요청 번호의 내용이 다르다.",
            );
          }
          if (e.message.includes("RATE_LIMITED")) {
            throw new DomainError("RATE_LIMITED", "열린 작전이 많다.");
          }
          throw e;
        }
        const { data: g, error: ge } = await service
          .from("games_private")
          .select("state")
          .eq("id", id)
          .single();
        if (ge) throw ge;
        const { data: storedCourse, error: storedError } = await service
          .from("courses_private")
          .select("state")
          .eq("id", g.state.courseId)
          .single();
        if (storedError) throw storedError;
        assertEdgeCourseAllowed(storedCourse.state as Course, devOptIn);
        return json(project(g.state, storedCourse.state, userId, Date.now()));
      }
      throw new DomainError("RETRY", "방 생성이 겹쳤다. 다시 시도하라.");
    }
    if (cmd.action === "join-game") {
      const { data: guard, error } = await service.rpc("join_guard", {
        p_user: userId,
        p_mode: "check",
      });
      if (error) throw error;
      if (guard?.blocked) {
        throw new DomainError(
          "RATE_LIMITED",
          "30초 뒤 다시 합류하라.",
          guard.retry_at,
        );
      }
    }
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        let query = service.from("games_private").select("state,version");
        if (cmd.action === "join-game") {
          query = query.eq("join_code", (cmd.code ?? "").toUpperCase());
        } else query = query.eq("id", cmd.game_id ?? "");
        const { data: g, error: ge } = await query.single();
        if (ge) {
          throw new DomainError(
            cmd.action === "join-game" ? "INVALID_CODE" : "NO_GAME",
            "작전을 찾을 수 없다.",
          );
        }
        game = g.state as Game;
        const { data: c, error: ce } = await service
          .from("courses_private")
          .select("state")
          .eq("id", game.courseId)
          .single();
        if (ce) throw ce;
        const course = c.state as Course | CourseV2;
        assertEdgeCourseAllowed(course, devOptIn);
        const events: GameEvent[] = [];
        const now = Date.now(),
          result = await dispatch(game, course, userId, cmd, now, salt, events),
          snapshot = project(game, course, userId, now);
        const response = cmd.action === "get-stage"
          ? snapshot
          : { ...snapshot, result };
        if (game.version === g.version) return json(response);
        const { data: committed, error: e } = await service.rpc(
          isCourseV2(course) ? "commit_game_v2" : "commit_game",
          {
            p_id: game.id,
            p_expected: g.version,
            p_state: game,
            p_public: snapshot.game,
            ...(isCourseV2(course) ? { p_events: events } : {}),
          },
        );
        if (e) throw e;
        if (committed) {
          if (cmd.action === "join-game") {
            await service.rpc("join_guard", {
              p_user: userId,
              p_mode: "success",
            });
          }
          return json(response);
        }
      }
      throw new DomainError(
        "RETRY",
        "동시 요청이 많다. 같은 요청으로 다시 시도하라.",
      );
    } catch (e) {
      if (cmd.action === "join-game" && e instanceof DomainError) {
        await service.rpc("join_guard", { p_user: userId, p_mode: "failure" });
      }
      throw e;
    }
  } catch (e) {
    const error = e instanceof DomainError ? e : new DomainError(
      "SERVER_ERROR",
      "서버 연결을 처리하지 못했다. 다시 시도하라.",
    );
    if (!(e instanceof DomainError)) console.error("game request failed");
    return json(
      { code: error.code, message: error.message, retry_at: error.retry_at },
      domainHttpStatus(error.code),
    );
  }
});
