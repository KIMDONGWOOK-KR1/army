"use client";
// 통신원 신호 쫓기(진짜 나침반): 채널을 맞춘 뒤 폰을 들고 천천히 돌면, 기록실 신호가 오는 쪽(정문 동쪽 5·18 소공원)을
// 볼수록 잡음이 걷힌다. 화살표는 없다. 소리와 신호 막대만 보고 찾는다. 그쪽을 잠깐 가리키면 신호를 잡는다.
// 그림으로 할 때는 안테나 다이얼을 끌어 돌린다. 신호가 오는 쪽은 공개된 장소 방향이다(정답 아님).
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { MoveHorizontal, Radio } from "lucide-react";
import { play, staticNoise, type StaticHandle } from "@/lib/sound";
import { angleDiff, FIELD_BEARING, signalStrength } from "@/lib/field-sense";
import { SenseGate } from "./sense-gate";
import { buzz, type SenseMode, useDialHeading, useDragTurn, useHeading } from "./use-field-sense";
import s from "./dogam.module.css";

const HOLD_MS = 1500;
const LOCK_DEG = 22;

export function SignalHunt({ found, onFound, onDrawn, mode = "live" }: {
  found: boolean; onFound: () => void; onDrawn: () => void; mode?: SenseMode;
}) {
  const live = mode === "live";
  const real = useHeading();
  const dial = useDialHeading(300);
  const compass = live ? real : dial;
  const hiss = useRef<StaticHandle | null>(null);
  const waves = useRef<HTMLDivElement>(null);
  const [hold, setHold] = useState(0);
  const [locked, setLocked] = useState(found);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;
  const on = compass.state === "on" && !locked;
  const { live: heading, stop } = compass;
  useDragTurn(waves, dial.turn, !live && on, 0.4);

  useEffect(() => {
    if (!on) return;
    let since = 0;
    const timer = window.setInterval(() => {
      const h = heading.current;
      if (h == null) return;
      const d = angleDiff(FIELD_BEARING.park, h);
      hiss.current?.setSignal(signalStrength(d));
      const now = performance.now();
      if (Math.abs(d) < LOCK_DEG) {
        since ||= now;
        const p = Math.min(1, (now - since) / HOLD_MS);
        setHold(p);
        if (p >= 1) {
          window.clearInterval(timer);
          hiss.current?.stop(); hiss.current = null;
          stop();
          setLocked(true); play("stop-open"); buzz([30, 60, 30]);
          window.setTimeout(() => onFoundRef.current(), 900);
        }
      } else if (since) { since = 0; setHold(0); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [on, heading, stop]);
  useEffect(() => () => { hiss.current?.stop(); hiss.current = null; }, []);

  const begin = () => {
    void compass.start();
    // 누른 순간에 소리를 깨운다(아이폰은 누른 순간에만 소리를 켤 수 있다)
    hiss.current ??= staticNoise();
    hiss.current.setSignal(0);
  };
  useEffect(() => {
    if (real.state === "denied" || real.state === "none") { hiss.current?.stop(); hiss.current = null; }
  }, [real.state]);

  const d = compass.heading == null ? 180 : angleDiff(FIELD_BEARING.park, compass.heading);
  const k = locked ? 1 : signalStrength(d), bars = Math.max(locked ? 5 : 0, Math.ceil(k * 5));
  const line = locked ? "신호를 잡았어요. 폰이 가리키던 쪽으로 가 봐요."
    : hold > 0 ? "또렷해요. 그대로 잠깐 들고 있어요"
    : k > 0.25 ? "신호가 가까워져요. 조금씩 더 돌아봐요"
    : live ? "잡음뿐이에요. 폰을 들고 천천히 돌아봐요" : "잡음뿐이에요. 안테나를 천천히 돌려 봐요";
  const problem = live && (real.state === "denied" || real.state === "none") ? real.state : null;

  if ((compass.state === "off" && !locked) || problem) return <div className={s.hunt} data-testid="dogam-signal-hunt">
    {live ? <SenseGate kind="compass" title="잡음이 걷히는 쪽을 찾아요"
      body="무전이 말한 곳에서 신호가 와요. 폰을 들고 천천히 돌면 잡음이 줄어드는 쪽이 있어요. 누르면 폰이 방향 권한을 물어요."
      action="신호 찾기 시작" onAction={begin} onDrawn={onDrawn} problem={problem} />
      : <div className={s.gate}>
        <span className={s.gateIcon} aria-hidden><Radio size={26} /></span>
        <b className={s.gateTitle}>잡음이 걷히는 쪽을 찾아요</b>
        <p className={s.gateBody}>안테나 다이얼을 좌우로 끌어 돌려요. 소리를 켜 두면 잡음이 걷히는 게 들려요.</p>
        <button type="button" className={`${s.btn} ${s.roleBtn}`} onClick={begin} data-sound="confirm">
          <Radio size={18} aria-hidden /> 신호 찾기 시작
        </button>
      </div>}
  </div>;

  return <div className={s.hunt} data-testid="dogam-signal-hunt" data-locked={locked || undefined} data-mode={mode}>
    <div ref={waves} className={s.waves} style={{ "--k": k } as CSSProperties} aria-hidden={live || undefined}
      tabIndex={live ? undefined : 0} aria-label={live ? undefined : "안테나 다이얼. 끌거나 왼쪽 오른쪽 화살표로 돌려요"}>
      <i /><i /><i />
      <svg viewBox="0 0 120 40" className={s.wave}>
        <path d={wavePath(k)} />
      </svg>
      {!live && !locked && <span className={s.dialHint}><MoveHorizontal size={16} aria-hidden /> 끌어서 안테나 돌리기</span>}
    </div>
    <div className={s.bars} role="meter" aria-label="신호 세기" aria-valuemin={0} aria-valuemax={5} aria-valuenow={bars}>
      {[1, 2, 3, 4, 5].map((n) => <i key={n} data-on={n <= bars || undefined} style={{ height: `${10 + n * 6}px` }} />)}
    </div>
    <p className={s.say} role="status">{line}</p>
    {!locked && <div className={s.meter} aria-hidden="true"><i style={{ width: `${Math.round(hold * 100)}%` }} /></div>}
    {locked && <p className={s.note}>찾으면 동료에게 손으로 가리켜 알려 줘요. 길은 건너지 않아요.</p>}
  </div>;
}

/** 신호가 약하면 들쭉날쭉한 잡음, 세지면 고른 물결. */
function wavePath(k: number) {
  let d = "M0 20";
  for (let x = 4; x <= 120; x += 4) {
    const clean = Math.sin(x / 7) * 12 * k;
    const noise = (Math.sin(x * 12.9898) * 43758.5453 % 1) * 26 * (1 - k);
    d += ` L${x} ${(20 - clean - noise / 2).toFixed(1)}`;
  }
  return d;
}
