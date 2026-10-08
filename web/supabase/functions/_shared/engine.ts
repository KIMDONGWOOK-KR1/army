import {
  type Clue,
  type Command,
  type Course,
  type CourseV2,
  type Game,
  type GameEvent,
  type Role,
  ROLES,
  type Site,
  type SiteInfo,
  type Snapshot,
} from "./types.ts";
import { DomainError, sha256, validateNickname } from "./game-core.ts";
import {
  dispatchV2,
  initializeV2,
  isCourseV2,
  projectGameV2,
} from "./engine-v2.ts";
export { DomainError, sha256, validateNickname } from "./game-core.ts";
const fail = (code: string, message: string, retry?: number): never => {
  throw new DomainError(code, message, retry);
};
export function normalizeAnswer(
  type: Clue["type"],
  answer: string,
  rules?: Clue["normalize"],
) {
  let v = answer.normalize("NFC").trim();
  if (type === "frequency") {
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(v)) return "";
    v = Number(v).toFixed(1);
  }
  if (rules?.collapseSpaces) v = v.replace(/\s+/g, " ");
  if (rules?.caseInsensitive) v = v.toLocaleLowerCase();
  return v;
}
export async function answerHash(
  salt: string,
  siteId: string,
  role: Role,
  clue: Clue,
  answer: string,
) {
  return sha256(
    salt + siteId + role + normalizeAnswer(clue.type, answer, clue.normalize),
  );
}
export function createGame(
  userId: string,
  nickname: string,
  course: Course | CourseV2,
  now: number,
  code: string,
): Game {
  const hostId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    code,
    courseId: course.id,
    demoOwner: null,
    status: "lobby",
    phase: "travel",
    version: 1,
    hostId,
    members: [
      {
        id: hostId,
        userId,
        nickname: validateNickname(nickname),
        role: null,
        ready: false,
        lastSeen: now,
      },
    ],
    siteIndex: 0,
    score: 100,
    revealAt: null,
    siteStartedAt: null,
    startedAt: null,
    endedAt: null,
    expiresAt: now + 86400000,
    locks: {},
    reports: {},
    arrivals: [],
    receipts: {},
    reportTimes: {},
    ...(isCourseV2(course) ? { v2: initializeV2(course) } : {}),
  };
}
export function siteInfo(site: Course["sites"][number]): SiteInfo {
  const { clues: _, answers: __, ...publicSite } = site;
  return publicSite;
}
export function project(
  game: Game,
  course: Course | CourseV2,
  userId: string,
  now: number,
): Snapshot {
  if (isCourseV2(course)) return projectGameV2(game, course, userId, now);
  const m = game.members.find((x) => x.userId === userId) ??
    fail("FORBIDDEN", "이 작전에 소속된 기기가 아니다.");
  const site = course.sites[game.siteIndex];
  const lock = game.locks[site.id] ?? {
    digits: [null, null, null, null],
    attempts: 0,
    nextAttemptAt: null,
    openedAt: null,
  };
  const report = m.role ? game.reports[site.id]?.[m.role] : null;
  const attemptsLeft = lock.attempts < 3
    ? 3 - lock.attempts
    : lock.nextAttemptAt !== null && now >= lock.nextAttemptAt
    ? 1
    : 0;
  return {
    server_now: now,
    version: game.version,
    course: {
      id: course.id,
      name: course.name,
      confirmed: course.confirmed,
      demo: course.demo,
      sites: course.sites.map(siteInfo),
    },
    current_site: siteInfo(site),
    game: {
      id: game.id,
      code: game.code,
      status: game.status,
      site_phase: game.phase,
      version: game.version,
      score: game.score,
      current_site_seq: site.seq,
      host_member_id: game.hostId,
      reveal_at: game.revealAt,
      site_started_at: game.siteStartedAt,
      started_at: game.startedAt,
      ended_at: game.endedAt,
      report_mask: site.lockOrder.map((r) => !!game.reports[site.id]?.[r]),
      locked_mask: lock.digits.map((d) => d !== null),
      attempts_left: attemptsLeft,
      next_attempt_at: lock.nextAttemptAt,
      acquired_sites: course.sites
        .filter(
          (s) =>
            game.locks[s.id]?.openedAt !== null &&
            game.locks[s.id]?.openedAt !== undefined,
        )
        .map(siteInfo),
      members: game.members.map((x) => ({
        id: x.id,
        nickname: x.nickname,
        role: x.role,
        ready: x.ready,
        online: now - x.lastSeen < 45000,
      })),
      demo: !!game.demoOwner,
    },
    self: {
      id: m.id,
      nickname: m.nickname,
      role: m.role,
      is_host: m.id === game.hostId,
      ready: m.ready,
      reported: !!report,
      digit: report?.digit ?? null,
      clue: m.role && game.status === "playing" && game.phase === "mission"
        ? site.clues[m.role]
        : null,
      lock: m.role === "commander" ? structuredClone(lock) : null,
    },
  };
}
const writes = new Set([
  "join-game",
  "start-game",
  "set-ready",
  "begin-operation",
  "report-arrival",
  "submit-report",
  "open-lock",
  "depart-next-site",
  "demo-role",
  "demo-arrival",
  "demo-time",
  "demo-jump",
]);
export async function dispatch(
  game: Game,
  course: Course | CourseV2,
  userId: string,
  cmd: Command,
  now: number,
  salt = "hoguk-synthetic-demo-only",
  events: GameEvent[] = [],
): Promise<Record<string, unknown>> {
  if (isCourseV2(course)) {
    return dispatchV2(game, course, userId, cmd, now, salt, events);
  }
  if (!["get-game", "get-clue", ...writes].includes(cmd.action)) {
    fail("INVALID_ACTION", "알 수 없는 요청이다.");
  }
  const mutating = writes.has(cmd.action);
  if (
    mutating &&
    (!cmd.request_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.request_id))
  ) {
    fail("INVALID_REQUEST", "요청 식별자가 필요하다.");
  }
  const receiptKey = `${userId}:${cmd.request_id}`;
  const fingerprint = await sha256(JSON.stringify(cmd));
  const receipt = game.receipts[receiptKey];
  if (mutating && receipt) {
    if (receipt.hash !== fingerprint) {
      fail("REQUEST_CONFLICT", "같은 요청 번호의 내용이 다르다.");
    }
    return receipt.result;
  }
  if (game.expiresAt <= now && game.status !== "done") {
    fail("EXPIRED", "작전 대기 시간이 만료되었다. 새 방을 만들라.");
  }
  let member = game.members.find((m) => m.userId === userId);
  if (cmd.action === "join-game") {
    if (member) return { joined: true };
    if (game.status !== "lobby") {
      fail("WRONG_STAGE", "이미 출발했거나 종료된 작전이다.");
    }
    if (game.members.length >= 4) {
      fail("ROOM_FULL", "이 작전의 네 자리가 모두 찼다.");
    }
    const nickname = validateNickname(cmd.nickname);
    if (game.members.some((x) => x.nickname === nickname)) {
      fail("INVALID_NICKNAME", "이미 사용 중인 호출명이다.");
    }
    game.members.push({
      id: crypto.randomUUID(),
      userId,
      nickname,
      role: null,
      ready: false,
      lastSeen: now,
    });
    game.version++;
    game.receipts[receiptKey] = { hash: fingerprint, result: { joined: true } };
    return { joined: true };
  }
  member ??= fail("FORBIDDEN", "이 작전에 소속된 기기가 아니다.");
  if (game.status === "briefing" && now >= (game.revealAt ?? Infinity)) {
    game.status = "equip";
    game.version++;
  }
  if (now - member.lastSeen >= 15000) {
    member.lastSeen = now;
    game.version++;
  }
  if (cmd.action === "get-clue") {
    if (game.status !== "playing" || game.phase !== "mission") {
      fail("WRONG_STAGE", "도착 후 자신의 단서를 확인하라.");
    }
    if (cmd.site_id !== course.sites[game.siteIndex].id) {
      fail("STALE_SITE", "현재 거점의 단서를 요청하라.");
    }
    if (cmd.role && cmd.role !== member.role) {
      fail("FORBIDDEN", "자신의 보직 단서만 확인하라.");
    }
    return {};
  }
  if (cmd.action === "get-game") return {};
  // 끝난 작전은 바꿀 수 없다(시연 작전의 장면 건너뛰기만 예외)
  if (game.status === "done" && cmd.action !== "demo-jump") {
    fail("WRONG_STAGE", "작전은 종료되었다. 수집한 기록을 확인하라.");
  }
  if (Object.keys(game.receipts).length >= 2000) {
    fail("RATE_LIMITED", "작전 요청 한도를 초과했다.");
  }
  const site = course.sites[game.siteIndex];
  const requireStage = (status: Game["status"], phase?: Game["phase"]) => {
    if (game.status !== status || (phase && game.phase !== phase)) {
      fail("WRONG_STAGE", "현재 단계에서 사용할 수 없는 요청이다.");
    }
  };
  const requireCommander = () => {
    if (member.role !== "commander") {
      fail("FORBIDDEN", "지휘관만 이 요청을 할 수 있다.");
    }
  };
  const requireSite = () => {
    if (cmd.site_id !== site.id) {
      fail("STALE_SITE", "현재 거점이 바뀌었다. 화면을 다시 확인하라.");
    }
  };
  let result: Record<string, unknown> = {};
  switch (cmd.action) {
    case "start-game": {
      requireStage("lobby");
      if (member.id !== game.hostId) {
        fail("FORBIDDEN", "방장만 보직을 공개할 수 있다.");
      }
      if (game.members.length !== 4) {
        fail("NOT_READY", "네 명이 모두 합류해야 한다.");
      }
      const roles: Role[] = [...ROLES];
      for (let i = 3; i > 0; i--) {
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        const j = random[0] % (i + 1);
        [roles[i], roles[j]] = [roles[j], roles[i]];
      }
      game.members.forEach((m, i) => (m.role = roles[i]));
      game.status = "briefing";
      game.revealAt = now + 3000;
      break;
    }
    case "set-ready":
      requireStage("equip");
      member.ready = true;
      break;
    case "begin-operation":
      requireStage("equip");
      requireCommander();
      if (!game.members.every((m) => m.ready)) {
        fail("NOT_READY", "네 명의 장비 점검이 필요하다.");
      }
      game.status = "playing";
      game.phase = "travel";
      game.startedAt = now;
      game.siteStartedAt = now;
      break;
    case "demo-role": {
      if (game.demoOwner !== userId || !course.demo) {
        fail("FORBIDDEN", "시연 작전에서만 보직을 바꿀 수 있다.");
      }
      if (!ROLES.includes(cmd.demo_role!)) {
        fail("INVALID_REQUEST", "유효한 보직을 선택하라.");
      }
      const other = game.members.find((x) => x.role === cmd.demo_role)!;
      const prev = member.role;
      member.role = other.role;
      other.role = prev;
      break;
    }
    case "demo-time": {
      if (game.demoOwner !== userId || !course.demo) {
        fail("FORBIDDEN", "시연 작전에서만 시간을 건너뛸 수 있다.");
      }
      if (game.phase === "travel") game.siteStartedAt = now - 30000;
      const lock = game.locks[site.id];
      if (lock?.nextAttemptAt) lock.nextAttemptAt = now;
      break;
    }
    case "demo-jump": {
      // 발표용 시연에서 원하는 장면으로 바로 건너뛴다. 앞 거점의 보고·자물쇠는 서버가
      // 아는 숫자로 채우고, 정답·숫자는 응답에 넣지 않는다.
      if (game.demoOwner !== userId || !course.demo)
        fail("FORBIDDEN", "시연 작전에서만 장면을 건너뛸 수 있다.");
      const stage = cmd.stage;
      if (!stage || !["travel", "mission", "lock", "done"].includes(stage))
        fail("INVALID_REQUEST", "알 수 없는 시연 장면이다.");
      const target =
        stage === "done"
          ? course.sites.length - 1
          : course.sites.findIndex((x) => x.id === cmd.site_id);
      if (target < 0) fail("STALE_SITE", "시연 코스에 없는 거점이다.");
      const holder = (r: Role) =>
        game.members.find((m) => m.role === r) ?? member;
      const fill = (s: Site) => {
        game.reports[s.id] = {};
        for (const r of ROLES)
          game.reports[s.id][r] = {
            userId: holder(r).userId,
            at: now,
            digit: s.answers[r].digit,
          };
      };
      const arrive = (s: Site) =>
        game.arrivals.push({
          siteId: s.id,
          memberId: member.id,
          manual: false,
          simulated: true,
          at: now,
        });
      game.reports = {};
      game.locks = {};
      game.arrivals = [];
      game.reportTimes = {};
      course.sites.forEach((s, i) => {
        if (i >= target && stage !== "done") return;
        fill(s);
        arrive(s);
        game.locks[s.id] = {
          digits: s.lockOrder.map((r) => s.answers[r].digit),
          attempts: 1,
          nextAttemptAt: null,
          openedAt: now,
        };
      });
      game.status = "playing";
      game.siteIndex = target;
      game.score = 100;
      game.startedAt ??= now;
      game.siteStartedAt = now;
      game.endedAt = null;
      if (stage === "done") {
        game.status = "done";
        game.phase = "cleared";
        game.endedAt = now;
      } else if (stage === "travel") game.phase = "travel";
      else {
        arrive(course.sites[target]);
        game.phase = "mission";
        if (stage === "lock") fill(course.sites[target]);
      }
      break;
    }
    case "demo-arrival":
    case "report-arrival": {
      requireStage("playing", "travel");
      requireSite();
      const simulated = cmd.action === "demo-arrival";
      if (simulated && (game.demoOwner !== userId || !course.demo)) {
        fail("FORBIDDEN", "모의 도착은 시연 작전 전용이다.");
      }
      if (!simulated && !cmd.manual && !course.confirmed) {
        fail(
          "UNCONFIRMED_COURSE",
          "좌표가 미확정이다. 지휘관의 수동 도착을 사용하라.",
        );
      }
      if (cmd.manual) {
        requireCommander();
        const retry = (game.siteStartedAt ?? now) + 30000;
        if (now < retry) {
          fail(
            "COOLDOWN",
            "이동 시작 30초 후 수동 도착을 사용할 수 있다.",
            retry,
          );
        }
      }
      game.arrivals.push({
        siteId: site.id,
        memberId: member.id,
        manual: !!cmd.manual,
        simulated,
        at: now,
      });
      game.phase = "mission";
      break;
    }
    case "submit-report": {
      requireStage("playing", "mission");
      requireSite();
      if (cmd.role !== member.role) {
        fail("FORBIDDEN", "자신의 보직에 해당하는 단서만 제출하라.");
      }
      const role = member.role!;
      const previous = game.reports[site.id]?.[role];
      if (previous) {
        result = { ok: true, digit: previous.digit };
        break;
      }
      if (typeof cmd.answer !== "string" || cmd.answer.length > 200) {
        fail("INVALID_REQUEST", "답을 200자 이내로 입력하라.");
      }
      const timeKey = `${member.id}:${site.id}:${role}`;
      const last = game.reportTimes[timeKey];
      if (last !== undefined && now - last < 1000) {
        fail("RATE_LIMITED", "잠시 뒤 다시 보고하라.", last + 1000);
      }
      game.reportTimes[timeKey] = now;
      const correct = (await answerHash(
        salt,
        site.id,
        role,
        site.clues[role],
        cmd.answer as string,
      )) === site.answers[role].answerHash;
      if (correct) {
        game.reports[site.id] ??= {};
        const digit = site.answers[role].digit;
        game.reports[site.id][role] = { userId, at: now, digit };
        result = { ok: true, digit };
      } else result = { ok: false };
      break;
    }
    case "open-lock": {
      requireStage("playing", "mission");
      requireSite();
      requireCommander();
      if (!site.lockOrder.every((r) => game.reports[site.id]?.[r])) {
        fail("REPORTS_INCOMPLETE", "네 보직의 보고를 모두 완료하라.");
      }
      const digits = cmd.digits ??
        fail("INVALID_REQUEST", "네 자리 숫자를 입력하라.");
      if (
        !Array.isArray(digits) ||
        digits.length !== 4 ||
        !digits.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)
      ) {
        fail("INVALID_REQUEST", "네 자리 숫자를 입력하라.");
      }
      game.locks[site.id] ??= {
        digits: [null, null, null, null],
        attempts: 0,
        nextAttemptAt: null,
        openedAt: null,
      };
      const lock = game.locks[site.id];
      if (lock.attempts >= 3 && now < (lock.nextAttemptAt ?? Infinity)) {
        fail(
          "COOLDOWN",
          "다음 시도까지 기다리라.",
          lock.nextAttemptAt ?? undefined,
        );
      }
      lock.digits.forEach((d, i) => {
        if (d !== null && d !== digits[i]) {
          fail("INVALID_REQUEST", "이미 잠긴 숫자를 바꿀 수 없다.");
        }
      });
      lock.attempts++;
      const mask = site.lockOrder.map(
        (r, i) => digits[i] === site.answers[r].digit,
      );
      mask.forEach((ok, i) => {
        if (ok) lock.digits[i] = digits[i];
      });
      const opened = mask.every(Boolean);
      if (opened) {
        lock.openedAt = now;
        lock.nextAttemptAt = null;
        if (game.siteIndex === course.sites.length - 1) {
          game.status = "done";
          game.endedAt = now;
        } else game.phase = "cleared";
      } else {
        game.score = Math.max(0, game.score - 10);
        if (lock.attempts >= 3) lock.nextAttemptAt = now + 60000;
      }
      result = { ok: opened, correct_mask: mask };
      break;
    }
    case "depart-next-site":
      requireStage("playing", "cleared");
      requireSite();
      requireCommander();
      if (game.siteIndex >= course.sites.length - 1) {
        fail("WRONG_STAGE", "마지막 거점이다.");
      }
      game.siteIndex++;
      game.phase = "travel";
      game.siteStartedAt = now;
      break;
  }
  game.version++;
  game.receipts[receiptKey] = { hash: fingerprint, result };
  return result;
}
