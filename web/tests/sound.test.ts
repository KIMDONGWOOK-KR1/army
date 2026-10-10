import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BGM_STYLES,
  BRIGHT,
  DEFAULT_BGM_STYLE,
  EB_MAJOR,
  MEMORIAL_BREATH,
  MEMORIAL_NOTES,
  PYEONG,
  barLength,
  bgmSamples,
  bgmSwitch,
  bgmTempo,
  clashes,
  compose,
  composeBar,
  createComposer,
  eventSamples,
  fitNotes,
  harmonyAt,
  hz,
  ksSamples,
  parseBgmStyle,
  sampleKey,
  softClipCurve,
  type BgmEvent,
  type BgmStyle,
} from "../lib/sound-synth";
import {
  SOUND_KEY,
  bgmLevelForScene,
  bgmStyleFromSearch,
  moodForScene,
  readMuted,
  writeMuted,
} from "../lib/sound";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

// 매 시험마다 엔진 모듈을 새로 읽는다(끄기 상태는 처음 물을 때 저장소에서 읽는다)
async function freshEngine() {
  vi.resetModules();
  return import("../lib/sound");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("소리 끄기 저장", () => {
  it("추모 단계는 사용자 음향 설정과 독립적으로 효과음·잡음을 차단한다", async () => {
    const store = memoryStorage({ [SOUND_KEY]: "on" });
    let contexts = 0;
    class UnavailableAudio {
      constructor() { contexts++; throw new Error("test audio unavailable"); }
    }
    vi.stubGlobal("window", { localStorage: store, AudioContext: UnavailableAudio });
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true, isActive: true } });
    const engine = await freshEngine();
    engine.setSceneQuiet(true);
    engine.setMuted(false);
    engine.play("confirm"); engine.play("sacho"); engine.staticNoise();
    expect(contexts).toBe(0);
    expect(store.data.get(SOUND_KEY)).toBe("on");
    engine.setSceneQuiet(false);
    engine.play("confirm");
    expect(contexts).toBe(1);
  });
  it("값이 없으면 켠 상태이고 'off'만 끈 상태다", () => {
    expect(readMuted(null)).toBe(false);
    expect(readMuted(memoryStorage())).toBe(false);
    expect(readMuted(memoryStorage({ [SOUND_KEY]: "on" }))).toBe(false);
    expect(readMuted(memoryStorage({ [SOUND_KEY]: "off" }))).toBe(true);
  });
  it("저장소가 막혀도 던지지 않는다", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(readMuted(broken)).toBe(false);
    expect(() => writeMuted(broken, true)).not.toThrow();
  });
  it("끄고 켠 값을 hoguk:sound에 남기고 다시 읽는다", async () => {
    const store = memoryStorage();
    vi.stubGlobal("window", { localStorage: store });
    const engine = await freshEngine();
    expect(engine.isMuted()).toBe(false);
    const heard: boolean[] = [];
    const off = engine.subscribeMuted(() => heard.push(engine.isMuted()));
    engine.setMuted(true);
    expect(store.data.get(SOUND_KEY)).toBe("off");
    expect(engine.isMuted()).toBe(true);
    engine.setMuted(true);
    engine.setMuted(false);
    expect(store.data.get(SOUND_KEY)).toBe("on");
    off();
    engine.setMuted(true);
    expect(heard).toEqual([true, false]);
    // 새로 열어도(새로고침) 끈 상태가 이어진다
    const again = await freshEngine();
    expect(again.isMuted()).toBe(true);
  });
});

