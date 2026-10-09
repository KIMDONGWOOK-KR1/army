// 호국실록 합성 소리 재료.
// 소리 파일·내려받은 샘플·생성 음원 없이 WebAudio 노드와 몇 줄의 계산으로만 만든다.
// 저작권 걱정이 없고 오프라인에서도 난다. 모든 함수가 BaseAudioContext를 받으므로
// OfflineAudioContext로 같은 소리를 그려 파일로 들어 볼 수 있다(재생 엔진은 lib/sound.ts).
// 가락은 황종(E♭)을 으뜸으로 한 평조 다섯 음(E♭·F·A♭·B♭·C)과 조금 밝은 E♭ 다섯 음
// (E♭·F·G·B♭·C)만 쓰고, 배경음의 화음·베이스는 E♭ 장조 안에서 움직인다.
// 군가·행진곡·5·18 노래의 가락이나 행진 북 리듬은 넣지 않는다(장구는 자진모리 장단만).

export const SOUND_NAMES = [
  "tap",
  "confirm",
  "clue-correct",
  "clue-wrong",
  "digit-reveal",
  "lock-tick",
  "lock-open",
  "lock-fail",
  "sacho",
  "role-reveal",
  "join",
  "arrive",
  "stop-open",
  "typewriter",
  "dial-tick",
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];
export const MOODS = ["home", "field", "memorial"] as const;
export type Mood = (typeof MOODS)[number];
// volume: 0~1 배율, delay: 몇 초 뒤에 낼지, calm: 추모 거점처럼 차분한 변형,
// harmony: 그때 배경음에서 울리는 화음들(음 이름 0~11). 주면 가락 있는 효과음이 그 화음에 맞춰 비킨다
export type SoundOptions = {
  volume?: number;
  delay?: number;
  calm?: boolean;
  harmony?: readonly (readonly number[])[];
};
// ui: 잔향 없는 짧은 소리, music: 잔향을 조금 섞는 악기 소리
export type Buses = { ui: AudioNode; music: AudioNode };

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// 같은 씨앗이면 같은 수열(시험·파일 렌더가 매번 같게)
export function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 뜯는 줄: 카플러스-스트롱 ──────────────────────────────────────────
// decay: 60dB 줄어드는 데 걸리는 초, bright: 0(어둡고 둥근 명주실)~1(밝음),
// pick: 줄을 뜯는 자리(줄 길이 비율), seed: 처음 떨림의 무늬
export type PluckTone = {
  decay: number;
  bright: number;
  pick: number;
  seed: number;
};
export function ksSamples(
  rate: number,
  freq: number,
  seconds: number,
  tone: PluckTone,
): Float32Array {
  const len = Math.max(1, Math.floor(rate * seconds));
  const out = new Float32Array(len);
  const period = rate / clamp(freq, 20, rate / 4);
  const loss = 10 ** ((-3 * period) / (Math.max(0.05, tone.decay) * rate));
  const bright = clamp(tone.bright, 0, 1);
  // 고리 안의 저역 통과((1-s)·x[n] + s·x[n-1])가 s 표본, 올패스가 나머지 소수 지연을 맡아 음높이를 맞춘다
  const s = 0.5 - 0.36 * bright;
  const n = Math.max(2, Math.floor(period - s - 0.1));
  const frac = period - s - n;
  const c = (1 - frac) / (1 + frac);
  const rand = seeded(tone.seed);
  const line = new Float32Array(n);
  const k = 0.12 + 0.8 * bright;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += k * (rand() * 2 - 1 - lp);
    line[i] = lp;
  }
  // 뜯는 자리: 그 자리의 배음이 빠져 속이 빈 듯한 줄 소리가 난다
  const shift = Math.max(1, Math.round(clamp(tone.pick, 0.02, 0.5) * n));
  const first = line.slice();
  let mean = 0;
  for (let i = 0; i < n; i++) {
    line[i] = first[i] - first[(i + shift) % n];
    mean += line[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) line[i] -= mean;
  let idx = 0,
    prev = 0,
    apIn = 0,
    apOut = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    out[i] = cur;
    const f = loss * ((1 - s) * cur + s * prev);
    prev = cur;
    const ap = c * f + apIn - c * apOut;
    apIn = f;
    apOut = ap;
    line[idx] = ap;
    if (++idx === n) idx = 0;
  }
  // 직류 막기 → 최대치 1로 맞추고 끝을 부드럽게 닫는다
  let x1 = 0,
    y1 = 0,
    peak = 0;
  for (let i = 0; i < len; i++) {
    const y = out[i] - x1 + 0.995 * y1;
    x1 = out[i];
    y1 = y;
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  const fade = Math.min(len, Math.floor(rate * 0.04));
  const norm = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < len; i++) {
    const tail = len - i;
    out[i] *= norm * (tail < fade ? tail / fade : 1);
  }
  return out;
}

// 뜯는 줄 표본은 24kHz로 만들어 둔다(메모리 절약, 고음 띠는 뒤의 저역 통과가 정리).
// 배경음의 베이스·마림바·신스 표본도 같은 빠르기로 만든다.
const PLUCK_RATE = 24000;
// 오래 안 쓴 것부터 버린다. 장단 갈래 한 분위기(가락·바탕·거문고 약 70개)와 효과음이 함께 들어간다.
const PLUCK_CACHE_MAX = 96;
const pluckCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
const pluckKey = (midi: number, tone: PluckTone) =>
  `${midi}|${tone.decay}|${tone.bright}|${tone.pick}|${tone.seed}`;
function pluckBuffer(ctx: BaseAudioContext, midi: number, tone: PluckTone) {
  let cache = pluckCache.get(ctx);
  if (!cache) pluckCache.set(ctx, (cache = new Map()));
  const key = pluckKey(midi, tone);
  let buf = cache.get(key);
  if (buf) {
    cache.delete(key);
    cache.set(key, buf);
    return buf;
  }
  const data = ksSamples(
    PLUCK_RATE,
    hz(midi),
    Math.min(4.5, tone.decay * 1.15 + 0.05),
    tone,
  );
  buf = ctx.createBuffer(1, data.length, PLUCK_RATE);
  buf.getChannelData(0).set(data);
  cache.set(key, buf);
  if (cache.size > PLUCK_CACHE_MAX) cache.delete(cache.keys().next().value!);
  return buf;
}

// ── 공용 재료 ─────────────────────────────────────────────────────────
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext) {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0),
    rand = seeded(5);
  for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}
// 짧은 소리마다 조금씩 다르게(타자·딸깍이 기계처럼 똑같이 반복되지 않게)
const vary = seeded(23);

function gainNode(ctx: BaseAudioContext, value: number, out?: AudioNode) {
  const g = ctx.createGain();
  g.gain.value = value;
  if (out) g.connect(out);
  return g;
}

// 치자마자 오르고 지수로 사라지는 음량 곡선
function strike(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  tau: number,
) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tau);
}

type NoiseHit = {
  gain: number;
  type: BiquadFilterType;
  freq: number;
  q?: number;
  tau: number;
};
function noiseHit(ctx: BaseAudioContext, out: AudioNode, t: number, n: NoiseHit) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = n.type;
  f.frequency.value = n.freq;
  f.Q.value = n.q ?? 0.7;
  const g = ctx.createGain();
  strike(g.gain, t, n.gain, 0.001, n.tau);
  src.connect(f).connect(g).connect(out);
  src.start(t, vary() * 0.8, n.tau * 8 + 0.01);
}

type Blip = {
  freq: number;
  to?: number;
  glide?: number;
  gain: number;
  tau: number;
  attack?: number;
};
function blip(ctx: BaseAudioContext, out: AudioNode, t: number, b: Blip) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(b.freq, t);
  if (b.to) o.frequency.exponentialRampToValueAtTime(b.to, t + (b.glide ?? 0.03));
  const g = ctx.createGain(),
    attack = b.attack ?? 0.002;
  strike(g.gain, t, b.gain, attack, b.tau);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + b.tau * 7);
}

// 좌우 자리는 출력마다 자리 값별로 하나만 만들어 함께 쓴다(소리마다 새로 만들지 않게).
// 배경음은 자리 값을 0.05 단위로 맞춰 보내므로 한 분위기에 몇 개만 생긴다.
const panCache = new WeakMap<AudioNode, Map<number, AudioNode>>();
function panBus(ctx: BaseAudioContext, out: AudioNode, pan = 0): AudioNode {
  const p = clamp(pan, -1, 1);
  if (!p || typeof ctx.createStereoPanner !== "function") return out;
  let buses = panCache.get(out);
  if (!buses) panCache.set(out, (buses = new Map()));
  let bus = buses.get(p);
  if (!bus) {
    const sp = ctx.createStereoPanner();
    sp.pan.value = p;
    sp.connect(out);
    buses.set(p, (bus = sp));
  }
  return bus;
}
function connectPan(
  ctx: BaseAudioContext,
  node: AudioNode,
  out: AudioNode,
  pan = 0,
) {
  node.connect(panBus(ctx, out, pan));
}

// ── 목소리들 ──────────────────────────────────────────────────────────
// 가야금: 손가락으로 뜯는 명주실, 거문고: 술대로 내리치는 낮고 굵은 줄(나무 두드림이 섞인다).
// vib: 농현(떠는 소리) 깊이(센트), bend: 퇴성·추성처럼 뜯은 뒤 미는 음정(반음 수)
export type PluckSpec = {
  midi: number;
  gain: number;
  inst?: "gayageum" | "geomungo";
  decay?: number;
  bright?: number;
  vib?: number;
  bend?: number;
  bendAt?: number;
  pan?: number;
  variant?: number;
  cutoff?: number;
};
// 뜯는 줄 하나의 표본 무늬(같은 무늬면 표본을 다시 계산하지 않는다)
function pluckTone(p: Pick<PluckSpec, "midi" | "inst" | "decay" | "bright" | "variant">): PluckTone {
  const geo = p.inst === "geomungo";
  return {
    decay: p.decay ?? (geo ? 1.8 : 2.4),
    bright: p.bright ?? (geo ? 0.3 : 0.55),
    pick: geo ? 0.11 : 0.19,
    seed: 7 + (p.variant ?? 0) * 101 + Math.round(p.midi),
  };
}
export function pluck(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  p: PluckSpec,
) {
  const geo = p.inst === "geomungo";
  const buffer = pluckBuffer(ctx, p.midi, pluckTone(p));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const end = t + buffer.duration * 1.2 + 0.1;
  if (p.bend) {
    const at = t + (p.bendAt ?? 0.18);
    src.playbackRate.setValueAtTime(1, at);
    src.playbackRate.linearRampToValueAtTime(2 ** (p.bend / 12), at + 0.24);
  }
  if (p.vib) {
    const lfo = ctx.createOscillator(),
      depth = ctx.createGain();
    lfo.frequency.value = geo ? 4.3 : 5.4;
    depth.gain.setValueAtTime(0, t);
    depth.gain.setValueAtTime(0, t + 0.28);
    depth.gain.linearRampToValueAtTime(2 ** (p.vib / 1200) - 1, t + 0.85);
    lfo.connect(depth).connect(src.playbackRate);
    lfo.start(t);
    lfo.stop(end);
  }
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = geo ? 190 : 330;
  body.Q.value = 1.2;
  body.gain.value = geo ? 4 : 2.5;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.cutoff ?? (geo ? 2600 : 4800);
  lp.Q.value = 0.5;
  const g = gainNode(ctx, p.gain);
  src.connect(body).connect(lp).connect(g);
  connectPan(ctx, g, out, p.pan);
  src.start(t);
  // 다 울리면 연결을 끊어 바로 치울 수 있게 한다
  src.onended = () => g.disconnect();
  if (geo) {
    // 술대가 줄과 대모(가죽)를 함께 치는 나무 소리
    noiseHit(ctx, out, t, {
      gain: p.gain * 0.3,
      type: "bandpass",
      freq: 1100,
      q: 1.4,
      tau: 0.012,
    });
    blip(ctx, out, t, { freq: 150, to: 105, gain: p.gain * 0.35, tau: 0.03 });
  }
  return buffer.duration;
}

// 편경(돌 경쇠): 맑은 바탕음에 어긋난 윗배음이 먼저 사라지고, 쌍둥이 음이 천천히 맥놀이한다
const STONE: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1.0042, 0.36, 0.8],
  [2.76, 0.28, 0.42],
  [5.18, 0.12, 0.22],
  [8.47, 0.05, 0.12],
];
export function bell(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  b: { midi: number; gain: number; decay?: number; mallet?: number },
) {
  const f = hz(b.midi),
    decay = b.decay ?? 4;
  for (const [ratio, amp, life] of STONE) {
    const freq = f * ratio;
    if (freq > ctx.sampleRate * 0.42) continue;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain(),
      len = decay * life;
    strike(g.gain, t, b.gain * amp * 0.62, 0.004, len / 5);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len * 1.4 + 0.05);
  }
  noiseHit(ctx, out, t, {
    gain: b.gain * 0.22 * (b.mallet ?? 1),
    type: "bandpass",
    freq: 2800,
    q: 0.9,
    tau: 0.004,
  });
  return decay;
}

// 아래에서 받치는 낮은 울림(가락 없음)
function hum(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  h: { midi: number; gain: number; decay: number },
) {
  const o = ctx.createOscillator();
  o.frequency.value = hz(h.midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(h.gain, t + 0.25);
  g.gain.setTargetAtTime(0, t + 0.25, h.decay / 5);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + h.decay * 1.4);
}

