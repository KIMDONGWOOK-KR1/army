"use client";
// 통신원 '목소리 잡기'(hh 2026-11-09): 다이얼을 돌리면 잡음 속 기록실 목소리(TTS 음성 파일)가 점점 또렷해진다.
// 11/8 맛보기 '기록실 무전기'의 방식을 정문에 옮겼다. 목소리 채널은 정답이 아니라 이 폰이 정하는 자리라 화면 쪽에 있다.
// 다 들으면 판을 깨고, 들은 내용으로 다음 판(서버 문항)에서 무전이 말한 곳을 고른다.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { isAudioForeground, subscribeAudioFocus } from "@/lib/audio-focus";
import { acquireBgmSilence, isMuted, play, subscribeMuted } from "@/lib/sound";
import { Power, Radio, RotateCcw } from "lucide-react";
import { buzz } from "./use-field-sense";
import s from "./dogam.module.css";

export const GATE_VOICE = {
  src: "/sound/radio/gate-archive.mp3",
  text: "여기는 기록실이에요. 1980년의 정문은 철문이었어요. 그 철문을 작게 다시 세운 곳이 가까이 있어요. 찾으면 동료에게 알려 줘요.",
};
const MIN = 40, MAX = 60;
const NOISE = "░▒▓";
const clamp = (f: number) => Math.round(Math.max(MIN, Math.min(MAX, f)) * 10) / 10;

/** 방마다 다른 목소리 자리(42.0~58.0). 같은 방이면 늘 같다. */
export function voiceChannel(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 42 + ((h >>> 0) % 161) / 10;
}
/** 신호 세기(넓게): 목소리가 안 들려도 가까워지는지 알 수 있게 막대·'가까워져요'에만 쓴다 */
const nearAt = (f: number, target: number) => Math.max(0, 1 - Math.abs(f - target) / 9);
const clarityAt = (f: number, target: number) => {
  const d = Math.abs(f - target);
  return d <= 0.1 ? 1 : d >= 1.2 ? 0 : 1 - (d - 0.1) / 1.1;
};

type Audio = {
  ctx: AudioContext; noise: GainNode; voice: GainNode; lp: BiquadFilterNode; drive: WaveShaperNode;
  whistle: OscillatorNode; whistleGain: GainNode; dur: number; stop: () => void;
};

/** 무전 목소리의 찌그러짐: 맑을수록 덜 찌그러진다(0~1) */
function driveCurve(amount: number) {
  const n = 1024, curve = new Float32Array(n), k = 2 + amount * 28;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
}
/** 실제 무전처럼: 스퀠치가 열리는 '칙' → 목소리 → 로저 '삑' → 스퀠치 꼬리 '치익' → 쉼. 한 바퀴를 버퍼 하나로 만든다. */
function transmission(ctx: BaseAudioContext, voice: AudioBuffer) {
  const sr = ctx.sampleRate, open = Math.round(sr * 0.22), beep = Math.round(sr * 0.14), tail = Math.round(sr * 0.32), rest = Math.round(sr * 0.9);
  const lead = Math.round(sr * 0.08);
  const out = ctx.createBuffer(1, open + lead + voice.length + beep + tail + rest, sr), d = out.getChannelData(0), v = voice.getChannelData(0);
  const hiss = (i: number) => (Math.random() * 2 - 1);
  for (let i = 0; i < open; i++) d[i] = hiss(i) * 0.5 * Math.min(1, (open - i) / (open * 0.6));
  d.set(v, open + lead);
  let at = open + lead + voice.length;
  for (let i = 0; i < beep; i++) { const env = Math.min(1, i / 200, (beep - i) / 200); d[at + i] = Math.sin(2 * Math.PI * 1150 * i / sr) * 0.32 * env; }
  at += beep;
  for (let i = 0; i < tail; i++) d[at + i] = hiss(i) * 0.6 * (1 - i / tail);
  return out;
}