describe("장면별 배경음", () => {
  it("첫 화면·로비는 home, 이동은 field", () => {
    for (const scene of ["title", "enroll", "lobby", "briefing", "equip", "done"])
      expect(moodForScene(scene)).toBe("home");
    expect(moodForScene("travel")).toBe("field");
    expect(moodForScene("travel", true)).toBe("field");
  });
  it("이동 중 5·18 조용한 구역 안에서는 북·가락 없는 memorial 숨결", () => {
    expect(moodForScene("travel", true, true)).toBe("memorial");
    expect(moodForScene("travel", false, true)).toBe("memorial");
    // 조용한 구역은 이동 장면에만 쓴다(도착 뒤에는 거점의 추모 여부로)
    expect(moodForScene("mission", false, true)).toBe("field");
    expect(moodForScene("equip", false, true)).toBe("home");
  });
  it("추모 거점에 도착하면 가락 없는 memorial, 다른 거점은 field", () => {
    for (const scene of ["mission", "report", "waiting", "lock"]) {
      expect(moodForScene(scene, true)).toBe("memorial");
      expect(moodForScene(scene, false)).toBe("field");
    }
    expect(moodForScene("sacho", false)).toBe("memorial");
    expect(moodForScene("sacho", true)).toBe("memorial");
  });
  it("나레이션·자물쇠 아래에서는 배경음을 낮춘다", () => {
    expect(bgmLevelForScene("travel")).toBe(1);
    expect(bgmLevelForScene("travel", true)).toBeLessThanOrEqual(0.35);
    expect(bgmLevelForScene("lock")).toBeLessThan(0.6);
    expect(bgmLevelForScene("mission")).toBeLessThan(1);
    expect(bgmLevelForScene("lock", true)).toBe(bgmLevelForScene("travel", true));
  });
  it("나레이션 아래 크기는 장소가 아니라 실제 분위기로: 박 있는 배경음 0.16, 추모 숨결 0.3", () => {
    // use-sound-cues.ts와 같은 방법: 분위기를 먼저 정하고 그 분위기로 크기를 정한다
    const level = (scene: string, reverent: boolean, hushed = false) =>
      bgmLevelForScene(scene, true, moodForScene(scene, reverent, hushed));
    // 첫 거점(정문)이 추모 거점이어도 시작 나레이션(브리핑·장비·이동)은 박 있는 배경음 위에 깔린다
    for (const scene of ["briefing", "equip", "travel"])
      expect(level(scene, true)).toBeLessThanOrEqual(0.2);
    // 사초는 어느 거점에서나 추모 숨결이므로 예전 크기 그대로
    expect(level("sacho", false)).toBe(0.3);
    expect(level("sacho", true)).toBe(0.3);
    expect(bgmLevelForScene("sacho", true)).toBe(0.3);
    expect(level("mission", true)).toBe(0.3);
    expect(level("mission", false)).toBeLessThanOrEqual(0.2);
    expect(level("travel", true, true)).toBe(0.3);
  });
});

