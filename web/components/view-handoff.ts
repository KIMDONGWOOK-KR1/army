// 폰 목업 보기를 켜고 끌 때 게임 화면 상태를 넘긴다.
// 보기를 바꾸면 GameApp이 다른 문서(바깥 ↔ 틀 안 iframe)에서 새로 올라오므로 React 안에만 있던 값이 사라진다.
// 그래서 목업을 고를 수 있는 기기에서는 지금 값(자동 시연, 보고/자물쇠 화면, 입력 중인 자물쇠 숫자)을
// sessionStorage(같은 출처 iframe과 함께 쓴다)에 늘 적어 두고, 보기를 바꾼 직후 새로 올라온 GameApp만 읽어 이어 간다.
// 그냥 새로 고침할 때는 읽지 않는다(지금처럼 처음 화면에서 시작한다).
export type Pane = "report" | "lock" | "waiting" | "mission" | "summary";
export type Rehearsal = {
  game: string;
  step: "lobby" | "briefing";
  count: number;
};
export type Handoff = {
  game: string | null;
  site: string | null;
  role: string | null;
  auto: boolean;
  // 모이기·보직 공개 미리 보기를 이미 시작한 작전(이어 갈 때 처음부터 다시 틀지 않는다)
  rehearsed: string | null;
  // 바꾸는 순간 보던 미리 보기 단계(그 단계부터 이어 간다)
  rehearsal: Rehearsal | null;
  pane: Pane;
  lock: { scope: string; digits: string[] } | null;
};

export const HANDOFF_KEY = "hoguk:view-handoff";
// 보기를 바꾼 때(ms). 이 시간 안에 올라온 GameApp만 넘겨받는다(틀이 끝내 뜨지 않아도 다음 새로 고침에 남지 않게).
export const SWITCH_KEY = "hoguk:view-switch";
export const SWITCH_TTL = 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): Store | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function saveHandoff(h: Handoff, store = session()) {
  try {
    store?.setItem(HANDOFF_KEY, JSON.stringify(h));
  } catch {}
}

// 보기를 바꾸기 바로 전에 부른다(app-shell.tsx)
export function markViewSwitch(now = Date.now(), store = session()) {
  try {
    store?.setItem(SWITCH_KEY, String(now));
  } catch {}
}

const PANES: readonly string[] = ["report", "lock", "waiting", "mission", "summary"];
function parse(raw: string | null): Handoff | null {
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Partial<Handoff> | null;
    if (!h || typeof h !== "object" || typeof h.auto !== "boolean") return null;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const lock =
      h.lock &&
      typeof h.lock.scope === "string" &&
      Array.isArray(h.lock.digits) &&
      h.lock.digits.every((d) => typeof d === "string")
        ? { scope: h.lock.scope, digits: h.lock.digits }
        : null;
    const r = h.rehearsal;
    const rehearsal =
      r &&
      typeof r.game === "string" &&
      (r.step === "lobby" || r.step === "briefing") &&
      Number.isInteger(r.count)
        ? { game: r.game, step: r.step, count: r.count }
        : null;
    return {
      game: str(h.game),
      site: str(h.site),
      role: str(h.role),
      auto: h.auto,
      rehearsed: str(h.rehearsed),
      rehearsal,
      pane: PANES.includes(h.pane as string) ? (h.pane as Pane) : "report",
      lock,
    };
  } catch {
    return null;
  }
}

// 보기를 바꾼 직후에 올라온 GameApp이 한 번 부른다. 바꾼 표시는 읽자마자 지운다.
export function takeHandoff(now = Date.now(), store = session()) {
  try {
    const at = Number(store?.getItem(SWITCH_KEY));
    if (!at) return null;
    store?.removeItem(SWITCH_KEY);
    if (now - at < 0 || now - at > SWITCH_TTL) return null;
    return parse(store?.getItem(HANDOFF_KEY) ?? null);
  } catch {
    return null;
  }
}

// 넘겨받은 보고/자물쇠 화면은 같은 작전·거점·보직일 때만 다시 연다
export function handoffPane(
  h: Handoff | null,
  s: { game: string; site: string; role: string | null } | null,
): Pane | null {
  if (!h || !s) return null;
  return h.game === s.game && h.site === s.site && h.role === s.role
    ? h.pane
    : null;
}
