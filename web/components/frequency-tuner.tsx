"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { Minus, Plus, Radio } from "lucide-react";
import {
  DETENTS_PER_TURN,
  MHZ_PER_TURN,
  angleDelta,
  angleToTenths,
  bandStep,
  formatTenths,
  keyStep,
  parseTenths,
  pointerAngle,
  tenthsInRange,
  tenthsToAngle,
  toTenths,
  turn,
  wheelDetents,
} from "./dial-math";
import s from "./frequency-tuner.module.css";
import { play, staticNoise, type StaticHandle } from "@/lib/sound";

// ── 소리 ─────────────────────────────────────────────────────────────
// 멈춤 칸을 넘을 때마다 딸깍(사용자 조작만). 손가락으로 돌리는 동안에는 무전 잡음이
// 깔리고, 손을 떼면 맑은 음으로 가라앉았다 사라진다. 잡음은 '돌리는 중인지'에만
// 반응하고 정답과의 거리는 모른다.
let hiss: StaticHandle | null = null,
  hissEnd: ReturnType<typeof setTimeout> | undefined;
const sound = {
  tick: () => play("dial-tick"),
  tuning(on: boolean) {
    clearTimeout(hissEnd);
    if (on) {
      hiss ??= staticNoise();
      hiss.setSignal(0.2);
      return;
    }
    const h = hiss;
    if (!h) return;
    h.setSignal(1);
    hissEnd = setTimeout(() => {
      h.stop();
      if (hiss === h) hiss = null;
    }, 450);
  },
  quiet() {
    clearTimeout(hissEnd);
    hiss?.stop();
    hiss = null;
  },
};

/** 지원하는 기기에서만 아주 짧게 떤다. 막혀 있어도 조용히 넘어간다. */
function buzz() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator)
      navigator.vibrate(5);
  } catch {}
}

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 통신원 주파수 조절 장치: 큰 회전 다이얼(주 조작) + ±0.1 버튼 + 직접 입력.
 * 화면 반응(파형 흔들림·바늘·불빛)은 사용자의 조작에만 반응한다. 정답과 무관하다.
 */