describe("배경음 분위기 넘기기", () => {
  // 시간 상수 tau로 줄어드는 음량이 at 뒤 dt초에 남는 크기(dB)
  const leftDb = (tau: number, dt: number) => (20 * Math.log10(Math.exp(-dt / tau))) | 0;
  it("추모 숨결로 갈 때는 앞 분위기(북·베이스)를 곧장 줄인다: 0.6초 뒤 −30dB 아래", () => {
    for (const from of ["field", "home"] as const) {
      const p = bgmSwitch({ mood: from, next: 13.7 }, "memorial", 12);
      expect(p.oldAt).toBe(12);
      expect(leftDb(p.oldTau, 0.6)).toBeLessThan(-30);
    }
  });
  it("박 있는 두 분위기 사이는 앞 분위기의 마디 끝에서 새 분위기가 첫 박을 친다", () => {
    const p = bgmSwitch({ mood: "home", next: 21.3 }, "field", 20);
    expect(p.start).toBe(21.3);
    expect(p.oldAt).toBe(21.3);
    expect(p.rampFrom).toBeLessThan(p.start);
    expect(p.rampTo).toBeGreaterThan(p.start);
    // 앞 분위기가 밀려 있으면(화면이 멈췄다 돌아오면) 바로 다음 순간에
    expect(bgmSwitch({ mood: "field", next: 3 }, "home", 20).start).toBeCloseTo(20.2, 9);
  });
  it("처음 시작과 추모 숨결에서 나올 때는 천천히 차오른다", () => {
    for (const from of [null, { mood: "memorial" as const, next: 30 }]) {
      const p = bgmSwitch(from, "field", 20);
      expect(p.start).toBeCloseTo(20.2, 9);
      expect(p.rampTo - p.rampFrom).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("AudioContext가 없을 때", () => {
  const callEverything = (engine: Awaited<ReturnType<typeof freshEngine>>) => {
    engine.unlock();
    const off = engine.installSoundListeners();
    for (const name of engine.SOUND_NAMES) engine.play(name, { delay: 0.1 });
    engine.play("no-such-sound" as never);
    engine.startBgm("field");
    engine.setBgmLevel(0.3);
    engine.setBgmLevel(Number.NaN);
    engine.startBgm("memorial");
    engine.stopBgm();
    const s = engine.staticNoise();
    s.setSignal(0.5);
    s.setSignal(Number.NaN);
    s.stop();
    s.stop();
    engine.setMuted(true);
    engine.setMuted(false);
    off();
  };
  it("서버(창 없음)에서는 모두 조용히 아무것도 하지 않는다", async () => {
    const engine = await freshEngine();
    expect(() => callEverything(engine)).not.toThrow();
  });
  it("브라우저에 AudioContext가 없어도 던지지 않는다", async () => {
    const listeners: string[] = [];
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      addEventListener: (k: string) => listeners.push(k),
      removeEventListener: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
    });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true, isActive: true } });
    const engine = await freshEngine();
    expect(() => callEverything(engine)).not.toThrow();
    expect(listeners).toContain("touchend");
  });
  it("AudioContext 만들기가 실패해도 던지지 않는다", async () => {
    class Broken {
      constructor() {
        throw new Error("NotAllowedError");
      }
    }
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      AudioContext: Broken,
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: () => 1,
    });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true, isActive: true } });
    const engine = await freshEngine();
    expect(() => callEverything(engine)).not.toThrow();
  });
  it("사용자가 누르기 전에는 AudioContext를 만들지 않는다", async () => {
    let made = 0;
    class Counting {
      constructor() {
        made++;
        throw new Error("stop here");
      }
    }
    vi.stubGlobal("window", { localStorage: memoryStorage(), AudioContext: Counting });
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false, isActive: false } });
    const engine = await freshEngine();
    engine.play("tap");
    engine.startBgm("home");
    engine.unlock();
    expect(made).toBe(0);
  });
});