// 목탁·자물쇠 걸쇠 같은 마른 나무 소리
function tock(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  k: { freq: number; gain: number; tau: number },
) {
  blip(ctx, out, t, {
    freq: k.freq * 1.45,
    to: k.freq,
    glide: 0.01,
    gain: k.gain,
    tau: k.tau,
  });
  blip(ctx, out, t, { freq: k.freq * 2.7, gain: k.gain * 0.25, tau: k.tau * 0.5 });
  noiseHit(ctx, out, t, {
    gain: k.gain * 0.45,
    type: "bandpass",
    freq: k.freq * 2.2,
    q: 2.5,
    tau: 0.004,
  });
}

// 종이에 도장을 누르는 둔한 소리
function thud(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number) {
  blip(ctx, out, t, { freq: 170, to: 62, glide: 0.09, gain, tau: 0.06 });
  blip(ctx, out, t, { freq: 340, to: 210, glide: 0.04, gain: gain * 0.35, tau: 0.03 });
  noiseHit(ctx, out, t, {
    gain: gain * 0.35,
    type: "lowpass",
    freq: 1400,
    tau: 0.03,
  });
}

type PadSpec = {
  notes: number[];
  dur: number;
  gain: number;
  cutoff: number;
  wide?: boolean;
};
// 깔리는 화음. 화음이 바뀌는 박에 맞춰 짧게(0.15초) 차오르고, 다음 화음이 들어오는 동안
// 0.3초에 걸쳐 빠진다(앞 화음이 새 화음 위에 오래 남지 않게).
// 보통은 음마다 삼각파 하나(이웃 음끼리 몇 센트 어긋나게), wide는 음마다 톱니파 하나를
// 좌우로 번갈아 벌려(조금씩 어긋나게) 넓게 깐다.
function pad(ctx: BaseAudioContext, out: AudioNode, t: number, p: PadSpec) {
  const attack = Math.min(0.15, p.dur * 0.25),
    release = Math.min(0.3, p.dur * 0.4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.35;
  lp.frequency.setValueAtTime(p.cutoff * 0.6, t);
  lp.frequency.linearRampToValueAtTime(p.cutoff, t + p.dur * 0.4);
  lp.frequency.linearRampToValueAtTime(p.cutoff * 0.7, t + p.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(p.gain, t + attack);
  g.gain.setValueAtTime(p.gain, t + Math.max(attack, p.dur - release));
  g.gain.linearRampToValueAtTime(0, t + p.dur);
  lp.connect(g).connect(out);
  const each = 1 / Math.max(1, p.notes.length);
  const sums = new Map<number, GainNode>();
  let last: OscillatorNode | null = null;
  p.notes.forEach((m, i) => {
    const side = p.wide ? (i % 2 ? 0.5 : -0.5) : 0;
    let sum = sums.get(side);
    if (!sum) {
      sum = gainNode(ctx, p.wide ? each * 0.72 : each);
      connectPan(ctx, sum, lp, side);
      sums.set(side, sum);
    }
    const o = ctx.createOscillator();
    o.type = p.wide ? "sawtooth" : "triangle";
    o.frequency.value = hz(m);
    o.detune.value = p.wide ? (i % 2 ? 7 : -7) : i % 2 ? 3 : -3;
    o.connect(sum);
    o.start(t);
    o.stop(t + p.dur + 0.05);
    last = o;
  });
  if (last) (last as OscillatorNode).onended = () => g.disconnect();
}

// 추모 장소의 숨결: 같은 음을 그대로 두고 크기만 천천히 오르내린다
function drone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  d: { notes: number[]; dur: number; gain: number },
) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(d.gain, t + d.dur * 0.4);
  g.gain.linearRampToValueAtTime(0, t + d.dur);
  g.connect(out);
  d.notes.forEach((m, i) => {
    const level = [1, 0.75, 0.5, 0.3][i] ?? 0.25;
    for (const shift of [0, 0.12]) {
      const o = ctx.createOscillator();
      o.frequency.value = hz(m) + shift;
      o.connect(gainNode(ctx, level * 0.5, g));
      o.start(t);
      o.stop(t + d.dur + 0.05);
    }
  });
}

// ── 효과음 조리법 ─────────────────────────────────────────────────────
// 각 조리법은 소리가 울리는 대략의 길이(초)를 돌려준다(파일로 그릴 때 길이를 정한다).
type Recipe = (
  ctx: BaseAudioContext,
  b: Buses,
  t: number,
  o: SoundOptions,
) => number;
const RECIPES: Record<SoundName, Recipe> = {
  tap(ctx, b, t) {
    blip(ctx, b.ui, t, { freq: 1240, to: 820, glide: 0.025, gain: 0.1, tau: 0.014 });
    noiseHit(ctx, b.ui, t, { gain: 0.025, type: "highpass", freq: 3200, tau: 0.0025 });
    return 0.15;
  },
  confirm(ctx, b, t, o) {
    blip(ctx, b.ui, t, { freq: 700, to: 470, glide: 0.035, gain: 0.09, tau: 0.024 });
    const [m] = fitNotes([75], o.harmony);
    pluck(ctx, b.music, t + 0.012, { midi: m, gain: 0.1, decay: 1, bright: 0.45 });
    return 1.3;
  },
  // 추모 거점에서는 오르는 가락 없이 낮은 한 음만 뜯는다
  "clue-correct"(ctx, b, t, o) {
    if (o.calm) {
      pluck(ctx, b.music, t, { midi: 63, gain: 0.15, decay: 1.8, bright: 0.35 });
      return 2;
    }
    const n = fitNotes([68, 72, 75, 87], o.harmony);
    n.slice(0, 3).forEach((m, i) =>
      pluck(ctx, b.music, t + i * 0.095, {
        midi: m,
        gain: 0.17 + i * 0.03,
        decay: 1.9,
        bright: 0.55,
        vib: i === 2 ? 18 : 0,
        pan: (i - 1) * 0.15,
      }),
    );
    bell(ctx, b.music, t + 0.19, { midi: n[3], gain: 0.025, decay: 1.6, mallet: 0.3 });
    return 2.4;
  },
  // 틀린 답: 꾸짖지 않게 낮고 짧게 눌린 두 음
  "clue-wrong"(ctx, b, t) {
    pluck(ctx, b.music, t, { midi: 60, gain: 0.15, decay: 0.42, bright: 0.18, cutoff: 1800 });
    pluck(ctx, b.music, t + 0.17, {
      midi: 58,
      gain: 0.13,
      decay: 0.5,
      bright: 0.12,
      cutoff: 1500,
    });
    return 0.9;
  },
  "digit-reveal"(ctx, b, t, o) {
    thud(ctx, b.ui, t, 0.2);
    const [low, high] = fitNotes([51, 70], o.harmony);
    pluck(ctx, b.music, t + 0.03, { midi: low, gain: 0.22, inst: "geomungo", decay: 1.6 });
    bell(ctx, b.music, t + 0.05, { midi: high, gain: 0.05, decay: 1.8, mallet: 0.2 });
    return 2;
  },
  "lock-tick"(ctx, b, t) {
    tock(ctx, b.ui, t, { freq: 1350, gain: 0.14, tau: 0.012 });
    return 0.12;
  },
  // 빗장 소리 뒤 오르는 네 음. 추모 거점에서는 빗장 뒤 편경 한 번만 낮게 울린다
  "lock-open"(ctx, b, t, o) {
    tock(ctx, b.ui, t, { freq: 560, gain: 0.2, tau: 0.02 });
    tock(ctx, b.ui, t + 0.07, { freq: 300, gain: 0.22, tau: 0.03 });
    if (o.calm) {
      bell(ctx, b.music, t + 0.28, { midi: 63, gain: 0.12, decay: 4, mallet: 0.4 });
      return 4.2;
    }
    fitNotes([63, 68, 70, 75], o.harmony).forEach((m, i) =>
      pluck(ctx, b.music, t + 0.28 + i * 0.13, {
        midi: m,
        gain: 0.16 + i * 0.02,
        decay: 2.2,
        bright: 0.5,
        vib: i === 3 ? 20 : 0,
        pan: (i - 1.5) * 0.12,
      }),
    );
    return 3.2;
  },
  "lock-fail"(ctx, b, t) {
    tock(ctx, b.ui, t, { freq: 470, gain: 0.15, tau: 0.02 });
    tock(ctx, b.ui, t + 0.12, { freq: 390, gain: 0.13, tau: 0.024 });
    pluck(ctx, b.music, t + 0.06, {
      midi: 53,
      gain: 0.12,
      inst: "geomungo",
      decay: 0.8,
      bright: 0.15,
      bend: -1,
      bendAt: 0.12,
    });
    return 1.1;
  },
  // 사초 한 장: 편경 한 번. 아래에서 한 옥타브 낮은 울림이 받친다
  sacho(ctx, b, t) {
    bell(ctx, b.music, t, { midi: 63, gain: 0.22, decay: 7, mallet: 0.6 });
    hum(ctx, b.music, t, { midi: 51, gain: 0.03, decay: 5 });
    return 7.5;
  },
  // 보직 공개: 거문고 네 소리(황→임→임 퇴성→황, 마지막은 아래 열린 줄과 함께 농현)
  "role-reveal"(ctx, b, t) {
    const geo = (midi: number, at: number, gain: number, x: Partial<PluckSpec>) =>
      pluck(ctx, b.music, t + at, { midi, gain, inst: "geomungo", ...x });
    geo(51, 0, 0.26, { decay: 2 });
    geo(58, 0.46, 0.2, { decay: 1.7 });
    geo(58, 0.98, 0.2, { decay: 1.8, bend: -2, bendAt: 0.2 });
    geo(51, 1.62, 0.24, { decay: 2.6, vib: 22 });
    geo(39, 1.62, 0.13, { decay: 2.6 });
    return 4.3;
  },
  join(ctx, b, t, o) {
    const [lo, hi] = fitNotes([68, 70], o.harmony);
    pluck(ctx, b.music, t, { midi: lo, gain: 0.08, decay: 0.5, bright: 0.5 });
    pluck(ctx, b.music, t + 0.07, {
      midi: hi,
      gain: 0.17,
      decay: 1.6,
      bright: 0.55,
      vib: 14,
    });
    return 1.8;
  },
  arrive(ctx, b, t, o) {
    if (o.calm) {
      bell(ctx, b.music, t, { midi: 68, gain: 0.12, decay: 3.4, mallet: 0.4 });
      return 3.6;
    }
    const [lo, hi] = fitNotes([70, 75], o.harmony);
    bell(ctx, b.music, t, { midi: lo, gain: 0.12, decay: 2.6, mallet: 0.4 });
    bell(ctx, b.music, t + 0.38, { midi: hi, gain: 0.1, decay: 3, mallet: 0.4 });
    return 3.5;
  },
  // 거점 원판이 열릴 때: 네 보직 방울이 내려앉는 간격(120ms)에 맞춘 네 소리.
  // 추모 거점에서는 편경 한 번만 낮게 울린다.
  "stop-open"(ctx, b, t, o) {
    if (o.calm) {
      bell(ctx, b.music, t, { midi: 63, gain: 0.13, decay: 4, mallet: 0.4 });
      return 4.2;
    }
    const n = fitNotes([75, 77, 80, 82, 87], o.harmony);
    n.slice(0, 4).forEach((m, i) =>
      pluck(ctx, b.music, t + i * 0.12, {
        midi: m,
        gain: 0.12,
        decay: 1.6,
        bright: 0.6,
        pan: (i - 1.5) * 0.25,
      }),
    );
    bell(ctx, b.music, t + 0.42, { midi: n[4], gain: 0.03, decay: 2 });
    return 2.6;
  },
  typewriter(ctx, b, t) {
    const v = 0.8 + vary() * 0.4;
    noiseHit(ctx, b.ui, t, { gain: 0.09 * v, type: "bandpass", freq: 2600, q: 0.8, tau: 0.005 });
    blip(ctx, b.ui, t, { freq: 260 * v, gain: 0.03, tau: 0.008 });
    return 0.06;
  },
  "dial-tick"(ctx, b, t) {
    noiseHit(ctx, b.ui, t, { gain: 0.1, type: "bandpass", freq: 3600, q: 2, tau: 0.0018 });
    blip(ctx, b.ui, t, { freq: 2400, gain: 0.03, tau: 0.003 });
    return 0.04;
  },
};

export function renderSound(
  ctx: BaseAudioContext,
  buses: Buses,
  name: SoundName,
  t: number,
  o: SoundOptions = {},
): number {
  const v = clamp(o.volume ?? 1, 0, 1);
  const b =
    v === 1
      ? buses
      : { ui: gainNode(ctx, v, buses.ui), music: gainNode(ctx, v, buses.music) };
  return RECIPES[name](ctx, b, t, o);
}

