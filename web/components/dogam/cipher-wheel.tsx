"use client";
// 암호해독관 '암호 원판'(hh 2026-11-10): 기록실에서 온 기호 쪽지를 원판을 돌려 푼다.
// 바깥 고리의 기호는 그대로, 안쪽 원판의 글자를 돌려 맞추면 쪽지 아래에 읽은 글자가 바로 뜬다.
// 열쇠는 수수께끼 한 줄('멀리 있는 가족에게 쓰는 글의 첫 글자')이고, 막히면 열쇠를 바로 볼 수 있다.
// 풀린 문장은 다음 판(붉은 필름으로 편지 비추기)을 여는 지시일 뿐, 서버 문항의 답이 아니다. 점수·시간 제한 없음.
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, RotateCcw, RotateCw } from "lucide-react";
import { play } from "@/lib/sound";
import { buzz } from "./use-field-sense";
import s from "./dogam.module.css";

const N = 12, STEP = 360 / N;
/** 안쪽 원판 글자(시계 방향). 풀린 문장의 열두 글자를 섞어 둔다 */
const INNER = ["비", "붉", "로", "지", "은", "라", "필", "를", "편", "으", "춰", "름"];
/** 바깥 고리 기호(고정) */
const OUTER = ["◆", "●", "▲", "■", "♣", "♠", "♥", "☀", "✿", "✚", "◎", "★"];
/** 풀면 나오는 쪽지: 붉은 필름으로 편지를 비춰라(다음 판의 도구) */
const PLAIN = ["붉은", "필름으로", "편지를", "비춰라"];
/** 맞는 돌림(칸). 처음 자리(0)와는 다르다 */
const KEY = 5;
const mod = (n: number) => ((n % N) + N) % N;
const KEY_SYMBOL = OUTER[mod(INNER.indexOf("편") + KEY)];

/** 바깥 기호 j 자리에, 원판을 r칸 돌렸을 때 오는 글자 */
const readAt = (j: number, r: number) => INNER[mod(j - r)];

