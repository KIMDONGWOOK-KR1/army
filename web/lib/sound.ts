// 호국실록 소리 엔진(WebAudio). 소리 파일 없이 lib/sound-synth.ts의 합성 재료로만 낸다.
//
// 쓰는 법(다른 화면에서):
//   import { play, staticNoise } from "@/lib/sound";
//   play("join");                  // 팀원 합류
//   play("role-reveal");           // 보직 공개
//   const s = staticNoise();       // 주파수 미션의 무전 잡음
//   s.setSignal(0.7);              // 0(잡음)~1(맑음)
//   s.stop();                      // 화면을 떠날 때
//   play("dial-tick");             // 다이얼 한 칸(빠르게 불러도 엔진이 알아서 솎는다)
// 버튼을 누르면 화면 공통으로 탭 소리가 난다(components/use-sound-cues.ts).
// 버튼에 data-sound="none"을 달면 탭 소리를 빼고, data-sound="confirm"처럼 이름을 달면 그 소리를 낸다.
//
// - 아무 것도 던지지 않는다. AudioContext가 없거나(서버·시험) 막혀 있으면 조용히 넘어간다.
// - iOS Safari 규칙대로 사용자가 처음 누를 때 unlock()으로 소리를 연다. 그 전의 효과음은 버리고,
//   배경음은 원하는 분위기만 기억했다가 열리는 순간 시작한다.
// - 끄기 상태는 localStorage "hoguk:sound"("off"=끔)에 남긴다. 아무 값이 없으면 켠 상태다.
// - 배경음 갈래는 DEFAULT_BGM_STYLE(산책)이다. 주소에 ?bgm=a|b|c를 붙이면 그 갈래로 들어 볼 수
//   있다(브라우저에서 처음 배경음을 고를 때 한 번만 읽고, 틀린 값은 무시한다).
import {
  DEFAULT_BGM_STYLE,
  MOODS,
  SOUND_NAMES,
  bgmSamples,
  buildChain,
  createBgmDeck,
  duckBgm,
  parseBgmStyle,
  radioStatic,
  renderSound,
  warmSample,
  type BgmDeck,
  type BgmStyle,
  type Chain,
  type Mood,
  type SampleRef,
  type SoundName,
  type SoundOptions,
} from "./sound-synth";

export type { BgmStyle, Mood, SoundName, SoundOptions } from "./sound-synth";
export {
  BGM_STYLES,
  BGM_STYLE_NAMES,
  DEFAULT_BGM_STYLE,
  MOODS,
  SOUND_NAMES,
} from "./sound-synth";

export const SOUND_KEY = "hoguk:sound";
// 너무 촘촘히 부르면 솎는 간격(초): 다이얼·타자처럼 빠르게 이어지는 소리
const GAP: Partial<Record<SoundName, number>> = {
  "dial-tick": 0.035,
  typewriter: 0.03,
  "lock-tick": 0.02,
  tap: 0.06,
  confirm: 0.08,
};

const state = {
  ctx: null as AudioContext | null,
  chain: null as Chain | null,
  deck: null as BgmDeck | null,
  broken: false,
  unlocked: false,
  primed: false,
  resumeAt: -Infinity,
  muted: null as boolean | null,
  desired: null as Mood | null,
  level: 1,
  style: null as BgmStyle | null,
  timer: 0,
  // 미리 계산할 배경음 표본(한가한 틈에 몇 ms씩)
  warm: [] as SampleRef[],
  warmTimer: false,
  last: new Map<SoundName, number>(),
  listeners: new Set<() => void>(),
  installed: 0,
  uninstall: null as (() => void) | null,
};