// ── 무전 잡음 ─────────────────────────────────────────────────────────
// signal 0: 넓은 띠의 쉿 소리와 지직거림, 1: 띠가 좁아지며 잡음이 걷히고 맑은 음 하나가 남는다.
export type StaticGraph = {
  setSignal(v: number, at: number): void;
  stop(at: number): void;
};
const crackleCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function crackleBuffer(ctx: BaseAudioContext) {
  let buf = crackleCache.get(ctx);
  if (buf) return buf;
  const rate = ctx.sampleRate,
    len = Math.floor(rate * 1.3);
  buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0),
    rand = seeded(77);
  for (let i = 0; i < len; i++) {
    if (rand() > 0.9993) {
      const amp = (rand() * 2 - 1) * (0.4 + rand() * 0.6),
        n = Math.floor(rate * (0.001 + rand() * 0.003));
      for (let j = 0; j < n && i + j < len; j++)
        d[i + j] += amp * (rand() * 2 - 1) * (1 - j / n);
    }
  }
  crackleCache.set(ctx, buf);
  return buf;
}
export function radioStatic(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
): StaticGraph {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t);
  master.gain.linearRampToValueAtTime(1, t + 0.15);
  master.connect(out);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  const hiss = ctx.createGain();
  noise.connect(band).connect(hiss).connect(master);
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackleBuffer(ctx);
  crackSrc.loop = true;
  const crackHp = ctx.createBiquadFilter();
  crackHp.type = "highpass";
  crackHp.frequency.value = 1500;
  const crackle = ctx.createGain();
  crackSrc.connect(crackHp).connect(crackle).connect(master);
  const carrier = ctx.createOscillator();
  carrier.frequency.value = hz(75);
  const wobble = ctx.createOscillator(),
    wobbleDepth = gainNode(ctx, 1.5);
  wobble.frequency.value = 3.1;
  wobble.connect(wobbleDepth).connect(carrier.detune);
  const tone = ctx.createGain();
  carrier.connect(tone).connect(master);
  const apply = (v: number, at: number, now = false) => {
    const s = clamp(v, 0, 1),
      clear = s * s;
    const set = (p: AudioParam, value: number, tau: number) =>
      now ? p.setValueAtTime(value, at) : p.setTargetAtTime(value, at, tau);
    set(band.frequency, 900 + 900 * s, 0.05);
    set(band.Q, 0.5 + 7 * clear, 0.05);
    set(hiss.gain, 0.14 * (1 - 0.8 * s), 0.05);
    set(crackle.gain, 0.08 * (1 - s) ** 2, 0.05);
    set(tone.gain, 0.035 * clear * clear, 0.08);
  };
  apply(0, t, true);
  for (const src of [noise, crackSrc, carrier, wobble]) src.start(t);
  let stopped = false;
  return {
    setSignal(v, at) {
      if (!stopped) apply(v, at);
    },
    stop(at) {
      if (stopped) return;
      stopped = true;
      master.gain.cancelScheduledValues(at);
      master.gain.setTargetAtTime(0, at, 0.06);
      for (const src of [noise, crackSrc, carrier, wobble]) src.stop(at + 0.5);
    },
  };
}

// ── 바탕 배선 ─────────────────────────────────────────────────────────
// master(끄기) → 부드러운 한계(갑자기 겹쳐도 깨지지 않게) → 출력.
// 악기 소리와 배경음은 합성한 방 울림(콘볼버)을 조금 섞는다.
export function softClipCurve(n = 2049) {
  const curve = new Float32Array(n),
    knee = 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1,
      a = Math.abs(x);
    curve[i] =
      a <= knee
        ? x
        : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}
function roomImpulse(ctx: BaseAudioContext) {
  const rate = ctx.sampleRate,
    len = Math.floor(rate * 1.6);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch),
      rand = seeded(91 + ch * 17);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const s = i / rate;
      if (s < 0.012) continue;
      const k = 0.85 * Math.exp(-s * 2.2) + 0.08;
      lp += k * (rand() * 2 - 1 - lp);
      const onset = Math.min(1, (s - 0.012) / 0.01),
        tail = Math.min(1, (len - i) / (rate * 0.1));
      d[i] = lp * Math.exp(-s * 3.6) * onset * tail;
    }
  }
  return buf;
}
// bgm: 장면마다 정하는 배경음 크기, duck: 가락 있는 효과음이 날 때 잠깐 낮추는 마디(lib/sound.ts)
export type Chain = { master: GainNode; sfx: Buses; bgm: GainNode; duck: GainNode };
export function buildChain(
  ctx: BaseAudioContext,
  dest: AudioNode = ctx.destination,
): Chain {
  const master = ctx.createGain();
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = "none";
  master.connect(clip).connect(dest);
  const verb = ctx.createConvolver();
  verb.buffer = roomImpulse(ctx);
  verb.connect(gainNode(ctx, 0.8, master));
  const ui = gainNode(ctx, 1, master);
  const music = gainNode(ctx, 1, master);
  music.connect(gainNode(ctx, 0.22, verb));
  const duck = gainNode(ctx, 1, master);
  duck.connect(gainNode(ctx, 0.38, verb));
  const bgm = gainNode(ctx, 1, duck);
  return { master, sfx: { ui, music }, bgm, duck };
}
// 오디오 값의 앞으로 예정된 변화를 at에서 끊고 그때 값에 멈춰 둔다
function holdAt(param: AudioParam, at: number) {
  if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(at);
  else {
    const v = param.value;
    param.cancelScheduledValues(at);
    param.setValueAtTime(v, at);
  }
}
// 보상·도착·사초처럼 가락 있는 효과음이 날 때 배경음을 잠깐 낮춘다: [얼마로, 몇 초 동안]
const DUCK: Partial<Record<SoundName, readonly [depth: number, hold: number]>> = {
  "clue-correct": [0.55, 0.9],
  "lock-open": [0.55, 1.2],
  "stop-open": [0.55, 0.9],
  "digit-reveal": [0.6, 0.8],
  "role-reveal": [0.6, 2],
  arrive: [0.6, 1],
  sacho: [0.6, 1.6],
};
export function duckBgm(chain: Chain, name: SoundName, t: number) {
  const d = DUCK[name];
  if (!d) return;
  const g = chain.duck.gain;
  holdAt(g, t);
  g.setTargetAtTime(d[0], t, 0.03);
  g.setTargetAtTime(1, t + d[1], 0.35);
}

// ── 배경음 악기: 처음 한 번 계산해 두는 짧은 표본 ─────────────────────
// 북·셰이커·베이스·마림바·신스처럼 자주 치는 소리는 처음 한 번만 표본을 계산해 두고 되풀이해 튼다.
// 한 번 칠 때 노드가 둘(소스·음량)뿐이라 휴대폰에서도 가볍고, 잡음도 매번 새로 만들지 않는다.
// 높은 쇳소리(하이햇·셰이커)는 10kHz 아래로 눌러 오래 들어도 귀가 피곤하지 않게 한다.
// 행진 북은 없다. 장구(덩·쿵·덕·더러러)는 자진모리 장단(장단 갈래)에서만 친다.
export const DRUM_HITS = [
  "kick",
  "clap",
  "hat",
  "ohat",
  "shaker",
  "rim",
  "snap",
  "deong",
  "kung",
  "deok",
  "roll",
] as const;
export type DrumHit = (typeof DRUM_HITS)[number];
export type BassTone = "pizz" | "synth" | "round";
export type MalletTone = "marimba" | "kalimba";