export function CipherWheel({ onDone, reduce }: { onDone: () => void; reduce: boolean }) {
  const words = useMemo(() => PLAIN.map((w) => [...w].map((ch) => mod(INNER.indexOf(ch) + KEY))), []);
  const [deg, setDeg] = useState(0); // 원판이 돈 각도(끄는 동안은 칸 사이 값도 있다)
  const [dragging, setDragging] = useState(false);
  const [solved, setSolved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [moves, setMoves] = useState(0);
  const r = mod(Math.round(deg / STEP));
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const wheel = useRef<SVGSVGElement>(null);
  const drag = useRef<{ a: number; deg: number; last: number } | null>(null);

  // 몇 번 돌려 봐도 못 찾으면 열쇠 단추를 반짝인다
  const nudgeKey = moves >= 8 && !showKey && !solved;

  useEffect(() => {
    if (solved || dragging || r !== KEY) return;
    setSolved(true); play("clue-correct"); buzz([20, 40, 20, 40, 60]);
  }, [r, dragging, solved]);
  useEffect(() => {
    if (!solved) return;
    const t = window.setTimeout(() => doneRef.current(), reduce ? 200 : 2400);
    return () => window.clearTimeout(t);
  }, [solved, reduce]);

  const turn = (by: number) => {
    if (solved) return;
    setDeg((d) => Math.round(d / STEP) * STEP + by * STEP);
    setMoves((m) => m + 1);
    play("dial-tick"); buzz(8);
  };
  const angleOf = (e: PointerEvent) => {
    const box = wheel.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)) * 180 / Math.PI;
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (solved) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { a: angleOf(e), deg, last: Math.round(deg / STEP) };
    setDragging(true);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    let delta = angleOf(e) - d.a;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    d.a += delta; d.deg += delta;
    setDeg(d.deg);
    const cell = Math.round(d.deg / STEP);
    if (cell !== d.last) { d.last = cell; play("dial-tick"); buzz(6); }
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setDeg((d) => Math.round(d / STEP) * STEP);
    setMoves((m) => m + 1);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); turn(1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); turn(-1); }
  };

  const decoded = words.map((w) => w.map((j) => readAt(j, r)).join(""));
  return <div className={s.cw} data-testid="cipher-wheel" data-solved={solved || undefined} data-turn={r}>
    <section className={s.cwNote} aria-label="기록실 암호 쪽지">
      <p className={s.cwKicker}>기록실 암호 쪽지</p>
      <ol className={s.cwWords}>
        {words.map((w, wi) => <li key={wi}>
          {w.map((j, ci) => <span key={ci} className={s.cwCell} style={{ animationDelay: `${(wi * 2 + ci) * 70}ms` }}>
            <b aria-hidden>{OUTER[j]}</b>
            <i>{readAt(j, r)}</i>
          </span>)}
        </li>)}
      </ol>
      <p className={s.srOnly} aria-live="polite">{solved ? `해독했어요: ${PLAIN.join(" ")}` : `지금 읽히는 글: ${decoded.join(" ")}`}</p>
      <div className={s.cwKey}>
        <KeyRound size={16} aria-hidden />
        {showKey || solved
          ? <span><b>{KEY_SYMBOL}</b> = 편</span>
          : <span><b>{KEY_SYMBOL}</b> 은 멀리 있는 가족에게 쓰는 글의 첫 글자</span>}
        {!showKey && !solved && <button type="button" className={s.cwKeyBtn} data-nudge={nudgeKey || undefined}
          onClick={() => setShowKey(true)}>열쇠 보기</button>}
      </div>
      {solved && <span className={s.cwStamp} aria-hidden>해독 완료</span>}
    </section>

    <div className={s.cwWheelWrap}>
      <svg ref={wheel} className={s.cwWheel} viewBox="-150 -150 300 300" role="slider" tabIndex={solved ? -1 : 0}
        aria-label="암호 원판. 좌우 화살표로 한 칸씩 돌려요" aria-valuemin={0} aria-valuemax={N - 1} aria-valuenow={r}
        aria-valuetext={`${r}칸 돌림, ${KEY_SYMBOL} 자리에 ${readAt(OUTER.indexOf(KEY_SYMBOL), r)}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <circle r="146" className={s.cwOuter} />
        {OUTER.map((sym, j) => {
          const a = (j * STEP - 90) * Math.PI / 180;
          const hot = sym === KEY_SYMBOL && (showKey || solved);
          return <text key={j} x={Math.cos(a) * 128} y={Math.sin(a) * 128} className={s.cwSym} data-hot={hot || undefined}
            textAnchor="middle" dominantBaseline="central">{sym}</text>;
        })}
        <g className={s.cwDisc} style={{ transform: `rotate(${deg}deg)`, transition: dragging || reduce ? "none" : "transform .28s cubic-bezier(.3,1.4,.5,1)" }}>
          <circle r="108" className={s.cwInner} />
          <circle r="40" className={s.cwHub} />
          {INNER.map((ch, i) => {
            const a = (i * STEP - 90) * Math.PI / 180;
            return <g key={i}>
              <line x1={Math.cos(a + Math.PI / N) * 44} y1={Math.sin(a + Math.PI / N) * 44}
                x2={Math.cos(a + Math.PI / N) * 108} y2={Math.sin(a + Math.PI / N) * 108} className={s.cwSpoke} />
              <text x={Math.cos(a) * 86} y={Math.sin(a) * 86} className={s.cwChar} textAnchor="middle" dominantBaseline="central"
                transform={`rotate(${i * STEP} ${Math.cos(a) * 86} ${Math.sin(a) * 86})`}>{ch}</text>
            </g>;
          })}
        </g>
        <text className={s.cwHubText} textAnchor="middle" dominantBaseline="central">{solved ? "풀었다!" : "끌어서"}</text>
      </svg>
    </div>

    <div className={s.cwButtons}>
      <button type="button" className={s.cwTurn} onClick={() => turn(-1)} disabled={solved} aria-label="원판을 왼쪽으로 한 칸">
        <RotateCcw size={18} aria-hidden /> 왼쪽
      </button>
      <button type="button" className={s.cwTurn} onClick={() => turn(1)} disabled={solved} aria-label="원판을 오른쪽으로 한 칸">
        오른쪽 <RotateCw size={18} aria-hidden />
      </button>
    </div>
    <p className={s.note} role="status">{solved
      ? "쪽지를 풀었어요. 붉은 필름으로 편지를 비춰 볼 차례예요."
      : `원판을 돌려 ${KEY_SYMBOL} 자리에 열쇠 글자를 맞춰요. 쪽지가 문장으로 읽히면 풀려요.`}</p>
  </div>;
}