export function VoiceRadio({ seed, done, onDone, reduce }: { seed: string; done: boolean; onDone: () => void; reduce: boolean }) {
  const target = useRef(voiceChannel(seed)).current;
  const [on, setOn] = useState(false);
  const [f, setF] = useState(50);
  const [heard, setHeard] = useState(done ? 1 : 0);
  const audio = useRef<Audio | null>(null);
  const finished = useRef(done);
  const lastTick = useRef(50);
  const c = on ? clarityAt(f, target) : 0;
  const near = on ? nearAt(f, target) : 0;
  // 다이얼을 돌린 쪽으로 신호가 세지는지 약해지는지(잠깐 보였다 사라진다)
  const [trend, setTrend] = useState<"up" | "down" | null>(null);
  const lastNear = useRef(near);
  useEffect(() => {
    if (!on) return;
    const d = near - lastNear.current;
    if (Math.abs(d) < 0.02) return;
    lastNear.current = near;
    setTrend(d > 0 ? "up" : "down");
    const t = window.setTimeout(() => setTrend(null), 900);
    return () => window.clearTimeout(t);
  }, [near, on]);
  // 처음 또렷하게 잡은 순간: '신호 포착' 번쩍
  const [locked, setLocked] = useState(false);
  const wasClear = useRef(false);
  useEffect(() => {
    if (c >= 1 && !wasClear.current) {
      wasClear.current = true; setLocked(true); buzz([30, 30, 60]); play("lock-tick");
      const t = window.setTimeout(() => setLocked(false), 1400);
      return () => window.clearTimeout(t);
    }
    if (c < 1) wasClear.current = false;
  }, [c]);
  // 오실로스코프: 잡음이 걷힐수록 지글거림이 줄고 고른 물결이 커진다
  const scope = useRef<HTMLCanvasElement>(null);
  const clarity = useRef(c);
  clarity.current = c;
  useEffect(() => {
    const cv = scope.current;
    if (!cv || !on) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 300, h = cv.clientHeight || 54;
    cv.width = w * dpr; cv.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0, phase = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const k = clarity.current;
      phase += reduce ? 0.02 : 0.12;
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(127,224,181,.18)"; g.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.strokeStyle = k >= 1 ? "#ffd166" : "#7fe0b5"; g.lineWidth = 2;
      g.shadowColor = g.strokeStyle; g.shadowBlur = 6;
      g.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const wave = Math.sin(x / 14 + phase) * Math.sin(x / 47 + phase / 3) * k;
        const noise = (Math.random() * 2 - 1) * (1 - k) * 0.85;
        const y = h / 2 + (wave * 0.8 + noise) * (h / 2 - 4);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [on, reduce]);

  // 소리: 잡음은 맑아질수록 줄고, 목소리는 커지며 고음이 열린다
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const t = a.ctx.currentTime;
    a.noise.gain.setTargetAtTime(0.24 * (1 - c * 0.85), t, 0.05);
    a.voice.gain.setTargetAtTime(c < 0.15 ? 0 : 0.12 + c * 0.5, t, 0.05);
    // 맑아질수록 고음이 열리되 무전 대역(3.1kHz)은 넘지 않는다. 덜 맞으면 더 찌그러진다
    a.lp.frequency.setTargetAtTime(500 + c * 2600, t, 0.05);
    a.drive.curve = driveCurve(1 - c * 0.75);
    a.whistleGain.gain.setTargetAtTime(c > 0 && c < 1 ? 0.045 * Math.sin(Math.PI * c) : 0, t, 0.05);
    a.whistle.frequency.setTargetAtTime(380 + (1 - c) * 2200, t, 0.05);
  }, [c]);

  // 또렷하게 맞춘 채 들은 시간: 목소리 한 바퀴를 다 들으면 판을 깬다
  useEffect(() => {
    if (!on || c < 1 || finished.current) return;
    const need = (audio.current?.dur ?? 7) + 0.4;
    const id = window.setInterval(() => { if (isAudioForeground() && !isMuted() && audio.current?.ctx.state === "running") setHeard((h) => Math.min(1, h + 0.1 / need)); }, 100);
    return () => window.clearInterval(id);
  }, [on, c]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (heard < 1 || finished.current) return;
    audio.current?.stop(); audio.current = null;
    finished.current = true; buzz([20, 40, 20]);
    const t = window.setTimeout(() => doneRef.current(), reduce ? 50 : 700);
    return () => window.clearTimeout(t);
  }, [heard, reduce]);

  useEffect(() => () => { audio.current?.stop(); audio.current = null; }, []);
  useEffect(() => { if (done) { audio.current?.stop(); audio.current = null; } }, [done]);

  const start = async () => {
    if (audio.current) return;
    setOn(true); buzz(15);
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      // Assign ownership before any await so a fast second tap cannot create another radio.

      const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      // 잡음: 분홍빛 잡음에 가끔 '틱·탁' 튀는 소리를 섞고, 무전기 스피커 대역으로 좁힌다
      const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), nd = nb.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < nd.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        if (Math.random() < 0.00018) for (let j = 0; j < 90 && i + j < nd.length; j++) nd[i + j] += (Math.random() * 2 - 1) * (1 - j / 90) * 0.9;
      }
      const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.7;
      const noise = ctx.createGain(); noise.gain.value = 0.24;
      ns.connect(bp).connect(noise).connect(master); ns.start();
      // 맞추기 직전의 '삐요오' 휘파람(헤테로다인): 반쯤 맞을 때 가장 크다
      const whistle = ctx.createOscillator(); whistle.type = "sine"; whistle.frequency.value = 2000;
      const whistleGain = ctx.createGain(); whistleGain.gain.value = 0;
      whistle.connect(whistleGain).connect(master); whistle.start();
      // 목소리: 무전 대역(300~3000Hz) + 콧소리 나는 중음 + 찌그러짐 + 압축 + 전파가 흔들리는 페이딩
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 330; hp.Q.value = 0.9;
      const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1700; mid.Q.value = 1.1; mid.gain.value = 6;
      const drive = ctx.createWaveShaper(); drive.curve = driveCurve(1); drive.oversample = "2x";
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500; lp.Q.value = 0.8;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -26; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.12;
      const fade = ctx.createGain(); fade.gain.value = 0.9;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.37; const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.1;
      lfo.connect(lfoDepth).connect(fade.gain); lfo.start();
      const voice = ctx.createGain(); voice.gain.value = 0;
      hp.connect(mid).connect(drive).connect(lp).connect(comp).connect(fade).connect(voice).connect(master);
      // 켤 때 '딸깍'
      const click = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.03), ctx.sampleRate), cd = click.getChannelData(0);
      for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004)) * 0.8;
      const clickSrc = ctx.createBufferSource(); clickSrc.buffer = click; clickSrc.connect(master); clickSrc.start();
      const releaseBgm = acquireBgmSilence();
      let stopped = false;
      const update = () => {
        if (stopped) return;
        const audible = !isMuted() && isAudioForeground();
        master.gain.cancelScheduledValues(ctx.currentTime); master.gain.value = audible ? .9 : 0;
        void (audible ? ctx.resume() : ctx.suspend()).catch(() => {});
      };
      const releaseFocus = subscribeAudioFocus(update), releaseMute = subscribeMuted(update);
      const a: Audio = { ctx, noise, voice, lp, drive, whistle, whistleGain, dur: 7, stop: () => {
        if (stopped) return; stopped = true; releaseFocus(); releaseMute();
        master.gain.value = 0; try { ns.stop(); whistle.stop(); lfo.stop(); void ctx.close().catch(() => {}); } catch {} releaseBgm();
      } };
      audio.current = a; update();
      const buf = await fetch(GATE_VOICE.src).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
      if (audio.current !== a) return;
      // 한 바퀴: 스퀠치 '칙' → 목소리 → 로저 '삑' → '치익' → 쉼(무전이 되풀이된다)
      const padded = transmission(ctx, buf);
      const src = ctx.createBufferSource(); src.buffer = padded; src.loop = true; src.connect(hp); src.start();
      a.dur = padded.duration;
      const stopNoise = a.stop;
      a.stop = () => { try { src.stop(); } catch { /* 이미 멈춤 */ } stopNoise(); };
    } catch { audio.current?.stop(); audio.current = null; setOn(false); /* 자막은 유지 */ }
  };

  const tune = useCallback((next: number) => {
    const v = clamp(next);
    setF(v);
    if (Math.abs(v - lastTick.current) >= 0.5) { lastTick.current = v; buzz(6); }
  }, []);

  // 다이얼: 끌면 돈다(가로로 끄는 만큼). 둥근 손잡이는 돌리는 맛만 낸다
  const drag = useRef<{ x: number; f: number } | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, f }; };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (drag.current) tune(drag.current.f + (e.clientX - drag.current.x) / 14); };
  const up = () => { drag.current = null; };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); tune(f + 0.1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); tune(f - 0.1); }
  };

  const bars = Math.max(Math.round(c * 5), Math.round(near * near * 4));
  const caption = done || heard >= 1 ? GATE_VOICE.text
    : c < 0.2 ? "치직… 치지직… 잡음뿐이에요."
    : [...GATE_VOICE.text].map((ch, i) => " .,…".includes(ch) || ((i * 37) % 100) / 100 < c * c ? ch : NOISE[i % 3]).join("");

  if (done) return <div className={s.vrDone} data-testid="voice-radio-done">
    <span className={s.radioLabel}><Radio size={16} aria-hidden /> 내가 잡은 기록실 무전</span>
    <span className={s.vrStamp} aria-hidden>수신 완료</span>
    <p>{GATE_VOICE.text}</p>
  </div>;

  return <div className={s.vr} data-on={on || undefined} data-testid="voice-radio" data-clarity={c.toFixed(2)}>
    {!on && <button type="button" className={`${s.btn} ${s.vrPower}`} onClick={() => void start()} data-testid="voice-radio-on">
      <Power size={20} aria-hidden /> 무전기 켜기
    </button>}
    <div className={s.vrTop} data-locked={locked || undefined}>
      <span className={s.vrLamp} style={{ opacity: 0.3 + c * 0.7 }} data-blink={c >= 1 || undefined} aria-hidden><Radio size={22} /></span>
      <output className={s.vrLcd} aria-live="off">{f.toFixed(1)}</output><span className={s.vrUnit}>MHz</span>
      {locked && <span className={s.vrLock} role="status">신호 포착!</span>}
    </div>
    <canvas ref={scope} className={s.vrScope} aria-hidden data-on={on || undefined} />
    <div className={s.vrMeterRow}>
      <div className={s.vrMeter} aria-label={`신호 ${bars}칸`} role="img">{[0, 1, 2, 3, 4].map((i) => <i key={i} data-on={i < bars || undefined} />)}</div>
      <span className={s.vrTrend} data-trend={trend ?? undefined} aria-live="polite">
        {trend === "up" ? "▲ 가까워져요" : trend === "down" ? "▼ 멀어져요" : ""}
      </span>
    </div>
    <div className={s.vrBand} aria-hidden>
      {Array.from({ length: 21 }, (_, i) => <span key={i} className={s.vrTick} data-big={i % 5 === 0 || undefined} style={{ left: `${i * 5}%` }}>
        {i % 5 === 0 && <b>{MIN + i}</b>}</span>)}
      <span className={s.vrNeedle} style={{ left: `${(f - MIN) / (MAX - MIN) * 100}%` }} />
    </div>
    <div className={s.vrKnobRow}>
      <button type="button" className={s.vrStep} onClick={() => tune(f - 0.1)} disabled={!on} aria-label="0.1 내리기">−0.1</button>
      <div className={s.vrKnob} role="slider" tabIndex={on ? 0 : -1} aria-label="주파수 다이얼" aria-valuemin={MIN} aria-valuemax={MAX}
        aria-valuenow={f} aria-valuetext={`${f.toFixed(1)}MHz`} aria-disabled={!on}
        style={{ transform: `rotate(${(f - MIN) * 36}deg)` }}
        onPointerDown={on ? down : undefined} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={on ? key : undefined}>
        <span className={s.vrGrip} />
      </div>
      <button type="button" className={s.vrStep} onClick={() => tune(f + 0.1)} disabled={!on} aria-label="0.1 올리기">+0.1</button>
    </div>
    <p className={s.vrCap} data-clear={c >= 1 || undefined} style={{ "--static": on ? (1 - c).toFixed(2) : "0" } as CSSProperties} aria-live="polite">{on ? caption : "무전기를 켜면 잡음이 들려요. 소리를 켜 두세요."}</p>
    {on && <div className={s.vrHoldRow}><span>받아 적는 중</span><div className={s.vrHold} aria-hidden><i style={{ width: `${heard * 100}%` }} /></div><b>{Math.round(heard * 100)}%</b></div>}
    <p className={s.note}>{c >= 1 ? "그대로 들고 끝까지 들어요." : c > 0 ? "목소리가 들려요. 조금만 더 맞춰요." : "끌어서 다이얼을 돌려요. 잡음이 줄어드는 쪽을 찾아요."}
      {on && f !== 50 && c === 0 && <button type="button" className={s.linkBtn} onClick={() => tune(50)}><RotateCcw size={14} aria-hidden /> 가운데로</button>}</p>
  </div>;
}