// 자르는 주파수를 표본마다 바꿀 수 있는 상태 변수 필터(0 저역, 1 띠, 2 고역).
// 계수(tan)는 주파수가 0.2% 넘게 움직였을 때만 다시 구한다(휴대폰 첫 계산 시간을 줄인다).
function svf(rate: number, q: number, mode: 0 | 1 | 2) {
  const k = 1 / q;
  let ic1 = 0,
    ic2 = 0,
    lastF = -1,
    a1 = 0,
    a2 = 0,
    a3 = 0;
  return (x: number, freq: number) => {
    if (Math.abs(freq - lastF) > lastF * 0.002) {
      lastF = freq;
      const g = Math.tan((Math.PI * Math.min(freq, rate * 0.45)) / rate);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v3 = x - ic2,
      v1 = a1 * ic1 + a2 * v3,
      v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return mode === 0 ? v2 : mode === 1 ? k * v1 : x - k * v1 - v2;
  };
}
// 띠 제한 톱니파의 꺾이는 자리 다듬기(polyBLEP)
function polyBlep(p: number, dt: number) {
  if (p < dt) {
    const x = p / dt;
    return x + x - x * x - 1;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

// 막·나무·쇳조각의 떨림: 바탕음과 어긋난 윗떨림이 저마다 빠르기로 사라진다.
// drop: 치는 순간 살짝 높았다가 내려앉는 정도
type Mode = readonly [ratio: number, amp: number, tau: number];
function modesInto(
  d: Float32Array,
  rate: number,
  at: number,
  gain: number,
  f0: number,
  modes: readonly Mode[],
  attack: number,
  drop = 0,
) {
  const start = Math.floor(at * rate),
    atk = Math.max(1, attack * rate),
    settle = drop ? Math.ceil(0.2 * rate) : 0,
    bendFall = Math.exp(-1 / (0.025 * rate));
  // 떨림마다 따로: 저마다 −70dB(8τ)까지만 계산한다
  for (const [ratio, a0, tau] of modes) {
    const f = f0 * ratio;
    if (f * (1 + drop) >= rate * 0.45) continue;
    const end = Math.min(d.length, start + Math.ceil(tau * 8 * rate)),
      fall = Math.exp(-1 / (tau * rate));
    let amp = a0,
      phase = 0,
      bend = drop,
      i = start;
    // 음높이가 내려앉는 앞 0.2초만 sin을 직접 부르고, 그 뒤로는 회전(복소수 곱)으로 이어 간다
    for (const stop = Math.min(end, start + settle); i < stop; i++) {
      phase += (2 * Math.PI * f * (1 + bend)) / rate;
      bend *= bendFall;
      d[i] += gain * Math.min(1, (i - start) / atk) * amp * Math.sin(phase);
      amp *= fall;
    }
    const cw = Math.cos((2 * Math.PI * f) / rate),
      sw = Math.sin((2 * Math.PI * f) / rate);
    let re = Math.cos(phase),
      im = Math.sin(phase);
    for (; i < end; i++) {
      const r = re * cw - im * sw;
      im = im * cw + re * sw;
      re = r;
      d[i] += gain * Math.min(1, (i - start) / atk) * amp * im;
      amp *= fall;
    }
  }
}
// 걸러 낸 잡음 한 번(치자마자 오르고 지수로 사라진다)
type Band = readonly [mode: 0 | 1 | 2, freq: number, q: number];
function noiseInto(
  d: Float32Array,
  rate: number,
  rand: () => number,
  at: number,
  gain: number,
  tau: number,
  bands: readonly Band[],
  attack = 0.0005,
) {
  const fs = bands.map(([mode, , q]) => svf(rate, q, mode));
  const start = Math.floor(at * rate),
    end = Math.min(d.length, start + Math.ceil(rate * tau * 9)),
    atk = Math.max(1, attack * rate),
    fall = Math.exp(-1 / (tau * rate));
  let env = 1;
  for (let i = start; i < end; i++) {
    let x = rand() * 2 - 1;
    for (let b = 0; b < fs.length; b++) x = fs[b](x, bands[b][1]);
    d[i] += gain * Math.min(1, (i - start) / atk) * env * x;
    env *= fall;
  }
}
// 장구 북편(궁편): 손바닥·궁채로 치는 낮고 둥근 소리. 휴대폰 스피커(300Hz 아래가 거의 안 난다)에서도
// '쿵'이 들리게 손바닥이 가죽을 때리는 소리(700Hz 띠 잡음)와 높은 떨림(3.6배) 하나를 섞는다.
function kungInto(
  d: Float32Array,
  rate: number,
  rand: () => number,
  at: number,
  gain: number,
) {
  modesInto(
    d,
    rate,
    at,
    gain,
    100,
    [
      [1, 1, 0.26],
      [1.59, 0.4, 0.11],
      [2.14, 0.22, 0.07],
      [2.65, 0.1, 0.05],
      [3.6, 0.35, 0.035],
    ],
    0.003,
    0.12,
  );
  noiseInto(d, rate, rand, at, gain * 0.35, 0.012, [[0, 450, 0.7]], 0.001);
  noiseInto(d, rate, rand, at, gain * 1.5, 0.02, [[1, 700, 1]], 0.001);
}
// 장구 채편: 가는 열채가 팽팽한 가죽을 치는 맑고 짧은 소리. life는 울림 길이 배율(더러러는 짧게)
function deokInto(
  d: Float32Array,
  rate: number,
  rand: () => number,
  at: number,
  gain: number,
  life = 1,
) {
  modesInto(
    d,
    rate,
    at,
    gain * 0.6,
    340,
    [
      [1, 1, 0.08 * life],
      [1.59, 0.55, 0.05 * life],
      [2.14, 0.4, 0.035 * life],
      [2.3, 0.35, 0.03 * life],
      [2.65, 0.25, 0.022 * life],
    ],
    0.0008,
    0.05,
  );
  noiseInto(d, rate, rand, at, gain * 1.4, 0.0035 * (0.5 + life / 2), [
    [1, 3000, 0.8],
    [0, 8000, 0.7],
  ]);
}
type DrumRecipe = readonly [
  seconds: number,
  fullRate: boolean,
  fill: (d: Float32Array, rate: number, rand: () => number) => void,
];
const DRUMS: Record<DrumHit, DrumRecipe> = {
  // 부드러운 킥: 낮게 떨어지는 사인을 살짝 누른다. 낮은 울림은 휴대폰 스피커에서 거의 안 나므로
  // 채가 닿는 짧은 딸깍(2.5kHz 띠 잡음)과 짧은 '톡'(330Hz에서 떨어지는 울림)을 얹어
  // 작은 스피커에서도 박이 들리게 한다.
  kick: [
    0.34,
    false,
    (d, rate, rand) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const s = i / rate;
        ph += (2 * Math.PI * (60 + 65 * Math.exp(-s / 0.028))) / rate;
        d[i] = Math.tanh(
          1.8 * Math.sin(ph) * Math.min(1, s / 0.002) * Math.exp(-s / 0.11),
        );
      }
      noiseInto(d, rate, rand, 0, 0.1, 0.004, [[0, 1800, 0.7]]);
      noiseInto(d, rate, rand, 0, 0.6, 0.005, [[1, 2500, 1]]);
      modesInto(d, rate, 0, 0.55, 330, [[1, 1, 0.03]], 0.001, 0.2);
    },
  ],
  // 손뼉: 짧은 잡음 세 번 뒤 짧은 울림, 6kHz 위는 눌러 둔다
  clap: [
    0.3,
    false,
    (d, rate, rand) => {
      [0.7, 0.8, 1].forEach((g, i) =>
        noiseInto(d, rate, rand, i * 0.011, g, 0.0045, [
          [1, 1250, 0.9],
          [0, 6000, 0.7],
        ]),
      );
      noiseInto(
        d,
        rate,
        rand,
        0.026,
        0.75,
        0.065,
        [
          [1, 1150, 0.8],
          [0, 5000, 0.7],
        ],
        0.004,
      );
      modesInto(d, rate, 0, 0.12, 200, [[1, 1, 0.04]], 0.001, 0.1);
    },
  ],
  hat: [
    0.1,
    true,
    (d, rate, rand) =>
      noiseInto(d, rate, rand, 0, 1, 0.016, [
        [2, 7200, 0.7],
        [0, 9000, 0.7],
      ]),
  ],
  ohat: [
    0.5,
    true,
    (d, rate, rand) =>
      noiseInto(
        d,
        rate,
        rand,
        0,
        1,
        0.1,
        [
          [2, 6800, 0.7],
          [0, 8500, 0.7],
        ],
        0.002,
      ),
  ],
  // 셰이커: 알갱이가 쏠리듯 천천히(12ms) 차오른다
  shaker: [
    0.14,
    true,
    (d, rate, rand) =>
      noiseInto(
        d,
        rate,
        rand,
        0,
        1,
        0.03,
        [
          [1, 5200, 0.9],
          [0, 8500, 0.7],
        ],
        0.012,
      ),
  ],
  // 림(나무 테두리를 가볍게): 높은 나무 울림 둘과 짧은 잡음
  rim: [
    0.1,
    false,
    (d, rate, rand) => {
      modesInto(
        d,
        rate,
        0,
        0.7,
        1650,
        [
          [1, 1, 0.011],
          [0.32, 0.6, 0.02],
        ],
        0.0004,
      );
      noiseInto(d, rate, rand, 0, 0.5, 0.005, [[1, 2400, 1.5]]);
    },
  ],
  // 손가락 튕기기
  snap: [
    0.1,
    false,
    (d, rate, rand) => {
      noiseInto(d, rate, rand, 0, 1, 0.011, [
        [1, 2200, 1.4],
        [0, 7000, 0.7],
      ]);
      noiseInto(d, rate, rand, 0.002, 0.3, 0.02, [[1, 1000, 1]]);
    },
  ],
  kung: [0.75, false, (d, rate, rand) => kungInto(d, rate, rand, 0, 1)],
  deok: [0.32, false, (d, rate, rand) => deokInto(d, rate, rand, 0, 1)],
  // 덩: 북편과 채편을 함께
  deong: [
    0.75,
    false,
    (d, rate, rand) => {
      kungInto(d, rate, rand, 0, 1);
      deokInto(d, rate, rand, 0.003, 0.75);
    },
  ],
  // 더러러: 채편을 잘게 굴린다(조금 여려졌다가 끝을 살짝 세운다)
  roll: [
    0.6,
    false,
    (d, rate, rand) =>
      [0.7, 0.45, 0.55, 0.45, 0.5, 0.48, 0.62].forEach((g, i) =>
        deokInto(d, rate, rand, i * 0.048, g, 0.6),
      ),
  ],
};
// 자주 치는 소리는 무늬가 다른 표본 두세 개를 번갈아 써서 기계처럼 똑같지 않게
const DRUM_VARIANTS: Partial<Record<DrumHit, number>> = {
  shaker: 3,
  hat: 3,
  snap: 2,
  rim: 2,
  clap: 2,
  kung: 2,
  deok: 2,
};

const sampleCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
// 표본을 한 번 계산해 둔다(끝을 부드럽게 닫는다). 크기는 최대치 1로 맞추거나,
// rms를 주면 앞 80ms의 실효값을 그 값으로 맞춘다(음마다 크기가 고르게 들리게).
function sample(
  ctx: BaseAudioContext,
  key: string,
  seconds: number,
  rate: number,
  fill: (d: Float32Array, rate: number) => void,
  rms = 0,
) {
  let cache = sampleCache.get(ctx);
  if (!cache) sampleCache.set(ctx, (cache = new Map()));
  let buf = cache.get(key);
  if (buf) return buf;
  const d = new Float32Array(Math.max(1, Math.floor(rate * seconds)));
  fill(d, rate);
  let peak = 0,
    sum = 0;
  const head = Math.min(d.length, Math.floor(rate * 0.08));
  for (let i = 0; i < d.length; i++) {
    peak = Math.max(peak, Math.abs(d[i]));
    if (i < head) sum += d[i] * d[i];
  }
  const fade = Math.min(d.length, Math.floor(rate * 0.01)),
    level = Math.sqrt(sum / head),
    norm =
      rms > 0 && level > 0
        ? Math.min(rms / level, 1 / peak)
        : peak > 0
          ? 1 / peak
          : 0;
  for (let i = 0; i < d.length; i++) {
    const tail = d.length - i;
    d[i] *= norm * (tail < fade ? tail / fade : 1);
  }
  buf = ctx.createBuffer(1, d.length, rate);
  buf.getChannelData(0).set(d);
  cache.set(key, buf);
  return buf;
}
function drumSample(ctx: BaseAudioContext, hit: DrumHit, variant: number) {
  const [seconds, full, fill] = DRUMS[hit],
    v = variant % (DRUM_VARIANTS[hit] ?? 1);
  return sample(
    ctx,
    `drum|${hit}|${v}`,
    seconds,
    full ? ctx.sampleRate : PLUCK_RATE,
    (d, rate) => fill(d, rate, seeded(DRUM_HITS.indexOf(hit) * 31 + v * 7 + 3)),
  );
}
// 베이스: pizz는 손가락으로 뜯는 콘트라베이스, synth는 따뜻한 신스(필터가 빨리 닫힌다),
// round는 더 둥근 신스(장단 갈래의 가벼운 바탕)
// pizz는 배음을 직접 쌓는다: 바탕음 위 배음이 고르게 줄고(550Hz 위는 빠르게 깎는다)
// 높은 배음일수록 빨리 사라진다. 아주 낮은 바탕음은 조금 덜어 휴대폰에서도 2~6배음으로 들리게 하고,
// 음마다 앞 80ms 실효값을 맞춰 어느 음이나 같은 크기·같은 빛깔로 둥글게 난다(쨍한 줄 소리 없이).
const PIZZ = { cutoff: 550, low: 140, decay: 0.45, rms: 0.2 };
function pizzInto(d: Float32Array, rate: number, midi: number) {
  const f = hz(midi),
    modes: Mode[] = [];
  for (let k = 1; k <= 12 && f * k <= 1500; k++) {
    const fk = f * k;
    modes.push([
      k * (1 + 0.0004 * k * k),
      (k ** -0.3 * (fk / Math.hypot(fk, PIZZ.low))) /
        Math.sqrt(1 + (fk / PIZZ.cutoff) ** 4),
      PIZZ.decay / (1 + 0.25 * (k - 1)),
    ]);
  }
  modesInto(d, rate, 0, 1, f, modes, 0.004);
  // 손끝이 줄을 놓는 둔한 소리
  noiseInto(d, rate, seeded(31 + midi), 0, 0.08, 0.006, [[0, 700, 0.7]]);
}
function bassSample(ctx: BaseAudioContext, midi: number, tone: BassTone) {
  if (tone === "pizz")
    return sample(
      ctx,
      `bass|pizz|${midi}`,
      // 베이스는 길어야 0.5초쯤에서 끊으므로(hold) 0.6초면 된다
      0.6,
      PLUCK_RATE,
      (d, rate) => pizzInto(d, rate, midi),
      PIZZ.rms,
    );
  return sample(
    ctx,
    `bass|${tone}|${midi}`,
    0.5,
    PLUCK_RATE,
    (d, rate) => {
      const f = hz(midi);
      const synth = tone === "synth",
        lp = svf(rate, synth ? 1.1 : 0.8, 0),
        dt = f / rate;
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const s = i / rate;
        ph += dt;
        if (ph >= 1) ph -= 1;
        const saw = 2 * ph - 1 - polyBlep(ph, dt),
          cut = synth
            ? 320 + 1500 * Math.exp(-s / 0.07)
            : 230 + 650 * Math.exp(-s / 0.09),
          env = Math.min(1, s / 0.004) * Math.exp(-s / (synth ? 0.4 : 0.5));
        d[i] = (lp(saw, cut) + 0.45 * Math.sin(2 * Math.PI * ph)) * env;
      }
    },
  );
}
// 마림바(나무 건반, 네 배 윗음)·칼림바(쇠 혀, 여섯 배쯤의 맑은 윗음). 높은 음일수록 짧다.
const MALLET: Record<MalletTone, readonly Mode[]> = {
  marimba: [
    [1, 1, 0.42],
    [3.93, 0.3, 0.06],
    [9.4, 0.06, 0.018],
  ],
  kalimba: [
    [1, 1, 0.6],
    [2, 0.08, 0.25],
    [5.95, 0.12, 0.035],
  ],
};
function malletSample(ctx: BaseAudioContext, midi: number, tone: MalletTone) {
  return sample(ctx, `mallet|${tone}|${midi}`, 0.8, PLUCK_RATE, (d, rate) => {
    const shorter = 2 ** (-(midi - 64) / 24);
    modesInto(
      d,
      rate,
      0,
      1,
      hz(midi),
      MALLET[tone].map(([r, a, tau]) => [r, a, tau * shorter] as const),
      0.0015,
    );
    noiseInto(d, rate, seeded(midi), 0, 0.08, 0.003, [[0, 2500, 0.7]]);
  });
}
// 밝은 신스 뜯음: 조금 어긋난 톱니 둘을 빨리 닫히는 저역 통과로(5kHz 아래)
function arpSample(ctx: BaseAudioContext, midi: number) {
  return sample(ctx, `arp|${midi}`, 0.5, PLUCK_RATE, (d, rate) => {
    const f = hz(midi),
      lp = svf(rate, 1.3, 0),
      d1 = f / rate,
      d2 = (f * 1.004) / rate;
    let p1 = 0,
      p2 = 0.37;
    for (let i = 0; i < d.length; i++) {
      const s = i / rate;
      p1 += d1;
      if (p1 >= 1) p1 -= 1;
      p2 += d2;
      if (p2 >= 1) p2 -= 1;
      const x =
        (2 * p1 - 1 - polyBlep(p1, d1)) * 0.6 +
        (2 * p2 - 1 - polyBlep(p2, d2)) * 0.4;
      d[i] =
        lp(x, f * 1.5 + 3200 * Math.exp(-s / 0.05)) *
        Math.min(1, s / 0.002) *
        Math.exp(-s / 0.16);
    }
  });
}
// 표본 하나를 한 번 튼다: 소스 → 음량 → (공용 좌우 자리) → out. hold초 뒤 짧게 끊을 수 있다.
// 다 울리면 연결을 끊는다.
function playSample(
  ctx: BaseAudioContext,
  out: AudioNode,
  buf: AudioBuffer,
  t: number,
  gain: number,
  pan = 0,
  hold = 0,
) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(g).connect(panBus(ctx, out, pan));
  src.start(t);
  if (hold > 0 && hold < buf.duration) {
    g.gain.setTargetAtTime(0, t + hold, 0.025);
    src.stop(t + Math.min(buf.duration, hold + 0.2));
  }
  src.onended = () => g.disconnect();
}

// ── 배경음 작곡 ───────────────────────────────────────────────────────
// 세 갈래(산책·모험·장단)가 있다. 모두 E♭을 으뜸으로 해 효과음 가락과 어울린다.
// 한 마디씩 만들고, 8~16마디(쉼은 4~8마디)마다 부분(편성·화음 진행·반주 무늬)을 새로 고른다.
// 북은 두세 부분마다 빠졌다가 다음 부분에서 이음 장식과 함께 돌아온다. 가락은 짧게 부르고
// 받는(call·answer) 동기를 되풀이하되 네 부분마다 하나씩 새로 지어 10분을 걸어도 질리지 않게 한다.
// home(첫 화면·로비·보직·장비·완료)은 같은 갈래를 조금 느리고 높고 여리게 낸다.
// 추모(memorial)는 갈래와 상관없이 같은 낮은 음을 숨 쉬듯 크고 작게만 한다(가락·북 없음).
// 가락은 모두 아래의 짧은 리듬 칸과 무작위 걸음으로 새로 짓는다(기존 곡의 가락을 옮기지 않는다).
// 군가·행진곡 리듬(대취타 등)은 쓰지 않는다.
export type BgmEvent =
  | {
      kind: "pad";
      t: number;
      dur: number;
      notes: number[];
      gain: number;
      cutoff: number;
      wide?: boolean;
    }
  | { kind: "drone"; t: number; dur: number; notes: number[]; gain: number }
  | {
      kind: "pluck";
      t: number;
      note: number;
      gain: number;
      inst: "gayageum" | "geomungo";
      vib: number;
      pan: number;
      decay: number;
      bend?: number;
    }
  | { kind: "bell"; t: number; note: number; gain: number; decay: number }
  | { kind: "drum"; t: number; hit: DrumHit; gain: number; pan: number }
  | { kind: "bass"; t: number; note: number; gain: number; dur: number; tone: BassTone }
  | {
      kind: "mallet";
      t: number;
      notes: number[];
      gain: number;
      pan: number;
      tone: MalletTone;
    }
  | { kind: "arp"; t: number; note: number; gain: number; pan: number };

export const BGM_STYLES = ["a", "b", "c"] as const;
export type BgmStyle = (typeof BGM_STYLES)[number];
// 기본 갈래는 산책(a). 주소에 ?bgm=b처럼 붙여 다른 갈래를 들어 볼 수 있다(lib/sound.ts).
export const DEFAULT_BGM_STYLE: BgmStyle = "a";
export const BGM_STYLE_NAMES: Record<BgmStyle, string> = {
  a: "산책",
  b: "모험",
  c: "장단",
};
export function parseBgmStyle(v: unknown): BgmStyle | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (BGM_STYLES as readonly string[]).includes(s) ? (s as BgmStyle) : null;
}