// ── 끄기 상태 ─────────────────────────────────────────────────────────
export function readMuted(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(SOUND_KEY) === "off";
  } catch {
    return false;
  }
}
export function writeMuted(
  storage: Pick<Storage, "setItem"> | null,
  muted: boolean,
) {
  try {
    storage?.setItem(SOUND_KEY, muted ? "off" : "on");
  } catch {}
}
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function isMuted(): boolean {
  if (state.muted === null) state.muted = readMuted(storage());
  return state.muted;
}
export function subscribeMuted(listener: () => void) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}
export function setMuted(muted: boolean) {
  const changed = isMuted() !== muted;
  state.muted = muted;
  writeMuted(storage(), muted);
  if (!changed) return;
  applyMute();
  for (const l of state.listeners) l();
}
function applyMute() {
  const { ctx, chain } = state;
  if (!ctx || !chain) return;
  try {
    const now = ctx.currentTime;
    chain.master.gain.cancelScheduledValues(now);
    chain.master.gain.setTargetAtTime(state.muted ? 0 : 1, now, 0.04);
    if (state.muted)
      // 끈 뒤에는 오디오 처리를 멈춰 전지를 아낀다
      window.setTimeout(() => {
        if (state.muted && state.ctx?.state === "running")
          void state.ctx.suspend().catch(() => {});
      }, 300);
    else resume();
  } catch {}
  syncBgm();
}

// ── 오디오 열기 ───────────────────────────────────────────────────────
type Activation = { hasBeenActive?: boolean; isActive?: boolean };
type NavigatorAudio = Navigator & {
  userActivation?: Activation;
  getAutoplayPolicy?: (kind: string) => string;
};
function gestureSeen() {
  try {
    const nav = navigator as NavigatorAudio;
    if (nav.userActivation?.hasBeenActive) return true;
    return nav.getAutoplayPolicy?.("audiocontext") === "allowed";
  } catch {
    return false;
  }
}
function context(): AudioContext | null {
  if (state.ctx) return state.ctx;
  if (state.broken || typeof window === "undefined") return null;
  if (!state.unlocked && !gestureSeen()) return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) {
    state.broken = true;
    return null;
  }
  try {
    const ctx = new AC({ latencyHint: "interactive" });
    const chain = buildChain(ctx);
    chain.master.gain.value = isMuted() ? 0 : 1;
    chain.bgm.gain.value = state.level;
    state.ctx = ctx;
    state.chain = chain;
    state.deck = createBgmDeck(ctx, chain.bgm);
    // 꺼 둔 채 열었으면 처리도 멈춰 둔다(켜면 resume)
    if (isMuted()) void ctx.suspend().catch(() => {});
  } catch {
    state.broken = true;
    return null;
  }
  return state.ctx;
}
function resume() {
  const ctx = state.ctx;
  if (!ctx || isMuted() || ctx.state === "running" || ctx.state === "closed")
    return;
  try {
    state.resumeAt = performance.now();
    void ctx.resume().then(syncBgm, () => {});
  } catch {}
}
// 사용자가 누른 처리 안에서 부른다(iOS는 그때만 소리를 열어 준다)
export function unlock() {
  try {
    const nav = navigator as NavigatorAudio;
    // Esc처럼 사용자 활성으로 치지 않는 입력에서는 열지 않는다(콘솔 경고 방지)
    if (nav.userActivation && !nav.userActivation.isActive && !gestureSeen())
      return;
  } catch {}
  state.unlocked = true;
  const ctx = context();
  if (!ctx) return;
  resume();
  if (!state.primed) {
    // 예전 iOS는 몸짓 안에서 실제로 무엇이든 한 번 재생해야 풀린다(1표본 무음)
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      state.primed = true;
    } catch {}
  }
  syncBgm();
}
// 처음 누를 때 열기, 화면을 가리면 멈추기, 다른 탭에서 끈 것 따르기. 정리 함수를 돌려준다.
export function installSoundListeners(): () => void {
  if (typeof window === "undefined") return () => {};
  if (state.installed++ === 0) {
    const onGesture = () => unlock();
    const kinds = ["pointerup", "touchend", "mousedown", "keydown", "click"];
    const opts = { capture: true, passive: true } as const;
    for (const k of kinds) window.addEventListener(k, onGesture, opts);
    const onVisible = () => {
      const ctx = state.ctx;
      if (!ctx) return;
      try {
        if (document.hidden) void ctx.suspend().catch(() => {});
        else resume();
      } catch {}
    };
    document.addEventListener("visibilitychange", onVisible);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SOUND_KEY) setMuted(e.newValue === "off");
    };
    window.addEventListener("storage", onStorage);
    state.uninstall = () => {
      for (const k of kinds) window.removeEventListener(k, onGesture, opts);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--state.installed === 0) {
      state.uninstall?.();
      state.uninstall = null;
    }
  };
}

