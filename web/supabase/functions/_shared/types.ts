export const ROLES = ["commander", "scout", "signal", "cipher"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_NAMES: Record<Role, string> = {
  commander: "지휘관",
  scout: "정찰원",
  signal: "통신원",
  cipher: "암호해독관",
};
export type Clue = {
  type: "quiz" | "find" | "frequency" | "calendar" | "hanja";
  title: string;
  question: string;
  hint: string;
  choices?: string[];
  min?: number;
  max?: number;
  normalize?: { caseInsensitive?: boolean; collapseSpaces?: boolean };
};
export type SiteInfo = {
  id: string;
  seq: number;
  name: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  reverent: boolean;
  walkMin?: number;
  lockOrder: Role[];
  sacho: { char: string; name: string; body: string };
};
export type Site = SiteInfo & {
  clues: Record<Role, Clue>;
  answers: Record<Role, { answerHash: string; digit: number }>;
};
export type Course = {
  id: string;
  name: string;
  confirmed: boolean;
  demo: boolean;
  sites: Site[];
};
export type Member = {
  id: string;
  userId: string;
  nickname: string;
  role: Role | null;
  ready: boolean;
  lastSeen: number;
};
export type Lock = {
  digits: (number | null)[];
  attempts: number;
  nextAttemptAt: number | null;
  openedAt: number | null;
};
export type Game = {
  id: string;
  code: string;
  courseId: string;
  demoOwner: string | null;
  status: "lobby" | "briefing" | "equip" | "playing" | "done";
  phase: "travel" | "mission" | "cleared";
  version: number;
  hostId: string;
  members: Member[];
  siteIndex: number;
  score: number;
  revealAt: number | null;
  siteStartedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  expiresAt: number;
  locks: Record<string, Lock>;
  reports: Record<
    string,
    Partial<Record<Role, { userId: string; digit: number; at: number }>>
  >;
  arrivals: {
    siteId: string;
    memberId: string;
    manual: boolean;
    simulated: boolean;
    at: number;
  }[];
  receipts: Record<string, { hash: string; result: Record<string, unknown> }>;
  reportTimes: Record<string, number>;
};
export type Command = {
  action: string;
  request_id?: string;
  game_id?: string;
  site_id?: string;
  nickname?: string;
  code?: string;
  role?: Role;
  answer?: string;
  digits?: number[];
  manual?: boolean;
  demo_role?: Role;
  simulated?: boolean;
  seconds?: number;
};
export type PublicGame = {
  id: string;
  code: string;
  status: Game["status"];
  site_phase: Game["phase"];
  version: number;
  score: number;
  current_site_seq: number;
  host_member_id: string;
  reveal_at: number | null;
  site_started_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  report_mask: boolean[];
  locked_mask: boolean[];
  attempts_left: number;
  next_attempt_at: number | null;
  acquired_sites: SiteInfo[];
  members: {
    id: string;
    nickname: string;
    role: Role | null;
    ready: boolean;
    online: boolean;
  }[];
  demo: boolean;
};
export type Snapshot = {
  server_now: number;
  version: number;
  course: {
    id: string;
    name: string;
    confirmed: boolean;
    demo: boolean;
    sites: SiteInfo[];
  };
  current_site: SiteInfo;
  game: PublicGame;
  self: {
    id: string;
    nickname: string;
    role: Role | null;
    is_host: boolean;
    ready: boolean;
    reported: boolean;
    digit: number | null;
    clue: Clue | null;
    lock: Lock | null;
  };
  result?: Record<string, unknown>;
};