export const PYEONG = [3, 5, 8, 10, 0]; // E♭ F A♭ B♭ C
export const BRIGHT = [3, 5, 7, 10, 0]; // E♭ F G B♭ C
export const EB_MAJOR = [3, 5, 7, 8, 10, 0, 2]; // 산책·모험의 화음과 베이스
const notesIn = (pcs: number[], lo: number, hi: number) =>
  Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((m) =>
    pcs.includes(m % 12),
  );
// 화음 음 반음 위에 걸리는 음(그 음이 화음 음이 아닐 때): 단2도·단9도로 부딪친다
// (예: G가 울리는 화음 위의 A♭, D가 울리는 화음 위의 E♭)
export const clashes = (midi: number, pcs: readonly number[]) => {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return !pcs.includes(pc) && pcs.includes((pc + 11) % 12);
};
// 효과음 가락을 그때 울리는 배경음 화음에 맞춘다: 화음 음 반음 위에 걸리는 음만 가까운 음으로
// 비킨다(화음 음 먼저, 그다음 E♭ 다섯 음). 오르내림 모양은 그대로 두고, 화음이 없으면
// (추모 숨결·배경음 없음) 그대로 낸다. 효과음 가락(평조 다섯 음)은 화음이 G·D를 품을 때만 움직인다.
export function fitNotes(
  notes: readonly number[],
  harmony?: readonly (readonly number[])[],
): number[] {
  if (!harmony?.length) return [...notes];
  const bad = (m: number) => harmony.some((pcs) => clashes(m, pcs)),
    tone = (m: number) => harmony.some((pcs) => pcs.includes(m % 12)),
    ok = (m: number) => tone(m) || PYEONG.includes(m % 12) || BRIGHT.includes(m % 12);
  const out: number[] = [];
  notes.forEach((m, i) => {
    let best = m;
    if (bad(m)) {
      const want = i > 0 ? Math.sign(m - notes[i - 1]) : 0;
      const cands = [-1, 1, -2, 2, -3, 3]
        .map((s) => m + s)
        .filter((n) => !bad(n) && ok(n) && (i === 0 || Math.sign(n - out[i - 1]) === want))
        .sort(
          (a, b) =>
            Number(!tone(a)) - Number(!tone(b)) || Math.abs(a - m) - Math.abs(b - m),
        );
      if (cands.length) best = cands[0];
    }
    out.push(best);
  });
  return out;
}
const pick = <T>(r: () => number, xs: readonly T[]) =>
  xs[Math.floor(r() * xs.length)];
// 좌우 자리는 0.05 단위로(공용 좌우 자리를 몇 개만 만들게)
const panStep = (v: number) => Math.round(clamp(v, -1, 1) * 20) / 20;
// 칸 악보: 한 글자가 8분음표 한 칸("."은 쉼), 박마다 띄어 쓴다. 소리 나는 칸과 그 글자를 돌려준다
const grid = (s: string) =>
  [...s.replace(/ /g, "")].flatMap((ch, i) =>
    ch === "." ? [] : [[i, ch] as const],
  );
const onsets = (s: string) => grid(s).map(([i]) => i);

type Tonal = "field" | "home";
// pad: 깔리는 화음, stab: 마림바가 짧게 치는 화음, root: 베이스 바탕음, pcs: 화음 음(가락이 박 위에서 기댄다)
type Chord = { pad: number[]; stab: number[]; root: number; pcs: number[] };
const chord = (pad: number[], stab: number[], root: number): Chord => ({
  pad,
  stab,
  root,
  pcs: [...new Set([...pad, ...stab].map((m) => m % 12))],
});
// E♭ 장조(산책·모험)
const MAJOR: Chord[] = [
  chord([51, 55, 58, 65], [58, 63, 67], 39), // 0 E♭add9
  chord([53, 56, 60, 63], [60, 63, 68], 41), // 1 Fm7
  chord([55, 58, 62, 65], [58, 62, 65], 43), // 2 Gm7
  chord([56, 60, 63, 67], [60, 63, 67], 44), // 3 A♭maj7
  chord([53, 58, 63, 68], [63, 65, 70], 46), // 4 B♭7sus4
  chord([53, 58, 62, 65], [62, 65, 70], 46), // 5 B♭
  chord([48, 55, 58, 63], [60, 63, 67], 36), // 6 Cm7
  chord([51, 55, 58, 65], [58, 63, 67], 43), // 7 E♭/G
];
// 평조(E♭ F A♭ B♭ C)의 4도·5도 쌓기(장단). 5는 첫 화면용 밝은 다섯 음의 Cm7
const PYEONG_CHORDS: Chord[] = [
  chord([51, 58, 63, 65], [63, 65, 70], 39), // 0 E♭ 5도+9
  chord([56, 60, 63, 70], [60, 63, 68], 44), // 1 A♭add9
  chord([48, 53, 58, 63], [60, 63, 65], 36), // 2 C 4도 쌓기
  chord([53, 60, 63, 70], [60, 65, 70], 41), // 3 F 4도 쌓기
  chord([53, 58, 60, 63], [60, 63, 65], 46), // 4 B♭sus
  chord([48, 55, 58, 63], [63, 67, 70], 36), // 5 Cm7
];

type BassRole = "R" | "F" | "O" | "A"; // 바탕음, 5도(없으면 4도), 옥타브, 다음 화음으로 이끄는 음
type BassPat = readonly (readonly [slot: number, role: BassRole])[];
const bassPat = (s: string): BassPat =>
  grid(s).map(([i, ch]) => [i, ch as BassRole] as const);
type Lead = "solo" | "duet" | "sparse" | "none";
// 부분 하나: drums 0(쉼)·1(가볍게)·2(다), bass·comp는 무늬 번호(-1 = 없음), lift는 가락 높이(음계 칸)
type Part = {
  bars: number[];
  drums: 0 | 1 | 2;
  bass: number[];
  comp: number[];
  lead: Lead[];
  lift?: number;
  open?: boolean;
  home?: boolean;
};
type BarCtx = {
  out: BgmEvent[];
  at: (slot: number) => number;
  slotLen: number;
  len: number;
  chordAt: (slot: number) => Chord;
  nextRoot: number;
  home: boolean;
  level: number;
  drums: 0 | 1 | 2;
  fill: boolean;
  partBar: number;
};
type StyleDef = {
  per: 2 | 3; // 한 박의 8분음표 칸 수(장단은 점4분음표 박이라 3)
  tempo: Record<Tonal, number>; // 박(장단은 점4분음표) 빠르기
  swing: Record<Tonal, number>; // 박 안 뒷 칸의 자리(0.5면 곧게)
  chords: Chord[];
  progs: Record<Tonal, number[][][]>; // 네 마디 진행: 마디마다 화음 번호(둘이면 반 마디씩)
  scale: Record<Tonal, number[]>; // 가야금 가락 음
  parts: Part[];
  bass: { pats: BassPat[]; tone: BassTone; gain: number; hold: [onBeat: number, off: number] };
  calls: number[][]; // 부르는 리듬(마디 안 칸)
  answers: number[][]; // 받는 리듬
  lead: {
    center: Record<Tonal, number>; // 가락이 머무는 가운데 음(미디). 첫 화면은 더 높게
    gain: number;
    decay: number;
    duet: Record<Tonal, MalletTone | "geomungo">;
    duetGain: number;
    bend: number;
  };
  pad: { gain: number; cutoff: Record<Tonal, number>; wide: boolean };
  homeLevel: number;
  bell: Record<Tonal, number>;
  drums: (c: Composer, x: BarCtx) => void;
  comp: (c: Composer, x: BarCtx) => void;
  // 미리 계산해 둘 표본: 이 갈래가 치는 북, 반주(comp)가 쓰는 표본
  hits: DrumHit[];
  compSamples: (mood: Tonal, chords: Chord[]) => SampleRef[];
};

function drumHit(c: Composer, x: BarCtx) {
  return (slot: number, hit: DrumHit, gain: number, pan = 0) =>
    x.out.push({
      kind: "drum",
      t: x.at(slot) + (c.rand() - 0.5) * 0.006,
      hit,
      gain: gain * x.level * (0.9 + c.rand() * 0.2),
      pan,
    });
}

// ── A 산책: 살짝 튀는 8분음표, 콘트라베이스 스타카토, 뒷박 마림바, 셰이커·손가락 튕기기 ──
const A_PROGS = [
  [[0], [3], [1], [4, 5]],
  [[0], [6], [3], [4]],
  [[3], [5], [2], [6]],
  [[0], [7], [3], [4, 5]],
  [[1], [5], [0], [6]],
  [[3], [2], [1], [4, 5]],
];
// 베이스 칸 악보: R 바탕음, F 5도, O 옥타브, A 다음 화음으로 이끄는 음
const A_BASS = [
  "R. .. F. ..", // 0 두 박 느낌
  "R. F. O. F.", // 1 걷기
  "R. .R F. .A", // 2 통통
  "R. OF R. FA", // 3 깡충
].map(bassPat);
const A_STABS = [
  [1, 3, 5, 7],
  [3, 7],
  [1, 5, 7],
  [3, 5, 7],
];
function drumsA(c: Composer, x: BarCtx) {
  const hit = drumHit(c, x);
  // 첫 화면은 셰이커를 더 여리게(휴대폰 스피커가 가장 크게 내는 높은 띠라 오래 들으면 귀가 피곤하다)
  const shake = x.home ? 0.7 : 1;
  if (x.drums > 0)
    for (let s = 0; s < 8; s++)
      if (x.drums === 2 || s % 2)
        hit(s, "shaker", (s % 2 ? 0.049 : 0.029) * shake, 0.25);
  if (x.drums === 2) {
    hit(2, "snap", 0.095, -0.15);
    hit(6, "snap", 0.095, -0.15);
    if (c.rand() < 0.3) hit(7, "rim", 0.04, 0.2);
  }
  // 북이 돌아오기 전 마디: 림 세 번으로 잇는다
  if (x.fill) [5, 6, 7].forEach((s, i) => hit(s, "rim", 0.035 + i * 0.012, 0.2));
}
function compA(c: Composer, x: BarCtx) {
  for (const slot of A_STABS[c.comp]) {
    const ch = x.chordAt(slot);
    x.out.push({
      kind: "mallet",
      t: x.at(slot) + (c.rand() - 0.5) * 0.008,
      notes: ch.stab,
      gain: 0.019 * x.level * (slot === 3 || slot === 7 ? 1 : 0.8),
      pan: slot % 4 === 1 ? -0.2 : 0.2,
      tone: x.home ? "kalimba" : "marimba",
    });
  }
}
const SANCHAEK: StyleDef = {
  per: 2,
  tempo: { field: 108, home: 104 },
  swing: { field: 0.6, home: 0.58 },
  chords: MAJOR,
  progs: { field: A_PROGS, home: A_PROGS },
  scale: { field: notesIn(BRIGHT, 63, 84), home: notesIn(BRIGHT, 67, 87) },
  parts: [
    // 산책: 다 같이
    { bars: [8], drums: 2, bass: [2, 1], comp: [0, 1], lead: ["solo", "duet"], open: true, home: true },
    // 수다: 가야금이 부르고 마림바가 받는다
    { bars: [8, 16], drums: 2, bass: [2, 3], comp: [1, 2], lead: ["duet"], home: true },
    // 쉼: 북이 빠지고 베이스는 두 박으로
    { bars: [4, 8], drums: 0, bass: [0], comp: [-1, 1], lead: ["sparse", "solo"], home: true },
    // 흥얼: 셰이커 뒷박만, 가락은 드물게
    { bars: [8], drums: 1, bass: [0, 1], comp: [0, 3], lead: ["none", "sparse"] },
    // 깡충: 높은 가락
    { bars: [8, 16], drums: 2, bass: [3, 1], comp: [0, 2], lead: ["solo", "duet"], lift: 2 },
  ],
  bass: { pats: A_BASS, tone: "pizz", gain: 0.061, hold: [1.1, 0.6] },
  calls: ["xx x. x. ..", "x. xx x. ..", "xx .x x. x.", ".x x. x. ..", "x. .x x. x.", "x. x. xx ..", "xx xx x. .."].map(onsets),
  answers: ["x. x. x. ..", ".x x. x. ..", "xx x. .. ..", ".. xx x. x.", "x. .. x. ..", "x. xx .. .."].map(onsets),
  lead: {
    center: { field: 72, home: 77 },
    gain: 0.112,
    decay: 1.5,
    duet: { field: "marimba", home: "kalimba" },
    duetGain: 0.038,
    bend: 0,
  },
  pad: { gain: 0.014, cutoff: { field: 1100, home: 1700 }, wide: false },
  homeLevel: 0.75,
  bell: { field: 0, home: 0.12 },
  drums: drumsA,
  comp: compA,
  hits: ["shaker", "snap", "rim"],
  compSamples: (mood, chords) =>
    chords.flatMap((ch) =>
      ch.stab.map((note): SampleRef => ({
        kind: "mallet",
        note,
        tone: mood === "home" ? "kalimba" : "marimba",
      })),
    ),
};