describe("배경음 작곡", () => {
  type Tonal = "field" | "home";
  const TONAL: Tonal[] = ["field", "home"];
  const plucks = (events: BgmEvent[]) =>
    events.filter(
      (e): e is Extract<BgmEvent, { kind: "pluck" }> => e.kind === "pluck",
    );
  const pitches = (e: BgmEvent): number[] =>
    e.kind === "pluck" || e.kind === "bell" || e.kind === "bass" || e.kind === "arp"
      ? [e.note]
      : e.kind === "pad" || e.kind === "mallet" || e.kind === "drone"
        ? e.notes
        : [];
  // 마디마다 나눠 만든다(마디 시작 시각과 그 마디의 소리)
  const bars = (mood: Tonal, style: BgmStyle, seed: number, seconds: number) => {
    const c = createComposer(mood, seed, 0, style),
      out: { t: number; events: BgmEvent[] }[] = [];
    while (c.t < seconds) {
      const t = c.t;
      out.push({ t, events: composeBar(c) });
    }
    return out;
  };

  it("같은 씨앗·갈래면 같은 곡, 씨앗이나 갈래가 다르면 다른 곡", () => {
    for (const style of BGM_STYLES)
      for (const mood of TONAL) {
        const a = compose(createComposer(mood, 42, 0, style), 60);
        expect(compose(createComposer(mood, 42, 0, style), 60)).toEqual(a);
        expect(compose(createComposer(mood, 43, 0, style), 60)).not.toEqual(a);
        for (const other of BGM_STYLES)
          if (other !== style)
            expect(compose(createComposer(mood, 42, 0, other), 60)).not.toEqual(a);
      }
  });
  it("기본 갈래는 산책(a)이다", () => {
    expect(DEFAULT_BGM_STYLE).toBe("a");
    expect(compose(createComposer("field", 5), 60)).toEqual(
      compose(createComposer("field", 5, 0, "a"), 60),
    );
  });
  it("추모 분위기에는 가락·북·종이 없고 같은 낮은 음만 숨 쉬듯 이어진다", () => {
    const events = compose(createComposer("memorial", 7), 120);
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) {
      expect(e.kind).toBe("drone");
      if (e.kind === "drone") {
        expect(e.notes).toEqual(MEMORIAL_NOTES);
        expect(e.gain).toBeLessThanOrEqual(0.03);
      }
    }
    // 이어지는 숨이 겹쳐 끊기지 않는다
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1] as { t: number; dur: number };
      expect(events[i].t).toBeLessThan(prev.t + prev.dur);
    }
  });
  it("추모 분위기는 갈래·씨앗과 상관없이 예전 그대로다", () => {
    const before = Array.from({ length: 20 }, (_, i) => ({
      kind: "drone",
      t: 3 + i * MEMORIAL_BREATH,
      dur: MEMORIAL_BREATH * 1.6,
      notes: [39, 46, 51, 58],
      gain: 0.02,
    }));
    expect(MEMORIAL_BREATH).toBe(6);
    for (const style of BGM_STYLES)
      for (const seed of [1, 7, 99]) {
        expect(compose(createComposer("memorial", seed, 3, style), 120)).toEqual(before);
        expect(barLength("memorial", style)).toBe(6);
      }
  });
  it("빠르기: 산책 104~112, 모험 120~126, 장단 점4분음표 95~105", () => {
    const range: Record<BgmStyle, [number, number]> = {
      a: [104, 112],
      b: [120, 126],
      c: [95, 105],
    };
    for (const style of BGM_STYLES)
      for (const mood of TONAL) {
        const bpm = bgmTempo(mood, style);
        expect(bpm).toBeGreaterThanOrEqual(range[style][0]);
        expect(bpm).toBeLessThanOrEqual(range[style][1]);
        expect(barLength(mood, style)).toBeCloseTo(240 / bpm, 9);
      }
    // 첫 화면은 이동보다 조금 느긋하다
    for (const style of BGM_STYLES)
      expect(bgmTempo("home", style)).toBeLessThanOrEqual(bgmTempo("field", style));
  });
  // 사건이 많아 expect를 하나씩 부르면 느리다: 어긋난 것만 모아 한 번에 본다
  it("값이 모두 유한하고, 마디 안에서 시간 순서대로, 마디 밖으로 나가지 않는다", () => {
    const bad: string[] = [];
    for (const style of BGM_STYLES)
      for (const mood of TONAL) {
        const len = barLength(mood, style),
          list = bars(mood, style, 3, 300);
        list.forEach(({ t, events }, i) => {
          const where = `${style}/${mood} 마디 ${i}`;
          if (Math.abs(t - i * len) > 1e-6) bad.push(`${where}: 시작 ${t}`);
          let prev = t;
          for (const e of events) {
            const what = `${where} ${e.kind}@${e.t}`;
            for (const v of Object.values(e))
              if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${what}: ${v}`);
            if (!(e.t >= prev && e.t < t + len)) bad.push(`${what}: 시간`);
            prev = e.t;
            if (!(e.gain > 0 && e.gain < 0.3)) bad.push(`${what}: 세기 ${e.gain}`);
            if ("dur" in e && !(e.dur > 0)) bad.push(`${what}: 길이`);
            if ("decay" in e && !(e.decay > 0)) bad.push(`${what}: 사라짐`);
            if ("pan" in e && !(Math.abs(e.pan) <= 1)) bad.push(`${what}: 좌우`);
            for (const n of pitches(e))
              if (!(n >= 24 && n <= 96)) bad.push(`${what}: 음높이 ${n}`);
          }
        });
        expect(list.length).toBeGreaterThan(100);
      }
    expect(bad).toEqual([]);
  });
  it("음은 갈래의 음계 안에서만: 가야금 가락은 다섯 음, 화음·베이스는 E♭ 장조(장단은 평조)", () => {
    const bad: string[] = [];
    for (const style of BGM_STYLES)
      for (const mood of TONAL) {
        const lead = style === "c" && mood === "field" ? PYEONG : BRIGHT,
          all = style !== "c" ? EB_MAJOR : mood === "field" ? PYEONG : BRIGHT;
        for (const seed of [1, 2, 3]) {
          const events = compose(createComposer(mood, seed, 0, style), 240);
          const melody = plucks(events).filter(
            (e) => e.inst === "gayageum" && e.note >= 63,
          );
          expect(melody.length).toBeGreaterThan(20);
          for (const e of melody)
            if (!lead.includes(e.note % 12)) bad.push(`${style}/${mood}/${seed} 가락 ${e.note}`);
          for (const e of events)
            for (const n of pitches(e))
              if (!all.includes(n % 12)) bad.push(`${style}/${mood}/${seed} ${e.kind} ${n}`);
        }
      }
    expect(bad).toEqual([]);
  });
  it("이동(field)에는 북·베이스가 있고, 북은 몇 부분마다 빠졌다가 돌아온다", () => {
    for (const style of BGM_STYLES)
      for (const seed of [11, 12, 13]) {
        const list = bars("field", style, seed, 600),
          minutes = 10;
        const count = (k: BgmEvent["kind"]) =>
          list.reduce((n, b) => n + b.events.filter((e) => e.kind === k).length, 0);
        expect(count("drum") / minutes).toBeGreaterThan(60);
        expect(count("bass") / minutes).toBeGreaterThan(60);
        // 북이 없는 마디가 세 마디 넘게 이어지는 '쉼'이 여러 번 있고, 쉼 뒤에는 북이 돌아온다
        const drums = list.map((b) => b.events.some((e) => e.kind === "drum"));
        let rests = 0,
          run = 0,
          longest = 0,
          since = 0;
        drums.forEach((on, i) => {
          if (!on) run++;
          else {
            if (run >= 3) rests++;
            run = 0;
          }
          since = on ? since + 1 : 0;
          longest = Math.max(longest, since);
          if (i === drums.length - 1) expect(on || run < 9).toBe(true);
        });
        expect(rests).toBeGreaterThanOrEqual(4);
        // 북이 쉬지 않고 이어지는 길이는 3분을 넘지 않는다
        expect(longest * barLength("field", style)).toBeLessThan(180);
        expect(drums.filter(Boolean).length).toBeGreaterThan(drums.length * 0.6);
      }
  });
  it("첫 화면(home)은 이동보다 여리고(반주·북 세기) 가락이 높다", () => {
    for (const style of BGM_STYLES)
      for (const seed of [21, 22]) {
        const energy = (mood: Tonal) => {
          const events = compose(createComposer(mood, seed, 0, style), 300);
          const beat = events
            .filter((e) => e.kind === "drum" || e.kind === "bass" || e.kind === "mallet" || e.kind === "arp")
            .reduce((n, e) => n + e.gain, 0);
          const lead = plucks(events).filter((e) => e.inst === "gayageum" && e.note >= 63);
          return {
            beat: beat / 300,
            pitch: lead.reduce((n, e) => n + e.note, 0) / lead.length,
          };
        };
        const field = energy("field"),
          home = energy("home");
        expect(home.beat).toBeLessThan(field.beat * 0.9);
        expect(home.pitch).toBeGreaterThan(field.pitch);
      }
  });
  it("가락은 짧은 동기를 부르고 받는다(같은 리듬이 묶음 안에서 되풀이된다)", () => {
    for (const style of BGM_STYLES) {
      const len = barLength("field", style),
        list = bars("field", style, 31, 600);
      // 마디 안 가야금 가락의 리듬(마디 시작에서 떨어진 칸)
      const rhythm = (events: BgmEvent[]) =>
        plucks(events)
          .filter((e) => e.inst === "gayageum" && e.note >= 63)
          .map((e, _, all) => Math.round(((e.t - all[0].t) / len) * 24))
          .join(",");
      const seen = new Map<string, number>();
      for (const b of list) {
        const r = rhythm(b.events);
        if (r) seen.set(r, (seen.get(r) ?? 0) + 1);
      }
      // 같은 리듬이 여러 번 되풀이되지만(기억에 남게) 한두 가지로만 굳지는 않는다
      expect(Math.max(...seen.values())).toBeGreaterThanOrEqual(4);
      expect(seen.size).toBeGreaterThanOrEqual(6);
    }
  });
  it("네 마디 반복처럼 들리지 않게 매번 달라진다", () => {
    for (const style of BGM_STYLES)
      for (const mood of TONAL) {
        const bar = barLength(mood, style);
        const events = compose(createComposer(mood, 99, 0, style), bar * 32);
        const windows = new Set<string>();
        for (let w = 0; w < 8; w++) {
          const from = w * bar * 4;
          windows.add(
            events
              .filter((e) => e.t >= from && e.t < from + bar * 4)
              .map((e) =>
                "note" in e
                  ? `${e.kind}${e.note}@${Math.round((e.t - from) / (bar / 24))}`
                  : `${e.kind}@${Math.round((e.t - from) / (bar / 24))}`,
              )
              .join(","),
          );
        }
        expect(windows.size).toBeGreaterThanOrEqual(7);
      }
  });
});

describe("배경음 화음과 가락", () => {
  // 효과음 가락(lib/sound-synth.ts RECIPES와 같은 음)
  const SFX: Record<string, number[]> = {
    "clue-correct": [68, 72, 75, 87],
    "lock-open": [63, 68, 70, 75],
    "stop-open": [75, 77, 80, 82, 87],
    join: [68, 70],
    confirm: [75],
    arrive: [70, 75],
    "digit-reveal": [51, 70],
  };
  const melody = (events: BgmEvent[]) =>
    events.filter(
      (e): e is Extract<BgmEvent, { kind: "pluck" }> =>
        e.kind === "pluck" && e.inst === "gayageum" && e.note >= 63,
    );
  it("화음이 없으면(추모·배경음 없음) 효과음 가락을 그대로 낸다", () => {
    for (const notes of Object.values(SFX)) {
      expect(fitNotes(notes)).toEqual(notes);
      expect(fitNotes(notes, [])).toEqual(notes);
    }
  });
  it("효과음 가락은 G·D를 품은 화음 위에서 반음 부딪침 없이, 오르내림 모양 그대로 비킨다", () => {
    const chords = {
      "E♭add9": [3, 7, 10, 5],
      Gm7: [7, 10, 2, 5],
      "A♭maj7": [8, 0, 3, 7],
      "B♭": [5, 10, 2],
      Cm7: [0, 7, 10, 3],
      Fm7: [5, 8, 0, 3],
    };
    const harmonies = [
      ...Object.values(chords).map((c) => [c]),
      [chords["E♭add9"], chords.Gm7],
      [chords.Gm7, chords.Cm7],
      [chords["B♭"], chords["E♭add9"]],
    ];
    const bad: string[] = [];
    for (const h of harmonies)
      for (const [name, notes] of Object.entries(SFX)) {
        const out = fitNotes(notes, h);
        out.forEach((m, i) => {
          if (h.some((pcs) => clashes(m, pcs))) bad.push(`${name} ${m} 부딪침 ${JSON.stringify(h)}`);
          if (Math.abs(m - notes[i]) > 3) bad.push(`${name} ${notes[i]}→${m} 너무 멀리`);
          if (i > 0 && Math.sign(m - out[i - 1]) !== Math.sign(notes[i] - notes[i - 1]))
            bad.push(`${name} 모양이 바뀜 ${out}`);
        });
      }
    expect(bad).toEqual([]);
    // 부딪치지 않는 화음에서는 그대로
    expect(fitNotes(SFX["clue-correct"], [chords.Fm7])).toEqual(SFX["clue-correct"]);
  });
  it("배경음이 울리는 동안 언제 효과음이 나도 반음 부딪침이 없다(10분, 여러 씨앗)", () => {
    const bad: string[] = [];
    for (const style of BGM_STYLES)
      for (const mood of ["field", "home"] as const)
        for (const seed of [1, 2, 3, 4, 5]) {
          const c = createComposer(mood, seed, 0, style);
          for (let t = 0.5; t < 600; t += 0.37) {
            compose(c, t + 0.6);
            const h = harmonyAt(c, t);
            if (!h.length) bad.push(`${style}/${mood}/${seed} ${t}: 화음 없음`);
            for (const [name, notes] of Object.entries(SFX))
              for (const m of fitNotes(notes, h))
                if (h.some((pcs) => clashes(m, pcs))) bad.push(`${style}/${mood}/${seed} ${t} ${name} ${m}`);
          }
        }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it("가야금 가락: 박 위의 음은 화음 음이고, 화음 음 반음 위에 걸리는 음(단9도)이 없다", () => {
    const bad: string[] = [];
    let notes = 0;
    for (const style of BGM_STYLES)
      for (const mood of ["field", "home"] as const)
        for (const seed of [11, 12, 13, 14]) {
          const c = createComposer(mood, seed, 0, style),
            beat = barLength(mood, style) / 4;
          while (c.t < 600) {
            const t0 = c.t,
              events = composeBar(c);
            for (const e of melody(events)) {
              notes++;
              // 박 칸 시각은 ±6ms 흔들려 있으므로 조금 뒤에서 화음을 본다
              const [pcs] = harmonyAt(c, e.t + 0.008, 0);
              const pos = (e.t - t0) / beat;
              if (clashes(e.note, pcs)) bad.push(`${style}/${mood}/${seed} ${e.note}@${e.t.toFixed(2)} 단9도`);
              if (Math.abs(pos - Math.round(pos)) < 0.02 && !pcs.includes(e.note % 12))
                bad.push(`${style}/${mood}/${seed} ${e.note}@${e.t.toFixed(2)} 박 위 화음 밖`);
            }
          }
        }
    expect(notes).toBeGreaterThan(5000);
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it("10분 동안 여덟 마디 묶음이 모두 다르다", () => {
    for (const style of BGM_STYLES)
      for (const mood of ["field", "home"] as const) {
        const c = createComposer(mood, 2026, 0, style),
          sig: string[] = [];
        while (c.t < 600) {
          const t0 = c.t,
            len = barLength(mood, style);
          sig.push(
            composeBar(c)
              .map((e) => `${e.kind}${"note" in e ? e.note : ""}@${Math.round((e.t - t0) / (len / 24))}`)
              .join(","),
          );
        }
        const windows = new Set<string>();
        for (let i = 0; i + 8 <= sig.length; i++) windows.add(sig.slice(i, i + 8).join("|"));
        expect(windows.size).toBe(sig.length - 7);
      }
  });
});

describe("배경음 표본 미리 계산", () => {
  it("미리 계산할 목록이 10분 작곡이 실제로 쓰는 표본을 모두 담는다", () => {
    const missing: string[] = [];
    for (const style of BGM_STYLES)
      for (const mood of ["field", "home"] as const) {
        const warm = new Set(bgmSamples(mood, style).map(sampleKey));
        for (const seed of [1, 2, 3, 4])
          for (const e of compose(createComposer(mood, seed, 0, style), 600))
            for (const r of eventSamples(e)) {
              const k = sampleKey(r);
              if (!warm.has(k)) missing.push(`${style}/${mood} ${k}`);
            }
      }
    expect([...new Set(missing)]).toEqual([]);
  });
  it("뜯는 줄을 빼면 뜯는 줄이 없고, 추모 숨결은 표본이 없다", () => {
    for (const style of BGM_STYLES) {
      expect(bgmSamples("field", style, false).some((r) => r.kind === "pluck")).toBe(false);
      expect(bgmSamples("memorial", style)).toEqual([]);
      // 장단 한 분위기의 뜯는 줄 수는 뜯는 줄 저장 한도(96) 안이다(효과음 몫을 남기고)
      for (const mood of ["field", "home"] as const)
        expect(bgmSamples(mood, style).filter((r) => r.kind === "pluck").length).toBeLessThanOrEqual(80);
    }
  });
});

describe("배경음 갈래 고르기", () => {
  it("a·b·c만 받고 나머지는 무시한다", () => {
    expect(parseBgmStyle("a")).toBe("a");
    expect(parseBgmStyle("B")).toBe("b");
    expect(parseBgmStyle(" c ")).toBe("c");
    for (const bad of ["", "d", "ab", "산책", null, undefined, 1, {}])
      expect(parseBgmStyle(bad)).toBeNull();
  });
  it("주소의 ?bgm= 값을 읽는다", () => {
    expect(bgmStyleFromSearch("?bgm=b")).toBe("b");
    expect(bgmStyleFromSearch("?x=1&bgm=c")).toBe("c");
    expect(bgmStyleFromSearch("bgm=a")).toBe("a");
    expect(bgmStyleFromSearch("?bgm=a&bgm=b")).toBe("a");
    expect(bgmStyleFromSearch("?bgm=zzz")).toBeNull();
    expect(bgmStyleFromSearch("?bgm=")).toBeNull();
    expect(bgmStyleFromSearch("")).toBeNull();
  });
  it("서버에서는 기본값, 브라우저에서는 처음 한 번만 주소를 읽는다", async () => {
    const server = await freshEngine();
    expect(server.bgmStyle()).toBe("a");
    const location = { search: "?bgm=c" };
    vi.stubGlobal("window", { localStorage: memoryStorage(), location });
    const engine = await freshEngine();
    expect(engine.bgmStyle()).toBe("c");
    location.search = "?bgm=b";
    expect(engine.bgmStyle()).toBe("c");
    location.search = "?bgm=nope";
    expect((await freshEngine()).bgmStyle()).toBe("a");
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
      get location(): never {
        throw new Error("SecurityError");
      },
    });
    expect((await freshEngine()).bgmStyle()).toBe("a");
  });
});

describe("뜯는 줄 합성", () => {
  // 자기상관으로 바탕음 주기를 찾는다
  function pitch(x: Float32Array, rate: number, guess: number) {
    const from = Math.floor(rate * 0.1),
      len = Math.floor(rate * 0.25);
    const lo = Math.floor((rate / guess) * 0.75),
      hi = Math.ceil((rate / guess) * 1.4);
    const ac = (lag: number) => {
      let s = 0;
      for (let i = from; i < from + len; i++) s += x[i] * x[i + lag];
      return s;
    };
    let best = lo;
    for (let lag = lo; lag <= hi; lag++) if (ac(lag) > ac(best)) best = lag;
    const a = ac(best - 1),
      b = ac(best),
      c = ac(best + 1);
    const shift = (a - c) / (2 * (a - 2 * b + c));
    return rate / (best + shift);
  }
  it("음높이가 5센트 안으로 맞는다(밝기와 상관없이)", () => {
    for (const midi of [39, 51, 63, 70, 75, 82])
      for (const bright of [0.12, 0.3, 0.55]) {
        const want = hz(midi);
        const x = ksSamples(24000, want, 0.5, {
          decay: 2,
          bright,
          pick: 0.19,
          seed: 7,
        });
        const cents = 1200 * Math.log2(pitch(x, 24000, want) / want);
        expect(Math.abs(cents)).toBeLessThan(5);
      }
  });
  it("값이 유한하고 최대치 1을 넘지 않으며 점점 사라진다", () => {
    const x = ksSamples(24000, 220, 2, { decay: 1.5, bright: 0.5, pick: 0.2, seed: 3 });
    let peak = 0,
      head = 0,
      tail = 0;
    const tenth = Math.floor(x.length / 10);
    for (let i = 0; i < x.length; i++) {
      expect(Number.isFinite(x[i])).toBe(true);
      peak = Math.max(peak, Math.abs(x[i]));
      if (i < tenth) head += x[i] * x[i];
      if (i >= x.length - tenth) tail += x[i] * x[i];
    }
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(tail).toBeLessThan(head * 0.01);
  });
  it("안전 한계 곡선은 작은 소리를 그대로 두고 1을 넘지 않는다", () => {
    const curve = softClipCurve(2049);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThan(curve[i - 1]);
      expect(Math.abs(curve[i])).toBeLessThanOrEqual(1);
    }
    const mid = (curve.length - 1) / 2;
    expect(curve[mid + Math.round(mid * 0.5)]).toBeCloseTo(0.5, 3);
  });
});