export function FrequencyTuner({
  value,
  onChange,
  min,
  max,
}: {
  /** 입력 칸의 글자 그대로("51.8"). 다이얼이 바꿀 때는 항상 소수 첫째 자리. */
  value: string;
  onChange: (text: string) => void;
  min: number;
  max: number;
}) {
  const minT = toTenths(min),
    maxT = toTenths(max);
  // 직접 입력 중인 글자가 범위 안의 숫자가 아니면("5", "120", "") 다이얼은
  // 마지막으로 맞춘 값에 머문다. 칸을 벗어날 때 범위 안으로 정리한다.
  const lastValid = useRef(parseTenths(value, minT, maxT) ?? minT);
  const t = tenthsInRange(value, minT, maxT) ?? lastValid.current;
  const cur = useRef(t);
  useLayoutEffect(() => {
    lastValid.current = t;
    cur.current = t;
  }, [t]);

  const root = useRef<HTMLDivElement>(null),
    dial = useRef<HTMLDivElement>(null),
    trace = useRef<SVGPathElement>(null);
  const scope = useScope(t, minT, maxT, root, trace);

  /** 사용자가 바꾼 값: 칸이 바뀌면 소리·진동을 한 번 낸다. */
  const set = (next: number) => {
    if (next === cur.current) return;
    cur.current = next;
    onChange(formatTenths(next));
    sound.tick();
    buzz();
  };

  // ── 손가락·마우스로 돌리기 ──
  const drag = useRef<{
    id: number;
    cx: number;
    cy: number;
    dead: number;
    angle: number;
    last: number | null;
  } | null>(null);
  const where = (e: { clientX: number; clientY: number }) => {
    const d = drag.current!;
    const dx = e.clientX - d.cx,
      dy = e.clientY - d.cy;
    // 중심 가까이에서는 방향이 마구 바뀌므로 무시한다.
    return Math.hypot(dx, dy) < d.dead ? null : pointerAngle(dx, dy);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget,
      box = el.getBoundingClientRect();
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    drag.current = {
      id: e.pointerId,
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      dead: box.width * 0.1,
      angle: tenthsToAngle(cur.current, minT),
      last: null,
    };
    drag.current.last = where(e);
    el.dataset.dragging = "";
    sound.tuning(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const a = where(e);
    if (a === null || d.last === null) {
      d.last = a;
      return;
    }
    d.angle = turn(d.angle, angleDelta(d.last, a), minT, maxT);
    d.last = a;
    set(angleToTenths(d.angle, minT, maxT));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    delete e.currentTarget.dataset.dragging;
    sound.tuning(false);
  };

  // ── 마우스 휠: React의 onWheel은 passive라 기본 스크롤을 막지 못해 직접 붙인다 ──
  const setRef = useRef(set);
  useLayoutEffect(() => {
    setRef.current = set;
  });
  useEffect(() => {
    const el = dial.current;
    if (!el) return;
    let rest = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const r = wheelDetents(rest, delta, e.deltaMode);
      rest = r.rest;
      if (r.detents)
        setRef.current(
          Math.min(maxT, Math.max(minT, cur.current + r.detents)),
        );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minT, maxT]);

  // 돌리던 중에 화면이 바뀌어도 잡음이 남지 않게 한다.
  useEffect(() => () => sound.quiet(), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = keyStep(e.key, cur.current, minT, maxT);
    if (next === null) return;
    e.preventDefault();
    set(next);
  };

  const angle = tenthsToAngle(t, minT),
    shown = formatTenths(t),
    at = (t - minT) / Math.max(1, maxT - minT),
    step = bandStep(min, max);
  const labels: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step)
    labels.push(v);

  return (
    <div ref={root} className={`radio-panel ${s.panel}`}>
      <div className={s.readout}>
        <span className={s.lamp} aria-hidden="true">
          <Radio size={20} />
        </span>
        <input
          className={s.lcd}
          aria-label="주파수 직접 입력"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step="0.1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // 직접 입력은 칸을 벗어날 때 범위 안 소수 첫째 자리로 정리한다.
          onBlur={() => {
            const next = formatTenths(
              parseTenths(value, minT, maxT) ?? lastValid.current,
            );
            if (next !== value) onChange(next);
          }}
        />
        <span className={s.unit}>MHz</span>
      </div>

      <div className={s.scope} aria-hidden="true">
        <svg
          className={s.wave}
          viewBox={`0 0 ${scope.W} ${scope.H}`}
          preserveAspectRatio="none"
        >
          <path ref={trace} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={s.band}>
          {labels.map((v) => (
            <span
              key={v}
              style={{ left: `${((v - min) / (max - min)) * 100}%` }}
            >
              {v}
            </span>
          ))}
        </div>
        <i className={s.needle} style={{ "--at": at } as CSSProperties} />
      </div>

      <div className={s.head}>
        <span id="frequency-label">주파수 조절</span>
        <small>돌려서 맞추기 · 한 바퀴 {MHZ_PER_TURN} MHz</small>
      </div>
      <div className={s.row}>
        <button
          type="button"
          className={`button secondary ${s.nudge}`}
          aria-label="주파수 0.1 낮추기"
          data-sound="none"
          onClick={() => set(Math.max(minT, cur.current - 1))}
        >
          <Minus size={20} aria-hidden="true" />
        </button>
        <div
          ref={dial}
          id="frequency"
          role="slider"
          tabIndex={0}
          aria-labelledby="frequency-label"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={t / 10}
          aria-valuetext={`${shown} 메가헤르츠`}
          className={s.dial}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          onKeyDown={onKeyDown}
        >
          <DialScale />
          <div className={s.shadow} />
          <div
            className={s.knob}
            style={{ transform: `rotate(${angle}deg)` }}
          >
            <DialKnob />
          </div>
          <div className={s.gloss} />
        </div>
        <button
          type="button"
          className={`button secondary ${s.nudge}`}
          aria-label="주파수 0.1 높이기"
          data-sound="none"
          onClick={() => set(Math.min(maxT, cur.current + 1))}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 움직이지 않는 바깥 눈금: 0.1 MHz마다 짧게, 0.5마다 중간, 1 MHz마다 길게. */
function DialScale() {
  return (
    <svg className={s.scale} viewBox="-100 -100 200 200" aria-hidden="true">
      <circle r="97" className={s.bezel} />
      {Array.from({ length: DETENTS_PER_TURN }, (_, i) => {
        const len = i % 10 === 0 ? 11 : i % 5 === 0 ? 8 : 5;
        return (
          <line
            key={i}
            y1={-95}
            y2={-95 + len}
            className={i % 10 === 0 ? s.major : undefined}
            transform={`rotate(${(i * 360) / DETENTS_PER_TURN})`}
          />
        );
      })}
    </svg>
  );
}

/** 손잡이 테두리의 톱니(널링) 60개: 바깥 반지름 80, 안쪽 75.5인 네모 톱니 윤곽. */
const RIM = (() => {
  const teeth = 60,
    p = (r: number, k: number) => {
      const a = (k / teeth) * 2 * Math.PI;
      return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
    };
  let d = "";
  for (let i = 0; i < teeth; i++)
    d +=
      `${i ? "L" : "M"}${p(80, i)}L${p(80, i + 0.5)}` +
      `L${p(75.5, i + 0.5)}L${p(75.5, i + 1)}`;
  return d + "Z";
})();

/** 돌아가는 손잡이: 톱니(널링) 테두리, 크림색 면, 남색 윤곽, 노란 지침. */
function DialKnob() {
  return (
    <svg viewBox="-100 -100 200 200" aria-hidden="true">
      <path d={RIM} className={s.rim} />
      <circle r="66" className={s.face} />
      <circle r="52" className={s.groove} />
      <circle r="36" className={s.groove} />
      <rect
        x="-6.5"
        y="-62"
        width="13"
        height="42"
        rx="6.5"
        className={s.pointer}
      />
      <circle cy="-52" r="2.6" className={s.pip} />
      <circle r="12" className={s.cap} />
      <circle r="3.5" className={s.capDot} />
    </svg>
  );
}

/**
 * 오실로스코프 파형: 돌리면 조작 방향으로 흐르며 지글거리고, 멈추면 고른 파형으로 가라앉는다.
 * 파형의 촘촘함은 지금 맞춘 값(낮은 주파수일수록 성김)만 따른다. 정답과 무관하다.
 * 매 프레임 React 상태를 바꾸지 않고 path와 CSS 변수(--tune)만 고친다. 가라앉으면 멈춘다.
 */
function useScope(
  t: number,
  minT: number,
  maxT: number,
  root: RefObject<HTMLDivElement | null>,
  trace: RefObject<SVGPathElement | null>,
) {
  const W = 300,
    H = 44;
  const st = useRef({
    t,
    prev: t,
    energy: 0,
    phase: 0,
    target: 0,
    raf: 0,
    at: 0,
  });
  const draw = () => {
    const v = st.current,
      path = trace.current;
    if (!path) return;
    const cycles = 2.5 + ((v.t - minT) / Math.max(1, maxT - minT)) * 7,
      e = v.energy,
      amp = H * 0.3 * (1 - 0.3 * e),
      n = 96;
    let d = "";
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      let y = Math.sin((i / n) * cycles * 2 * Math.PI + v.phase) * amp;
      if (e > 0.01) {
        const jitter = (Math.random() * 2 - 1) * H * 0.32 * e;
        y += Math.random() < e * 0.1 ? jitter * 1.6 : jitter;
      }
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${(H / 2 + y).toFixed(1)}`;
    }
    path.setAttribute("d", d);
    root.current?.style.setProperty("--tune", e.toFixed(3));
  };
  const frame = (now: number) => {
    const v = st.current,
      dt = Math.min(64, now - (v.at || now));
    v.at = now;
    v.energy *= Math.exp(-dt / 320);
    v.phase += (v.target - v.phase) * (1 - Math.exp(-dt / 110));
    if (v.energy < 0.01 && Math.abs(v.target - v.phase) < 0.002) {
      v.energy = 0;
      v.phase = v.target;
      v.raf = 0;
      draw();
      return;
    }
    draw();
    v.raf = requestAnimationFrame(frame);
  };
  useEffect(() => {
    const v = st.current,
      moved = t - v.prev;
    v.t = t;
    v.prev = t;
    if (!moved || reducedMotion()) {
      v.phase = v.target += moved * 0.5;
      draw();
      return;
    }
    v.energy = Math.min(
      1,
      v.energy + Math.min(0.4, 0.12 + Math.abs(moved) * 0.03),
    );
    v.target += moved * 0.5;
    if (!v.raf) {
      v.at = 0;
      v.raf = requestAnimationFrame(frame);
    }
  }, [t]);
  useEffect(() => {
    const v = st.current;
    return () => {
      cancelAnimationFrame(v.raf);
      v.raf = 0;
    };
  }, []);
  return { W, H };
}