// ── B 모험: 곧은 8분음표, 신스 베이스, 1·3박 킥·2·4박 손뼉·하이햇, 밝은 아르페지오, 넓은 패드 ──
const B_PROGS = [
  [[0], [5], [6], [3]],
  [[3], [5], [6], [0]],
  [[6], [3], [0], [5]],
  [[0], [4], [6], [3]],
  [[3], [7], [1], [4]],
  [[0], [2], [3], [4, 5]],
];
const B_BASS = [
  "RR RR RR RR", // 0 8분음표
  "RR OR RR OF", // 1 옥타브 튕기기
  "R. RR .R O.", // 2 당김
  "R. R. R. R.", // 3 4분음표
  "R. .. F. ..", // 4 반 마디
].map(bassPat);
const B_ARPS: (number | null)[][] = [
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, 4, 1, 4, 2, 4, 1, 4],
  [0, 2, 1, 3, 2, 4, 3, 1],
  [0, null, 2, null, 1, null, 3, null],
];
function drumsB(c: Composer, x: BarCtx) {
  const hit = drumHit(c, x);
  if (x.drums > 0) {
    hit(0, "kick", x.home ? 0.026 : 0.044);
    if (!x.home) hit(4, "kick", x.drums === 2 ? 0.039 : 0.034);
    for (let s = 0; s < 8; s++) {
      if (x.drums === 1 && s % 2 === 0) continue;
      const open =
        s === 7 && x.drums === 2 && c.partBar % 2 === 1 && c.rand() < 0.6;
      hit(s, open ? "ohat" : "hat", open ? 0.03 : s % 2 ? 0.06 : 0.035, 0.2);
    }
    if (x.drums === 2) {
      hit(2, "clap", 0.1, -0.05);
      hit(6, "clap", 0.1, -0.05);
    }
  }
  // 북이 돌아오기 전 마디: 손뼉 셋으로 잇는다
  if (x.fill) [5, 6, 7].forEach((s, i) => hit(s, "clap", 0.05 + i * 0.015, -0.05));
}
// 아르페지오는 가락(가야금) 아래 자리에서 돌려 가락과 같은 음으로 겹치지 않게 한다
const arpRange = (home: boolean): [number, number] => (home ? [60, 76] : [55, 72]);
function compB(c: Composer, x: BarCtx) {
  const [lo, hi] = arpRange(x.home);
  B_ARPS[c.comp].forEach((k, slot) => {
    if (k === null) return;
    const tones = notesIn(x.chordAt(slot).pcs, lo, hi);
    x.out.push({
      kind: "arp",
      t: x.at(slot),
      note: tones[Math.min(k, tones.length - 1)],
      gain: 0.043 * x.level * (slot % 2 ? 0.75 : 1),
      pan: slot % 2 ? 0.3 : -0.3,
    });
  });
}
const MODEOM: StyleDef = {
  per: 2,
  tempo: { field: 124, home: 120 },
  swing: { field: 0.5, home: 0.5 },
  chords: MAJOR,
  progs: { field: B_PROGS, home: B_PROGS },
  scale: { field: notesIn(BRIGHT, 63, 84), home: notesIn(BRIGHT, 67, 87) },
  parts: [
    // 출발: 다 같이
    { bars: [8], drums: 2, bass: [0, 1], comp: [0, 1], lead: ["solo", "duet"], open: true, home: true },
    // 걷기: 킥·하이햇만
    { bars: [8, 16], drums: 1, bass: [2, 0], comp: [2, 0], lead: ["sparse", "solo"], home: true },
    // 숨 고르기: 북 없이 아르페지오 4분음표
    { bars: [4, 8], drums: 0, bass: [4, 3], comp: [3], lead: ["solo", "sparse"], home: true },
    // 오르막: 높은 가락, 칼림바가 받는다
    { bars: [8, 16], drums: 2, bass: [1], comp: [1, 2], lead: ["duet"], lift: 2 },
    // 순항: 가락 없이 반주만
    { bars: [8], drums: 1, bass: [3, 2], comp: [0], lead: ["none", "sparse"] },
  ],
  bass: { pats: B_BASS, tone: "synth", gain: 0.039, hold: [0.85, 0.85] },
  calls: ["x. .x .. x.", "x. .x x. x.", "x. xx .. x.", "xx .x .. x.", "x. .x .. xx", "x. .x .x x."].map(onsets),
  answers: ["x. x. x. ..", ".. xx x. ..", "x. .x x. ..", ".x x. x. x.", "x. .. x. x.", "x. .x .. .."].map(onsets),
  lead: {
    center: { field: 72, home: 77 },
    gain: 0.109,
    decay: 1.3,
    duet: { field: "kalimba", home: "kalimba" },
    duetGain: 0.029,
    bend: 0,
  },
  pad: { gain: 0.034, cutoff: { field: 1500, home: 2200 }, wide: true },
  homeLevel: 0.72,
  bell: { field: 0, home: 0.1 },
  drums: drumsB,
  comp: compB,
  hits: ["kick", "hat", "ohat", "clap"],
  compSamples: (mood, chords) =>
    chords.flatMap((ch) =>
      notesIn(ch.pcs, ...arpRange(mood === "home")).map(
        (note): SampleRef => ({ kind: "arp", note }),
      ),
    ),
};

// ── C 장단: 자진모리(12/8, 점4분음표 네 박) 장구, 평조 가야금, 가벼운 신스 베이스·패드 ──
const C_PROGS_FIELD = [
  [[0], [0], [1], [4]],
  [[0], [2], [1], [0]],
  [[1], [4], [0], [0]],
  [[2], [1], [4], [0]],
  [[0], [3], [1], [4]],
];
const C_PROGS_HOME = [
  [[0], [0], [5], [4]],
  [[0], [2], [3], [0]],
  [[5], [4], [0], [0]],
  [[0], [3], [5], [4]],
];
const C_BASS = [
  "R.. ... F.. R..",
  "R.. ..R F.. O.F",
  "R.. ... R.. ...",
  "R.. F.. O.. F..",
].map(bassPat);
// 장구 칸 악보(점4분음표 박마다 세 칸): D 덩, K 쿵(북편), T 덕(채편), R 더러러. 소문자는 여리게
const JANGGU = [
  "D.. T.K .K. T..", // 0 자진모리 기본: 덩 - - | 덕 - 쿵 | - 쿵 - | 덕 - -
  "D.t T.K .K. T.t", // 1 기덕을 섞어 잘게
  "D.. d.. K.t T.k", // 2 덩을 둘
  "D.. T.K .K. R..", // 3 끝을 더러러로 굴린다
  "K.. t.. .k. t..", // 4 가볍게(덩 없이)
  "K.. ... k.. ...", // 5 숨만(첫 박과 셋째 박)
  "k.. ... ... r..", // 6 장구가 돌아오기 전: 쿵 한 번 뒤 더러러
].map(grid);
const JANGGU_HIT: Record<string, DrumHit> = { d: "deong", k: "kung", t: "deok", r: "roll" };
const JANGGU_GAIN: Partial<Record<DrumHit, number>> = {
  deong: 0.068,
  kung: 0.048,
  deok: 0.045,
  roll: 0.03,
};
function jangguPattern(c: Composer, x: BarCtx) {
  if (x.fill) return x.drums === 0 ? 6 : 3;
  if (x.drums === 0) return -1;
  if (x.drums === 1) return x.home ? 5 : 4;
  if (x.home) return 4;
  return x.partBar % 4 === 3 && c.rand() < 0.6 ? 3 : c.groove % 3;
}
function drumsC(c: Composer, x: BarCtx) {
  const hit = drumHit(c, x),
    pat = jangguPattern(c, x);
  if (pat >= 0)
    for (const [slot, ch] of JANGGU[pat]) {
      const h = JANGGU_HIT[ch.toLowerCase()],
        soft = ch !== ch.toUpperCase();
      hit(
        slot,
        h,
        (JANGGU_GAIN[h] ?? 0.04) * (soft ? 0.55 : 1),
        h === "kung" ? -0.15 : h === "deok" || h === "roll" ? 0.15 : 0,
      );
    }
  // 요즘 느낌으로 박마다 끝 칸에 셰이커를 살짝
  if (x.drums === 2 && !x.home)
    for (const s of [2, 5, 8, 11]) hit(s, "shaker", 0.03, -0.3);
}
// 낮은 가야금이 화음 음(숫자: 아래에서 몇째 화음 음)을 점4분음표로 뜯는 바탕
const C_OST = ["0.. 1.. 2.. 1..", "0.. .2. 1.. .2.", "0.. ... 1.. ..."].map(grid);
const C_OST_RANGE: [number, number] = [51, 62],
  C_OST_DECAY = 1.2;
function compC(c: Composer, x: BarCtx) {
  for (const [slot, ch] of C_OST[c.comp]) {
    const tones = notesIn(x.chordAt(slot).pcs, ...C_OST_RANGE),
      k = Number(ch);
    x.out.push({
      kind: "pluck",
      t: x.at(slot) + (c.rand() - 0.5) * 0.01,
      note: tones[Math.min(k, tones.length - 1)],
      gain: 0.073 * x.level * (slot === 0 ? 1 : 0.8),
      inst: "gayageum",
      vib: 0,
      pan: -0.25,
      decay: C_OST_DECAY,
    });
  }
}
const JANGDAN: StyleDef = {
  per: 3,
  tempo: { field: 100, home: 96 },
  swing: { field: 0.5, home: 0.5 },
  chords: PYEONG_CHORDS,
  progs: { field: C_PROGS_FIELD, home: C_PROGS_HOME },
  scale: { field: notesIn(PYEONG, 63, 84), home: notesIn(BRIGHT, 65, 87) },
  parts: [
    // 한바탕: 자진모리 장단에 가야금
    { bars: [8], drums: 2, bass: [0, 1], comp: [0, -1], lead: ["solo", "duet"], open: true, home: true },
    // 주고받기: 가야금이 부르고 거문고가 받는다
    { bars: [8, 16], drums: 2, bass: [1, 3], comp: [1, 0], lead: ["duet"], home: true },
    // 장단 쉼: 장구 없이 가야금 바탕만
    { bars: [4, 8], drums: 0, bass: [2], comp: [2], lead: ["solo", "sparse"], home: true },
    // 가볍게: 덩 없이
    { bars: [8], drums: 1, bass: [0, 2], comp: [0], lead: ["sparse", "none"] },
    // 높은 가락
    { bars: [8, 16], drums: 2, bass: [3, 1], comp: [1], lead: ["solo", "duet"], lift: 2 },
  ],
  bass: { pats: C_BASS, tone: "round", gain: 0.044, hold: [1.8, 0.8] },
  calls: ["x.x x.. x.. ...", "x.x x.x x.. ...", "x.. xx. x.x ...", "xxx x.. x.. ...", "x.x x.. x.x x..", "x.. x.x x.x ..."].map(onsets),
  answers: ["x.. x.. x.. ...", "x.x x.. x.. ...", ".xx x.. x.. ...", "x.. x.x x.. ...", "x.. ... x.x ...", "x.x ... x.. ..."].map(onsets),
  lead: {
    center: { field: 70, home: 77 },
    gain: 0.1,
    decay: 1.9,
    duet: { field: "geomungo", home: "geomungo" },
    // 거문고 받음은 몸통 울림과 술대 소리가 더해져 크게 들리므로 부름(가야금)보다 1~2dB 아래로
    duetGain: 0.055,
    bend: 0.3,
  },
  pad: { gain: 0.013, cutoff: { field: 1000, home: 1500 }, wide: false },
  homeLevel: 0.75,
  bell: { field: 0, home: 0.15 },
  drums: drumsC,
  comp: compC,
  hits: ["deong", "kung", "deok", "roll", "shaker"],
  compSamples: (_, chords) =>
    chords.flatMap((ch) =>
      notesIn(ch.pcs, ...C_OST_RANGE).flatMap((note) => pluckRefs(note, "gayageum", C_OST_DECAY)),
    ),
};

const DEFS: Record<BgmStyle, StyleDef> = { a: SANCHAEK, b: MODEOM, c: JANGDAN };