// ── 효과음 ────────────────────────────────────────────────────────────
export const isSoundName = (v: unknown): v is SoundName =>
  (SOUND_NAMES as readonly unknown[]).includes(v);
function audible(ctx: AudioContext) {
  // 열리는 중(resume 직후)인 소리는 받고, 오래 멈춰 있던 동안의 소리는 버린다
  // (멈춘 시계에 쌓였다가 한꺼번에 터지지 않게)
  return (
    ctx.state === "running" || performance.now() - state.resumeAt < 500
  );
}
export function play(name: SoundName, opts: SoundOptions = {}) {
  if (isMuted() || !isSoundName(name)) return;
  const ctx = context();
  if (!ctx || !state.chain) return;
  try {
    if (!audible(ctx)) return;
    const now = ctx.currentTime,
      gap = GAP[name];
    if (gap) {
      if (now - (state.last.get(name) ?? -Infinity) < gap) return;
      state.last.set(name, now);
    }
    const at = now + 0.01 + Math.max(0, opts.delay ?? 0);
    // 가락 있는 효과음은 그때 배경음의 화음에 맞춰 비키고, 배경음은 잠깐 낮춘다
    const harmony = state.deck?.harmony(at);
    renderSound(ctx, state.chain.sfx, name, at, harmony?.length ? { ...opts, harmony } : opts);
    duckBgm(state.chain, name, at);
    // 실제로 낸 소리 이름을 알린다(e2e 시험·디버깅용, 화면 동작에는 쓰지 않는다)
    window.dispatchEvent(new CustomEvent("hoguk:sound", { detail: name }));
  } catch {}
}

// ── 무전 잡음 ─────────────────────────────────────────────────────────
export type StaticHandle = { setSignal(v: number): void; stop(): void };
const SILENT: StaticHandle = { setSignal() {}, stop() {} };
export function staticNoise(): StaticHandle {
  const ctx = context();
  if (!ctx || !state.chain) return SILENT;
  try {
    const graph = radioStatic(ctx, state.chain.sfx.ui, ctx.currentTime + 0.02);
    return {
      setSignal(v) {
        try {
          if (Number.isFinite(v)) graph.setSignal(v, ctx.currentTime);
        } catch {}
      },
      stop() {
        try {
          graph.stop(ctx.currentTime);
        } catch {}
      },
    };
  } catch {
    return SILENT;
  }
}

