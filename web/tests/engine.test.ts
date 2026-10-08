import { describe, expect, it } from "vitest";
import {
  createGame,
  dispatch,
  project,
  normalizeAnswer,
  DomainError,
} from "../supabase/functions/_shared/engine";
import { demoCourse } from "../supabase/functions/_shared/course";
import { ROLES } from "../supabase/functions/_shared/types";
const setup = async () => {
  const course = await demoCourse();
  const game = createGame("host", "동욱", course, 0, "ABCD");
  for (const u of ["b", "c", "d"])
    await dispatch(
      game,
      course,
      u,
      { action: "join-game", nickname: u, request_id: u },
      0,
    );
  await dispatch(
    game,
    course,
    "host",
    { action: "start-game", request_id: "start" },
    0,
  );
  for (const m of game.members)
    await dispatch(
      game,
      course,
      m.userId,
      { action: "set-ready", request_id: "ready" },
      4000,
    );
  const commander = game.members.find((m) => m.role === "commander")!;
  await dispatch(
    game,
    course,
    commander.userId,
    { action: "begin-operation", request_id: "begin" },
    4000,
  );
  return { game, course, commander };
};
describe("server engine", () => {
  it("enforces role and stage for arrivals and keeps manual wait on server", async () => {
    const { game, course, commander } = await setup();
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        { action: "get-clue", site_id: "gate" },
        5000,
      ),
    ).rejects.toMatchObject({ code: "WRONG_STAGE" });
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        {
          action: "report-arrival",
          site_id: "gate",
          manual: true,
          request_id: "early",
        },
        5000,
      ),
    ).rejects.toMatchObject({ code: "COOLDOWN" });
    await dispatch(
      game,
      course,
      commander.userId,
      {
        action: "report-arrival",
        site_id: "gate",
        manual: true,
        request_id: "arrive",
      },
      34000,
    );
    expect(game.phase).toBe("mission");
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        { action: "get-clue", site_id: "yongbong" },
        35000,
      ),
    ).rejects.toMatchObject({ code: "STALE_SITE" });
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        {
          action: "submit-report",
          site_id: "gate",
          role: "scout",
          answer: "1",
          request_id: "spoof",
        },
        35000,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("limits membership and does not expose other-role clues or digits", async () => {
    const { game, course, commander } = await setup();
    await expect(
      dispatch(game, course, "outsider", { action: "get-game" }, 4000),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const view = project(game, course, commander.userId, 4000);
    expect(JSON.stringify(view.game)).not.toContain("answerHash");
    expect(view.self.digit).toBeNull();
    expect(view.self.clue).toBeNull();
    expect(view.game.members).toHaveLength(4);
  });
  it("applies lock cooldown, private digits, duplicate receipts and one bonus attempt", async () => {
    const { game, course, commander } = await setup();
    await dispatch(
      game,
      course,
      commander.userId,
      {
        action: "report-arrival",
        site_id: "gate",
        manual: true,
        request_id: "arrive",
      },
      34000,
    );
    const answers = {
      commander: "2",
      scout: "1",
      signal: "51.8",
      cipher: "일요일",
    };
    for (const m of game.members)
      await dispatch(
        game,
        course,
        m.userId,
        {
          action: "submit-report",
          site_id: "gate",
          role: m.role!,
          answer: answers[m.role!],
          request_id: "report",
        },
        35000,
      );
    const cmd = {
      action: "open-lock",
      site_id: "gate",
      digits: [2, 0, 0, 0],
      request_id: "wrong",
    };
    await dispatch(game, course, commander.userId, cmd, 36000);
    await dispatch(game, course, commander.userId, cmd, 37000);
    expect(game.score).toBe(90);
    expect(game.locks.gate.attempts).toBe(1);
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        { ...cmd, digits: [0, 0, 0, 0] },
        38000,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    for (const id of ["wrong2", "wrong3"])
      await dispatch(
        game,
        course,
        commander.userId,
        { ...cmd, request_id: id },
        38000,
      );
    expect(game.score).toBe(70);
    expect(game.locks.gate.nextAttemptAt).toBe(98000);
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        { ...cmd, request_id: "wait" },
        97000,
      ),
    ).rejects.toMatchObject({ code: "COOLDOWN" });
    const scout = game.members.find((m) => m.role === "scout")!;
    const publicView = project(game, course, scout.userId, 97000);
    expect(publicView.self.lock).toBeNull();
    expect(publicView.self.digit).toBe(1);
    expect(publicView.game.locked_mask).toEqual([true, false, false, false]);
    await dispatch(
      game,
      course,
      commander.userId,
      { ...cmd, request_id: "bonus" },
      98000,
    );
    expect(game.locks.gate.nextAttemptAt).toBe(158000);
    expect(game.score).toBe(60);
  });
  it("rejects five members and duplicate nicknames", async () => {
    const course = await demoCourse();
    const game = createGame("a", "가", course, 0, "ABCD");
    await expect(
      dispatch(
        game,
        course,
        "b",
        { action: "join-game", nickname: "가", request_id: "b" },
        0,
      ),
    ).rejects.toBeInstanceOf(DomainError);
    for (const u of ["b", "c", "d"])
      await dispatch(
        game,
        course,
        u,
        { action: "join-game", nickname: u, request_id: u },
        0,
      );
    await expect(
      dispatch(
        game,
        course,
        "e",
        { action: "join-game", nickname: "e", request_id: "e" },
        0,
      ),
    ).rejects.toMatchObject({ code: "ROOM_FULL" });
  });
  it("normalizes frequency and Unicode without changing internal spacing", () => {
    expect(normalizeAnswer("frequency", " 51.80 ")).toBe("51.8");
    expect(normalizeAnswer("find", "  A  B ")).toBe("A  B");
  });
  it("lets the isolated solo demo report different roles without sharing their retry throttle", async () => {
    const { game, course, commander } = await setup();
    game.demoOwner = commander.userId;
    await dispatch(
      game,
      course,
      commander.userId,
      { action: "demo-arrival", site_id: "gate", request_id: "arrived" },
      35000,
    );
    await dispatch(
      game,
      course,
      commander.userId,
      {
        action: "submit-report",
        site_id: "gate",
        role: "commander",
        answer: "2",
        request_id: "own",
      },
      35000,
    );
    await dispatch(
      game,
      course,
      commander.userId,
      { action: "demo-role", demo_role: "scout", request_id: "switch" },
      35000,
    );
    await dispatch(
      game,
      course,
      commander.userId,
      {
        action: "submit-report",
        site_id: "gate",
        role: "scout",
        answer: "1",
        request_id: "scout",
      },
      35000,
    );
    expect(project(game, course, commander.userId, 35000).self.digit).toBe(1);
  });

  it("jumps a demo game to a chosen scene without returning answers", async () => {
    const course = await demoCourse();
    const game = createGame("me", "기록자", course, 0, "DEMO");
    game.demoOwner = "me";
    ROLES.forEach((role, i) => {
      if (i === 0) {
        game.members[0].role = role;
        game.members[0].ready = true;
        return;
      }
      game.members.push({
        id: `m${i}`,
        userId: `demo-${i}`,
        nickname: `n${i}`,
        role,
        ready: true,
        lastSeen: 0,
      });
    });
    Object.assign(game, {
      status: "playing",
      phase: "travel",
      startedAt: 0,
      siteStartedAt: 0,
    });
    const gate = course.sites[0];
    const result = await dispatch(
      game,
      course,
      "me",
      {
        action: "demo-jump",
        site_id: gate.id,
        stage: "lock",
        request_id: "j1",
      },
      1000,
    );
    expect(JSON.stringify(result)).not.toMatch(/digit|answer/);
    let view = project(game, course, "me", 1000);
    expect(view.game.site_phase).toBe("mission");
    expect(view.game.report_mask.every(Boolean)).toBe(true);
    const digits = gate.lockOrder.map((r) => gate.answers[r].digit);
    await dispatch(
      game,
      course,
      "me",
      { action: "open-lock", site_id: gate.id, digits, request_id: "o1" },
      2000,
    );
    expect(game.phase).toBe("cleared");

    await dispatch(
      game,
      course,
      "me",
      {
        action: "demo-jump",
        site_id: course.sites[1].id,
        stage: "travel",
        request_id: "j2",
      },
      3000,
    );
    view = project(game, course, "me", 3000);
    expect(view.game.current_site_seq).toBe(2);
    expect(view.game.site_phase).toBe("travel");
    expect(game.locks[gate.id].openedAt).toBe(3000);
    expect(game.reports[course.sites[1].id]).toBeUndefined();

    await dispatch(
      game,
      course,
      "me",
      { action: "demo-jump", stage: "done", request_id: "j3" },
      4000,
    );
    expect(game.status).toBe("done");
    await expect(
      dispatch(
        game,
        course,
        "me",
        {
          action: "demo-jump",
          stage: "travel",
          site_id: "nowhere",
          request_id: "j4",
        },
        5000,
      ),
    ).rejects.toMatchObject({ code: "STALE_SITE" });
    // 끝난 시연 작전도 다시 앞 장면으로 돌아갈 수 있다
    await dispatch(
      game,
      course,
      "me",
      {
        action: "demo-jump",
        site_id: gate.id,
        stage: "mission",
        request_id: "j5",
      },
      6000,
    );
    expect(game.status).toBe("playing");
    expect(game.siteIndex).toBe(0);
    expect(game.reports[gate.id]).toBeUndefined();
  });
  it("refuses scene jumps outside demo games", async () => {
    const { game, course, commander } = await setup();
    await expect(
      dispatch(
        game,
        course,
        commander.userId,
        { action: "demo-jump", stage: "done", request_id: "j" },
        5000,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