export const MEMORIAL_BREATH = 6;
export const MEMORIAL_NOTES = [39, 46, 51, 58];
// 박 빠르기(BPM). 장단은 점4분음표 박
export function bgmTempo(mood: Tonal, style: BgmStyle = DEFAULT_BGM_STYLE) {
  return DEFS[style].tempo[mood];
}
export function barLength(mood: Mood, style: BgmStyle = DEFAULT_BGM_STYLE) {
  return mood === "memorial" ? MEMORIAL_BREATH : 240 / DEFS[style].tempo[mood];
}
// 부르는 리듬과 받는 리듬, 그리고 각 음이 첫 음에서 몇 칸(음계) 떨어지는지
type Motif = {
  call: number[];
  callSteps: number[];
  answer: number[];
  answerSteps: number[];
};
export type Composer = {
  mood: Mood;
  style: BgmStyle;
  t: number;
  bar: number;
  rand: () => number;
  part: number; // 지금 부분(-1: 아직 없음)
  next: number; // 다음 부분(마지막 마디의 이음 장식을 정하려고 미리 고른다)
  partBar: number;
  partLen: number;
  parts: number; // 지금까지 시작한 부분 수
  sinceRest: number; // 북이 쉰 뒤로 북과 함께 지난 부분 수
  progs: number[]; // 네 마디마다 번갈아 쓸 진행 번호
  bass: number;
  comp: number;
  groove: number;
  lead: Lead;
  lift: number;
  shift: number; // 동기를 다시 부를 때 옮기는 음계 칸
  motifs: Motif[];
  motif: number;
  deg: number; // 가락이 머무는 음계 자리
  hook: number; // 이 부분에서 동기를 부르는 자리(부분 안에서는 같은 높이로 되풀이해 기억에 남게)
  padChord: number;
  padUntil: number;
  // 최근 화음이 시작한 시각과 그 음 이름들(효과음이 그때 울리는 화음에 맞추려고 몇 개만 남긴다)
  chords: { t: number; pcs: number[] }[];
};
function contour(r: () => number, n: number) {
  const steps = [0];
  for (let i = 1, cur = 0; i < n; i++) {
    let s = [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)];
    if (Math.abs(cur + s) > 4) s = -s;
    cur += s;
    steps.push(cur);
  }
  return steps;
}
function makeMotif(r: () => number, d: StyleDef): Motif {
  const call = pick(r, d.calls),
    answer = pick(r, d.answers);
  return {
    call,
    callSteps: contour(r, call.length),
    answer,
    answerSteps: contour(r, answer.length),
  };
}
export function createComposer(
  mood: Mood,
  seed = 1,
  start = 0,
  style: BgmStyle = DEFAULT_BGM_STYLE,
): Composer {
  const c: Composer = {
    mood,
    style,
    t: start,
    bar: 0,
    rand: seeded(seed),
    part: -1,
    next: -1,
    partBar: 0,
    partLen: 0,
    parts: 0,
    sinceRest: 0,
    progs: [-1],
    bass: 0,
    comp: -1,
    groove: 0,
    lead: "solo",
    lift: 0,
    shift: 1,
    motifs: [],
    motif: 0,
    deg: 3,
    hook: -1,
    padChord: -1,
    padUntil: -1,
    chords: [],
  };
  if (mood !== "memorial") {
    const d = DEFS[style];
    c.motifs = [makeMotif(c.rand, d), makeMotif(c.rand, d)];
    c.deg = nearest(d.scale[mood], d.lead.center[mood]);
  }
  return c;
}
// 다음 부분 고르기: 처음은 여는 부분, 쉰 뒤에는 북이 다 돌아오고, 북과 함께 두세 부분을
// 지나면 쉰다. 같은 부분을 바로 되풀이하지 않는다.
function choosePart(c: Composer, d: StyleDef, home: boolean, prev: number) {
  const r = c.rand,
    ok = d.parts.map((_, i) => i).filter((i) => !home || d.parts[i].home),
    where = (f: (p: Part, i: number) => boolean) =>
      ok.filter((i) => f(d.parts[i], i));
  let pool: number[];
  if (prev < 0) pool = where((p) => !!p.open);
  else if (d.parts[prev].drums === 0) pool = where((p) => p.drums === 2);
  else if (c.sinceRest >= 3 || (c.sinceRest >= 2 && r() < 0.5))
    pool = where((p) => p.drums === 0);
  else pool = where((p, i) => p.drums > 0 && i !== prev);
  return pick(r, pool.length ? pool : ok);
}
function startPart(c: Composer, d: StyleDef, mood: Tonal) {
  const r = c.rand,
    home = mood === "home";
  c.part = c.next >= 0 ? c.next : choosePart(c, d, home, -1);
  const p = d.parts[c.part];
  c.sinceRest = p.drums === 0 ? 0 : c.sinceRest + 1;
  c.next = choosePart(c, d, home, c.part);
  c.partBar = 0;
  c.partLen = pick(r, p.bars);
  const n = d.progs[mood].length;
  let first = Math.floor(r() * n);
  if (first === c.progs[0]) first = (first + 1) % n;
  c.progs = [first, r() < 0.5 ? first : (first + 1 + Math.floor(r() * (n - 1))) % n];
  c.bass = pick(r, p.bass);
  c.comp = pick(r, p.comp);
  const leads = home ? p.lead.filter((l) => l !== "none") : p.lead;
  c.lead = pick(r, leads.length ? leads : (["solo"] as Lead[]));
  c.groove = Math.floor(r() * 3);
  c.lift = p.lift ?? 0;
  c.shift = pick(r, [1, -1, 2]);
  c.hook = -1;
  // 가락 동기: 네 부분마다 하나를 새로 짓고, 그 사이에는 가끔 다른 동기로 바꿔 부른다
  if (c.parts > 0 && c.parts % 4 === 0) {
    c.motif = 1 - c.motif;
    c.motifs[c.motif] = makeMotif(r, d);
  } else if (c.parts > 0 && r() < 0.3) c.motif = 1 - c.motif;
  c.parts++;
}
function chordsOf(c: Composer, d: StyleDef, mood: Tonal, bar: number) {
  const prog = d.progs[mood][c.progs[Math.floor(bar / 4) % c.progs.length]];
  return prog[bar % 4];
}
// 같은 화음이 이어지는 동안은 패드를 한 번에 길게 깐다
function padBar(c: Composer, d: StyleDef, x: BarCtx, chords: number[], mood: Tonal) {
  chords.forEach((idx, i) => {
    const t = x.at(0) + (chords.length > 1 ? (i * x.len) / 2 : 0);
    if (idx === c.padChord && c.padUntil > t + 0.05) return;
    let span = chords.length > 1 ? 0.5 : 1;
    if (chords.length === 1)
      for (let b = c.partBar + 1; b < c.partLen; b++) {
        const n = chordsOf(c, d, mood, b);
        if (n.length !== 1 || n[0] !== idx) break;
        span++;
      }
    c.padChord = idx;
    c.padUntil = t + span * x.len;
    x.out.push({
      kind: "pad",
      t,
      dur: span * x.len + 0.25,
      notes: d.chords[idx].pad,
      gain: d.pad.gain * x.level,
      cutoff: d.pad.cutoff[mood],
      ...(d.pad.wide ? { wide: true } : {}),
    });
  });
}
// t부터 span초 동안 울리는 배경음 화음들(음 이름 0~11). 추모 숨결이거나 아직 시작 전이면 빈 목록
export function harmonyAt(c: Composer, t: number, span = 0.5): number[][] {
  const log = c.chords,
    out: number[][] = [];
  log.forEach((e, i) => {
    const end = log[i + 1]?.t ?? c.t;
    if (e.t <= t + span && end > t) out.push(e.pcs);
  });
  return out;
}
// 다음 화음 바탕음으로 이끄는 음: 장조 안에서 한 음 아래, 없으면 위
function approach(root: number) {
  for (const s of [-2, -1, 2, 1])
    if (EB_MAJOR.includes((root + s + 120) % 12)) return root + s;
  return root;
}
// 베이스의 5도(화음에 없으면 4도, 그것도 없으면 옥타브)
function fifthOf(ch: Chord) {
  const has = (m: number) => ch.pcs.includes(m % 12);
  return has(ch.root + 7) ? ch.root + 7 : has(ch.root + 5) ? ch.root + 5 : ch.root + 12;
}
function bassBar(c: Composer, d: StyleDef, x: BarCtx) {
  const r = c.rand;
  for (const [slot, role] of d.bass.pats[c.bass]) {
    const ch = x.chordAt(slot),
      fifth = fifthOf(ch);
    const note =
      role === "F"
        ? fifth
        : role === "O"
          ? ch.root + 12
          : role === "A"
            ? x.nextRoot < 0
              ? fifth
              : approach(x.nextRoot)
            : ch.root;
    const onBeat = slot % d.per === 0;
    x.out.push({
      kind: "bass",
      t: x.at(slot) + (r() - 0.5) * 0.008,
      note,
      gain:
        d.bass.gain *
        x.level *
        (slot === 0 ? 1 : onBeat ? 0.9 : 0.78) *
        (0.94 + r() * 0.12),
      dur: x.slotLen * d.bass.hold[onBeat ? 0 : 1],
      tone: d.bass.tone,
    });
  }
}
// 거문고 받음(한 옥타브 아래)의 울림 길이(초)
const GEO_DUET_DECAY = 1.6;
// 음계에서 주어진 음(미디)에 가장 가까운 자리
function nearest(scale: number[], midi: number) {
  let best = 0;
  scale.forEach((m, i) => {
    if (Math.abs(m - midi) < Math.abs(scale[best] - midi)) best = i;
  });
  return best;
}
const reflect = (k: number, top: number) =>
  clamp(k < 0 ? -k : k > top ? 2 * top - k : k, 0, top);
// 가까운 화음 음 자리(없으면 그대로)
function toChord(scale: number[], k: number, pcs: number[]) {
  for (const s of [0, -1, 1, -2, 2]) {
    const j = k + s;
    if (j >= 0 && j < scale.length && pcs.includes(scale[j] % 12)) return j;
  }
  return k;
}
// 네 마디 한 묶음: 부름 → 받음 → (옮겨) 다시 부름 → 받음(묶음 끝이면 으뜸음으로 닫는다)
function leadBar(c: Composer, d: StyleDef, x: BarCtx, mood: Tonal) {
  const k = c.partBar % 4,
    end = c.partBar === c.partLen - 1 || c.partBar % 8 === 7;
  const role =
    c.lead === "none"
      ? null
      : c.lead === "sparse"
        ? k === 0
          ? "call"
          : k === 2
            ? "again"
            : null
        : k === 0
          ? "call"
          : k === 2
            ? "again"
            : k === 3 && end
              ? "close"
              : "answer";
  if (!role) return;
  const r = c.rand,
    m = c.motifs[c.motif],
    scale = d.scale[mood],
    top = scale.length - 1,
    calling = role === "call" || role === "again",
    rhythm = calling ? m.call : m.answer,
    steps = calling ? m.callSteps : m.answerSteps,
    center = clamp(nearest(scale, d.lead.center[mood]) + c.lift, 0, top),
    duet = c.lead === "duet" && !calling,
    duetInst = d.lead.duet[mood];
  // 부름은 부분 안에서 같은 자리에서, 다시 부름은 그 자리를 옮겨서(반복 진행), 받음은 지금 자리 근처에서
  if (calling && c.hook < 0) c.hook = clamp(Math.round((c.deg + center * 2) / 3), 0, top);
  const base = calling ? c.hook + (role === "again" ? c.shift : 0) : (c.deg + center) / 2;
  const anchor = toChord(scale, clamp(Math.round(base), 0, top), x.chordAt(rhythm[0]).pcs);
  let prev = -1;
  rhythm.forEach((slot, i) => {
    const last = i === rhythm.length - 1,
      ch = x.chordAt(slot);
    const onBeat = slot % d.per === 0 || last,
      dir = i > 0 ? Math.sign(steps[i] - steps[i - 1]) : 0;
    let deg = reflect(anchor + steps[i], top);
    if (onBeat) deg = toChord(scale, deg, ch.pcs);
    if (last && role === "close")
      deg = toChord(scale, deg, [ch.pcs.includes(3) ? 3 : ch.root % 12]);
    // 화음 음에 맞추다 움직여야 할 음이 앞 음과 같아지면 가려던 쪽으로 옮긴다
    // (박 위에서는 그쪽의 다음 화음 음으로, 박 사이에서는 한 칸)
    else if (deg === prev && dir !== 0) {
      if (!onBeat) deg = reflect(deg + dir, top);
      else
        for (let j = deg + dir; j >= 0 && j <= top && Math.abs(j - deg) <= 3; j += dir)
          if (ch.pcs.includes(scale[j] % 12)) {
            deg = j;
            break;
          }
    }
    // 화음 음 반음 위에 걸리는 음(D 위의 E♭ 등)은 이웃 음으로 비킨다(가던 쪽 먼저)
    if (clashes(scale[deg], ch.pcs))
      for (const s of dir < 0 ? [-1, 1] : [1, -1]) {
        const j = deg + s;
        if (j >= 0 && j <= top && !clashes(scale[j], ch.pcs)) {
          deg = j;
          break;
        }
      }
    prev = deg;
    c.deg = deg;
    const gap = (rhythm[i + 1] ?? d.per * 4 + 1) - slot,
      t = x.at(slot) + (r() - 0.5) * 0.012,
      accent = i === 0 ? 1.08 : 0.88 + r() * 0.2,
      pan = panStep((r() - 0.5) * 0.3);
    if (duet && duetInst !== "geomungo")
      x.out.push({
        kind: "mallet",
        t,
        notes: [scale[deg]],
        gain: d.lead.duetGain * accent * (x.home ? 0.85 : 1),
        pan: -pan,
        tone: duetInst,
      });
    else if (duet)
      x.out.push({
        kind: "pluck",
        t,
        note: scale[deg] - 12,
        gain: d.lead.duetGain * accent * (x.home ? 0.85 : 1),
        inst: "geomungo",
        vib: gap >= 3 ? 18 : 0,
        pan: 0,
        decay: GEO_DUET_DECAY,
      });
    else {
      // 장단 갈래: 끝음을 가끔 이웃 음으로 밀어 올리거나(추성) 내린다(퇴성)
      let bend = 0;
      if (last && gap >= 4 && d.lead.bend > 0 && r() < d.lead.bend) {
        const to = deg + (r() < 0.5 ? 1 : -1);
        if (to >= 0 && to <= top) bend = scale[to] - scale[deg];
      }
      x.out.push({
        kind: "pluck",
        t,
        note: scale[deg],
        gain: d.lead.gain * accent * (x.home ? 0.9 : 1),
        inst: "gayageum",
        vib: !bend && gap >= 3 && r() < 0.45 ? 10 + r() * 12 : 0,
        pan,
        decay: d.lead.decay,
        ...(bend ? { bend } : {}),
      });
    }
  });
}
export function composeBar(c: Composer): BgmEvent[] {
  const out: BgmEvent[] = [];
  if (c.mood === "memorial") {
    out.push({
      kind: "drone",
      t: c.t,
      dur: MEMORIAL_BREATH * 1.6,
      notes: MEMORIAL_NOTES,
      gain: 0.02,
    });
    c.t += MEMORIAL_BREATH;
    c.bar++;
    return out;
  }
  const mood = c.mood,
    d = DEFS[c.style],
    r = c.rand,
    home = mood === "home";
  if (c.partBar >= c.partLen) startPart(c, d, mood);
  const p = d.parts[c.part],
    beat = 60 / d.tempo[mood],
    len = beat * 4,
    slotLen = beat / d.per,
    half = d.per * 2,
    swing = d.swing[mood],
    t0 = c.t;
  const at = (s: number) =>
    t0 +
    Math.floor(s / d.per) * beat +
    (d.per === 2 ? (s % 2 ? swing * beat : 0) : (s % d.per) * slotLen);
  const chords = chordsOf(c, d, mood, c.partBar),
    chordAt = (s: number) => d.chords[chords[chords.length > 1 && s >= half ? 1 : 0]],
    lastBar = c.partBar === c.partLen - 1;
  chords.forEach((idx, i) =>
    c.chords.push({ t: t0 + (i * len) / chords.length, pcs: d.chords[idx].pcs }),
  );
  if (c.chords.length > 8) c.chords.splice(0, c.chords.length - 8);
  const x: BarCtx = {
    out,
    at,
    slotLen,
    len,
    chordAt,
    nextRoot: lastBar ? -1 : d.chords[chordsOf(c, d, mood, c.partBar + 1)[0]].root,
    home,
    level: home ? d.homeLevel : 1,
    drums: p.drums,
    fill: lastBar && d.parts[c.next].drums > p.drums,
    partBar: c.partBar,
  };
  padBar(c, d, x, chords, mood);
  bassBar(c, d, x);
  d.drums(c, x);
  if (c.comp >= 0) d.comp(c, x);
  leadBar(c, d, x, mood);
  // 첫 화면은 가끔 편경을 높고 작게
  if (d.bell[mood] > 0 && r() < d.bell[mood]) {
    const ch = chordAt(0),
      n = ch.stab[Math.floor(r() * ch.stab.length)] + 12;
    out.push({
      kind: "bell",
      t: at(Math.floor(r() * 4) * d.per),
      note: n <= 86 ? n : n - 12,
      gain: 0.011,
      decay: 2.6,
    });
  }
  // 마디 안에서는 시간 순서대로, 마디 시작보다 앞서지 않게
  for (const e of out) e.t = Math.max(t0, e.t);
  out.sort((a, b) => a.t - b.t);
  c.partBar++;
  c.t += len;
  c.bar++;
  return out;
}
// until(초)보다 앞에서 시작하는 마디를 모두 만든다
export function compose(c: Composer, until: number): BgmEvent[] {
  const out: BgmEvent[] = [];
  while (c.t < until) out.push(...composeBar(c));
  return out;
}
export function playBgmEvent(ctx: BaseAudioContext, out: AudioNode, e: BgmEvent) {
  switch (e.kind) {
    case "pad":
      pad(ctx, out, e.t, e);
      break;
    case "drone":
      drone(ctx, out, e.t, e);
      break;
    case "pluck":
      pluck(ctx, out, e.t, {
        midi: e.note,
        gain: e.gain,
        inst: e.inst,
        vib: e.vib,
        pan: e.pan,
        decay: e.decay,
        variant: pluckVariant(e.t),
        bend: e.bend,
        bendAt: 0.2,
      });
      break;
    case "bell":
      bell(ctx, out, e.t, { midi: e.note, gain: e.gain, decay: e.decay, mallet: 0.2 });
      break;
    case "drum":
      playSample(
        ctx,
        out,
        drumSample(ctx, e.hit, drumVariant(e.hit, e.t)),
        e.t,
        e.gain,
        e.pan,
      );
      break;
    case "bass":
      playSample(ctx, out, bassSample(ctx, e.note, e.tone), e.t, e.gain, 0, e.dur);
      break;
    case "arp":
      playSample(ctx, out, arpSample(ctx, e.note), e.t, e.gain, e.pan);
      break;
    case "mallet": {
      // 화음의 음들을 음량 하나로 모아 친다
      const g = gainNode(ctx, e.gain, panBus(ctx, out, e.pan));
      let src: AudioBufferSourceNode | null = null;
      for (const m of e.notes) {
        src = ctx.createBufferSource();
        src.buffer = malletSample(ctx, m, e.tone);
        src.connect(g);
        src.start(e.t);
      }
      if (src) src.onended = () => g.disconnect();
    }
  }
}

