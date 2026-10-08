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
  // 시연 장면 건너뛰기: site_id 거점의 이동·단서·자물쇠 단계, 또는 작전 완료
  stage?: "travel" | "mission" | "lock" | "done";
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

// PR-1: v2 content contracts only. The v1 engine/Snapshot remains unchanged.
export type StageKind = "prologue" | "mission" | "memorial" | "epilogue";
export type VerifyMethod = "field" | "official_digital" | "explained" | "simulated" | "proxy";
export type StepType =
  | "truefalse" | "order" | "match" | "choice" | "multi-choice"
  | "frequency" | "words" | "spot-correct" | "text" | "observation"
  | "record-form" | "fill-blank" | "confirm";
export type Grading = "hash" | "set-hash" | "order-hash" | "map-hash" | "record" | "open" | "confirm";
export type StepAnswer = string | string[] | Record<string, string>;
export type StepRef = { role: Role; stepId: string };
export type SceneText = {
  id: string;
  channel: "narration" | "guide" | "screen";
  text: string;
  // Render only when this server-side event occurs; never on stage fetch alone.
  trigger: "enter" | "role-reveal" | "ready" | "retry" | "role-complete" | "reports-ready" | "stage-complete" | "scout-reported";
};
export type FieldSpec = { id: string; label: string; required: boolean; maxLen: number };
export type Step = {
  id: string;
  confirmed: boolean;
  type: StepType;
  prompt: string;
  choices?: string[]; // Wire choice IDs are decimal strings "1" ... "N".
  statements?: string[]; // truefalse: answer array in this exact order.
  fields?: FieldSpec[]; // match: keys to associate with choices; record: input fields.
  requires?: StepRef[];
  requiresReports?: Role[];
  grading: Grading;
  sourceRequired?: boolean;
  sourceIds?: string[];
  answerCount?: number;
  maxLen?: number;
  note?: string;
};
export type RoleMission = {
  intro: SceneText;
  scenes: SceneText[];
  steps: Step[];
  digit: boolean;
  asset?: { url: string | null; alt: string; confirmed: boolean };
};
export type Stage = {
  id: string;
  seq: number;
  kind: StageKind;
  name: string;
  confirmed: boolean;
  arrival: {
    mode: "gps" | "qr" | "manual" | "none";
    confirmed: boolean;
    require: "all" | "any";
    lat: number | null;
    lng: number | null;
    radiusM?: number;
    noticeM?: number;
    dwellSec?: number;
    note?: string;
  };
  quiet: boolean;
  scoring: {
    enabled: boolean;
    confirmed: boolean;
    hintPenalty: Record<1 | 2 | 3, number | null>;
    noHintBonus: number | null;
    note?: string;
  };
  narration: SceneText[];
  roles: Record<Role, RoleMission | null>;
  completion:
    | { type: "lock"; order: Role[] }
    | { type: "confirm"; labels: Record<Role, string> }
    | { type: "joint-record" };
  sacho?: { id: string; name: string; sections: string[] };
  altModes?: { id: string; label: string }[];
};
export type CourseV2Content = {
  schemaVersion: 2;
  id: string;
  name: string;
  confirmed: boolean;
  demo: boolean;
  sources: { id: string; title: string; url: string }[];
  settings: { teamSize: 4; roleSwapEnabled: boolean; roleSwapSeconds: 30; note: string };
  stages: Stage[];
  note?: string;
};
export type StepPrivate = {
  answerHash?: string;
  rubric?: { required: string[] };
  explanation: string;
  reward?: string;
};
export type TransferClue = {
  kind: "relay-frequency";
  label: string;
  value: string;
  targetStepId: string;
};
export type RolePrivate = {
  digit?: number;
  // User decision: three levels per role, not duplicated per step.
  hints: [string, string, string];
  transferClue?: TransferClue; // Commander only; never a public course property.
};
export type StagePrivate = {
  roles: Record<Role, RolePrivate | null>;
  steps: Record<string, StepPrivate>;
};
export type CourseV2 = CourseV2Content & {
  private: { stages: Record<string, StagePrivate> };
};
export type CourseV2PrivateInput = {
  schemaVersion: 2;
  courseId: string;
  synthetic: boolean;
  stages: Record<string, {
    roles: Record<Role, RolePrivate | null>;
    steps: Record<string, Omit<StepPrivate, "answerHash"> & { answer?: StepAnswer }>;
  }>;
};