// ── 배경음 ────────────────────────────────────────────────────────────
// 주소의 검색 부분(?bgm=b)에서 배경음 갈래를 읽는다. 없거나 틀리면 null
export function bgmStyleFromSearch(search: string): BgmStyle | null {
  try {
    return parseBgmStyle(new URLSearchParams(search).get("bgm"));
  } catch {
    return null;
  }
}
// 지금 쓰는 배경음 갈래. 브라우저에서 처음 물을 때 주소를 한 번만 읽어 둔다(서버에서는 기본값).
export function bgmStyle(): BgmStyle {
  if (state.style) return state.style;
  if (typeof window === "undefined") return DEFAULT_BGM_STYLE;
  let style: BgmStyle | null = null;
  try {
    style = bgmStyleFromSearch(window.location?.search ?? "");
  } catch {}
  state.style = style ?? DEFAULT_BGM_STYLE;
  return state.style;
}
export function startBgm(mood: Mood | null) {
  state.desired = mood && (MOODS as readonly string[]).includes(mood) ? mood : null;
  // 화면 이동으로 주소의 ?bgm=이 사라지기 전에 읽어 둔다
  bgmStyle();
  syncBgm();
}
export function stopBgm() {
  startBgm(null);
}
// 나레이션·자물쇠 아래로 배경음을 낮춘다(1=그대로, 0=무음)
export function setBgmLevel(level: number) {
  state.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
  const { ctx, chain } = state;
  if (!ctx || !chain) return;
  try {
    chain.bgm.gain.setTargetAtTime(state.level, ctx.currentTime, 0.35);
  } catch {}
}
function syncBgm() {
  const { ctx, deck } = state;
  if (!ctx || !deck) return;
  const want = isMuted() ? null : state.desired;
  let changed = false;
  try {
    const style = bgmStyle();
    changed = deck.set(want, style, (Math.random() * 2 ** 31) | 0, ctx.currentTime);
    if (changed && want) {
      // 이 분위기가 쓸 표본을 미리 계산해 둔다(다른 박 있는 분위기는 뜯는 줄만 빼고)
      const other = want === "home" ? "field" : want === "field" ? "home" : null;
      warmUp([
        ...bgmSamples(want, style),
        ...(other ? bgmSamples(other, style, false) : []),
      ]);
      // 시작한 분위기·갈래를 알린다(e2e 시험·디버깅용, 화면 동작에는 쓰지 않는다)
      window.dispatchEvent(
        new CustomEvent("hoguk:bgm", { detail: { mood: want, style } }),
      );
    }
  } catch {}
  if (deck.busy && !state.timer) state.timer = window.setInterval(tick, 250);
  // 새 분위기의 첫 마디(표본 계산이 들어 있다)는 장면을 바꾸는 React 효과 밖에서 만든다
  if (changed) window.setTimeout(tick, 0);
  else tick();
}
function tick() {
  const { ctx, deck } = state;
  if (!ctx || !deck) return;
  if (!deck.busy) {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = 0;
    return;
  }
  if (ctx.state !== "running") {
    // 끈 채 멈춰 있으면 깨우지 않는다(다시 켜면 syncBgm이 다시 돌린다)
    if (!deck.mood && state.timer) {
      window.clearInterval(state.timer);
      state.timer = 0;
    }
    return;
  }
  try {
    deck.tick(ctx.currentTime);
  } catch {}
}
// 표본 미리 계산: 한가한 틈(없으면 짧은 타이머)마다 4ms 안쪽으로 몇 개씩. 분위기가 바뀌면 목록을 갈아 끼운다
function warmUp(refs: SampleRef[]) {
  state.warm = refs;
  if (!state.warmTimer) nextWarm();
}
function nextWarm() {
  if (!state.warm.length) return;
  state.warmTimer = true;
  const run = () => {
    state.warmTimer = false;
    const ctx = state.ctx;
    if (!ctx) return;
    const until = performance.now() + 4;
    try {
      while (state.warm.length && performance.now() < until)
        warmSample(ctx, state.warm.shift()!);
    } catch {
      state.warm = [];
    }
    nextWarm();
  };
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function")
    w.requestIdleCallback(run, { timeout: 300 });
  else window.setTimeout(run, 30);
}

// ── 장면에 맞춘 분위기(순수 함수, 시험 대상) ──────────────────────────
// 첫 화면·입장·로비·보직·장비·완료는 밝은 home, 이동은 field.
// 추모 거점(5·18 사적지)에 도착한 뒤(원판·나레이션·단서·자물쇠)와 사초 장면은 memorial
// (가락 없는 낮은 숨결). 다른 거점의 단서·자물쇠는 field를 낮춰 깐다.
// hushed: 이동 중 5·18 조용한 구역 안(추모 거점에 다가가는 길·도착 범위, 추모 거점을 막 떠나는 길).
// 그곳에서는 북·가락 없이 memorial 숨결만 깐다(도착하면 그대로 이어진다).
export function moodForScene(scene: string, reverent = false, hushed = false): Mood {
  switch (scene) {
    case "travel":
      return hushed ? "memorial" : "field";
    case "sacho":
      return "memorial";
    case "mission":
    case "report":
    case "waiting":
    case "lock":
      return reverent ? "memorial" : "field";
    default:
      return "home";
  }
}
// 나레이션 아래는 크게, 자물쇠·보직 공개·단서 풀이 중에는 조금 낮춘다.
// 나레이션 아래: 추모 숨결(memorial)은 예전대로 0.3, 박 있는 배경음은 커진 만큼 더 낮춰
// 타자 소리 위로 예전과 비슷한 크기로만 깔리게 한다. 크기는 장소가 아니라 실제 분위기로 정한다.
export function bgmLevelForScene(
  scene: string,
  narration = false,
  mood: Mood = moodForScene(scene),
): number {
  if (narration) return mood === "memorial" ? 0.3 : 0.16;
  switch (scene) {
    case "lock":
      return 0.45;
    case "briefing":
      return 0.5;
    case "mission":
      return 0.7;
    default:
      return 1;
  }
}