// ── 미리 계산해 둘 표본 ───────────────────────────────────────────────
// 표본은 처음 쓸 때 계산하므로, 새 북·새 음이 처음 나오는 마디마다 화면이 잠깐 멈출 수 있다.
// 그래서 분위기를 시작하면 그 갈래·분위기가 쓸 수 있는 표본 전체(유한하다)를 조금씩 미리 계산해 둔다
// (lib/sound.ts가 한가한 틈에 몇 ms씩). 목록은 작곡이 실제로 쓰는 열쇠와 같다(시험으로 확인).
export type SampleRef =
  | { kind: "drum"; hit: DrumHit; variant: number }
  | { kind: "bass"; note: number; tone: BassTone }
  | { kind: "mallet"; note: number; tone: MalletTone }
  | { kind: "arp"; note: number }
  | { kind: "pluck"; note: number; tone: PluckTone };
const PLUCK_VARIANTS = 3;
function drumVariant(hit: DrumHit, t: number) {
  return Math.round(t * 997) % (DRUM_VARIANTS[hit] ?? 1);
}
function pluckVariant(t: number) {
  return Math.round(t * 7) % PLUCK_VARIANTS;
}
function pluckRefs(
  note: number,
  inst: "gayageum" | "geomungo",
  decay: number,
): SampleRef[] {
  return Array.from({ length: PLUCK_VARIANTS }, (_, variant) => ({
    kind: "pluck",
    note,
    tone: pluckTone({ midi: note, inst, decay, variant }),
  }));
}
export function sampleKey(r: SampleRef): string {
  switch (r.kind) {
    case "drum":
      return `drum|${r.hit}|${r.variant % (DRUM_VARIANTS[r.hit] ?? 1)}`;
    case "bass":
      return `bass|${r.tone}|${r.note}`;
    case "mallet":
      return `mallet|${r.tone}|${r.note}`;
    case "arp":
      return `arp|${r.note}`;
    case "pluck":
      return `pluck|${pluckKey(r.note, r.tone)}`;
  }
}
// 배경음 사건 하나가 쓰는 표본
export function eventSamples(e: BgmEvent): SampleRef[] {
  switch (e.kind) {
    case "drum":
      return [{ kind: "drum", hit: e.hit, variant: drumVariant(e.hit, e.t) }];
    case "bass":
      return [{ kind: "bass", note: e.note, tone: e.tone }];
    case "arp":
      return [{ kind: "arp", note: e.note }];
    case "mallet":
      return e.notes.map((note) => ({ kind: "mallet", note, tone: e.tone }));
    case "pluck":
      return [
        {
          kind: "pluck",
          note: e.note,
          tone: pluckTone({
            midi: e.note,
            inst: e.inst,
            decay: e.decay,
            variant: pluckVariant(e.t),
          }),
        },
      ];
    default:
      return [];
  }
}
// 한 갈래·분위기가 쓸 수 있는 표본 전체(같은 열쇠는 한 번). plucks=false면 뜯는 줄은 뺀다
// (뜯는 줄은 크고 많아서 지금 분위기 것만 데운다)
export function bgmSamples(mood: Mood, style: BgmStyle, plucks = true): SampleRef[] {
  if (mood === "memorial") return [];
  const d = DEFS[style],
    scale = d.scale[mood],
    duet = d.lead.duet[mood],
    chords = [...new Set(d.progs[mood].flat(2))].map((i) => d.chords[i]),
    refs: SampleRef[] = [];
  for (const hit of d.hits)
    for (let variant = 0; variant < (DRUM_VARIANTS[hit] ?? 1); variant++)
      refs.push({ kind: "drum", hit, variant });
  for (const ch of chords)
    for (const note of [ch.root, fifthOf(ch), ch.root + 12, approach(ch.root)])
      refs.push({ kind: "bass", note, tone: d.bass.tone });
  refs.push(...d.compSamples(mood, chords));
  for (const note of scale) {
    if (duet === "geomungo") refs.push(...pluckRefs(note - 12, "geomungo", GEO_DUET_DECAY));
    else refs.push({ kind: "mallet", note, tone: duet });
    refs.push(...pluckRefs(note, "gayageum", d.lead.decay));
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = sampleKey(r);
    if ((!plucks && r.kind === "pluck") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function warmSample(ctx: BaseAudioContext, r: SampleRef) {
  switch (r.kind) {
    case "drum":
      return void drumSample(ctx, r.hit, r.variant);
    case "bass":
      return void bassSample(ctx, r.note, r.tone);
    case "mallet":
      return void malletSample(ctx, r.note, r.tone);
    case "arp":
      return void arpSample(ctx, r.note);
    case "pluck":
      return void pluckBuffer(ctx, r.note, r.tone);
  }
}

// ── 배경음 틀기: 분위기 바꾸기 ────────────────────────────────────────
// lib/sound.ts와 파일 렌더(미리 듣기)가 같은 방법으로 분위기를 넘기도록 여기 둔다.
export const BGM_FADE = 2.4; // 처음 시작하거나 추모 숨결에서 나올 때 차오르는 시간(초)
export const BGM_LOOKAHEAD = 0.6; // 몇 초 앞까지 마디를 미리 만들어 예약하는가
export type BgmSwitch = {
  oldAt: number; // 앞 분위기가 줄어들기 시작하는 시각
  oldTau: number; // 앞 분위기가 줄어드는 빠르기(시간 상수, 초)
  start: number; // 새 분위기의 첫 마디 시각
  rampFrom: number; // 새 분위기 음량이 0에서 오르기 시작하는 시각
  rampTo: number; // 1이 되는 시각
};
// from.next: 앞 분위기가 아직 만들지 않은 다음 마디의 시작(=지금 예약된 마지막 마디의 끝)
export function bgmSwitch(
  from: { mood: Mood; next: number } | null,
  to: Mood | null,
  now: number,
): BgmSwitch {
  // 추모 숨결로 갈 때(추모 거점·조용한 구역)와 끌 때는 앞 분위기를 곧장 줄인다.
  // 이미 예약된 북·베이스도 0.6초 뒤에는 −35dB 아래로 묻힌다.
  if (to === "memorial" || to === null)
    return {
      oldAt: now,
      oldTau: to ? 0.15 : 0.4,
      start: now + 0.2,
      rampFrom: now,
      rampTo: now + BGM_FADE,
    };
  // 박이 있는 두 분위기 사이(첫 화면 ↔ 이동): 앞 분위기는 예약된 마디까지만 치고, 그 마디가 끝나는
  // 자리에서 새 분위기가 첫 박을 친다(빠르기가 다른 두 북이 겹쳐 엇박으로 엉키지 않게)
  if (from && from.mood !== "memorial") {
    const start = Math.max(now + 0.2, from.next);
    return { oldAt: start, oldTau: 0.35, start, rampFrom: start - 0.5, rampTo: start + 0.8 };
  }
  // 처음이거나 추모 숨결에서 나올 때: 숨결은 천천히 걷히고 새 분위기가 차오른다
  return {
    oldAt: now,
    oldTau: 0.6,
    start: now + 0.2,
    rampFrom: now,
    rampTo: now + BGM_FADE,
  };
}
type DeckRun = { mood: Mood; gain: GainNode; composer: Composer; end: number };
export type BgmDeck = {
  // 지금 분위기(없으면 null)
  readonly mood: Mood | null;
  // 울리거나 줄어드는 중인 분위기가 있는가(없으면 tick을 멈춰도 된다)
  readonly busy: boolean;
  // 분위기를 바꾼다. 바뀌었으면 true
  set(mood: Mood | null, style: BgmStyle, seed: number, now: number): boolean;
  // now + BGM_LOOKAHEAD 앞까지 마디를 만들어 예약하고, 다 줄어든 분위기를 치운다
  tick(now: number): void;
  // t부터 0.5초 동안 울리는 화음들(효과음 맞추기용)
  harmony(t: number): number[][];
};
export function createBgmDeck(ctx: BaseAudioContext, out: AudioNode): BgmDeck {
  let run: DeckRun | null = null;
  const fading: DeckRun[] = [];
  const retire = (r: DeckRun, at: number, tau: number) => {
    const g = r.gain.gain;
    holdAt(g, at);
    g.setTargetAtTime(0, at, tau);
    // −80dB 아래가 되면 치운다
    r.end = at + tau * 9.2;
  };
  return {
    get mood() {
      return run?.mood ?? null;
    },
    get busy() {
      return !!run || fading.length > 0;
    },
    set(mood, style, seed, now) {
      if ((run?.mood ?? null) === mood) return false;
      const plan = bgmSwitch(
        run ? { mood: run.mood, next: run.composer.t } : null,
        mood,
        now,
      );
      if (run) {
        retire(run, plan.oldAt, plan.oldTau);
        fading.push(run);
      }
      run = null;
      // 추모 숨결로 갈 때는 아직 줄어드는 중인 앞 분위기들도 곧장 줄인다
      if (mood === "memorial" || mood === null)
        for (const f of fading)
          if (f.end > now + plan.oldTau * 9.2) retire(f, now, plan.oldTau);
      if (mood) {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        if (plan.rampFrom > now) gain.gain.setValueAtTime(0, plan.rampFrom);
        gain.gain.linearRampToValueAtTime(1, plan.rampTo);
        gain.connect(out);
        run = {
          mood,
          gain,
          composer: createComposer(mood, seed, plan.start, style),
          end: Infinity,
        };
      }
      return true;
    },
    tick(now) {
      for (let i = fading.length - 1; i >= 0; i--)
        if (fading[i].end <= now) {
          try {
            fading[i].gain.disconnect();
          } catch {}
          fading.splice(i, 1);
        }
      if (!run) return;
      // 화면이 멈춰 밀린 마디는 건너뛴다(한꺼번에 몰아 치지 않게)
      if (run.composer.t < now) run.composer.t = now + 0.05;
      for (const e of compose(run.composer, now + BGM_LOOKAHEAD))
        playBgmEvent(ctx, run.gain, e);
    },
    harmony(t) {
      const out: number[][] = [];
      for (const r of run ? [run, ...fading] : fading)
        if (r.end > t) out.push(...harmonyAt(r.composer, t));
      return out;
    },
  };
}
