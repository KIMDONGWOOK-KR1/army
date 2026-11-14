"use client";
// 암호해독관 둘째 판 '붉은 필름'(hh 2026-11-10, 방탈출의 빨간 셀로판 장치): 붉은 줄로 검열된 편지 위로
// 붉은 필름을 끌어 비추면, 붉은 줄이 사라지고 그 밑에 파란 글씨로 숨긴 낱말이 드러난다.
// 낱말 여섯 개를 다 비춰 모으면 번호 순서대로 한 문장이 된다(정문 곁 둥근 돌, 불꽃 아래 새긴 번호).
// 편지는 게임을 위해 꾸민 것이고, 문장은 다음 판(진짜 표지석 번호 = 금고 번호)으로 가는 길잡이일 뿐 서버 문항의 답이 아니다.
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { play } from "@/lib/sound";
import { buzz } from "./use-field-sense";
import s from "./dogam.module.css";

const W = 320, H = 430, R = 58;
/** 숨긴 낱말: 번호 순서로 읽으면 한 문장 */
const WORDS = [
  { n: 1, text: "정문", x: 236, y: 92 },
  { n: 2, text: "곁", x: 70, y: 168 },
  { n: 3, text: "둥근 돌", x: 196, y: 214 },
  { n: 4, text: "불꽃 아래", x: 96, y: 282 },
  { n: 5, text: "새긴", x: 250, y: 326 },
  { n: 6, text: "번호", x: 128, y: 384 },
];
/** 겉으로 보이는 편지(게임을 위해 꾸민 글) */
const LINES = [
  "어머니께",
  "이곳 날씨는 맑습니다.",
  "학교 앞이 요즘 조금 소란합니다.",
  "그래도 밥은 잘 챙겨 먹고 있어요.",
  "걱정하실 일은 없으니 마음 놓으세요.",
  "동생에게도 안부 전해 주세요.",
  "오월 어느 날, 아들 올림",
];

/** 고정된 씨앗으로 붉은 검열 줄을 그린다(낱말 위에는 촘촘히, 나머지에도 흩뿌려 자리를 숨긴다) */
function scribbles() {
  let x = 20251110;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const line = (cx: number, cy: number, w: number) => {
    const pts: string[] = [];
    let px = cx - w / 2;
    pts.push(`M${px.toFixed(1)} ${(cy + (rnd() - 0.5) * 6).toFixed(1)}`);
    while (px < cx + w / 2) {
      px += 6 + rnd() * 8;
      pts.push(`L${px.toFixed(1)} ${(cy + (rnd() - 0.5) * 14).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const out: string[] = [];
  for (const w of WORDS) for (let i = 0; i < 6; i++) out.push(line(w.x + (rnd() - 0.5) * 10, w.y - 13 + i * 3.6, 18 * w.text.length + 28));
  for (let i = 0; i < 26; i++) out.push(line(30 + rnd() * 260, 70 + rnd() * 340, 40 + rnd() * 70));
  return out;
}

function Letter({ filtered, found }: { filtered: boolean; found: Set<number> }) {
  const paths = useMemo(scribbles, []);
  return <svg viewBox={`0 0 ${W} ${H}`} className={s.rfSvg} aria-hidden>
    <rect width={W} height={H} rx="10" fill={filtered ? "#f4cfc4" : "#fbf5e6"} />
    {Array.from({ length: 12 }, (_, i) => <line key={i} x1="18" x2={W - 18} y1={60 + i * 32} y2={60 + i * 32} stroke={filtered ? "#e8b9ab" : "#e6dcc4"} strokeWidth="1" />)}
    {LINES.map((t, i) => <text key={i} x={i === 6 ? W - 24 : 24} y={50 + i * 56} textAnchor={i === 6 ? "end" : "start"}
      className={s.rfLine} fill={filtered ? "#a4706a" : "#2f2a24"}>{t}</text>)}
    {WORDS.map((w) => <text key={w.n} x={w.x} y={w.y} textAnchor="middle" className={s.rfWord}
      fill={filtered ? "#14213d" : "#a9b7d4"} opacity={filtered ? 1 : 0.42}>{w.text}
      {filtered && <tspan className={s.rfNum} dx="3" dy="-8">{w.n}</tspan>}</text>)}
    {paths.map((d, i) => <path key={i} d={d} fill="none" stroke={filtered ? "#f4cfc4" : "#d8402f"} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity={filtered ? 1 : 0.9} />)}
    {filtered && WORDS.filter((w) => found.has(w.n)).map((w) => <rect key={w.n} x={w.x - (9 * w.text.length + 12)} y={w.y - 22} width={18 * w.text.length + 24} height="30" rx="8"
      fill="none" stroke="#1f6f4d" strokeWidth="2.4" strokeDasharray="5 4" />)}
  </svg>;
}

export function RedFilm({ onDone, reduce }: { onDone: () => void; reduce: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState({ x: W / 2, y: 14 });
  const [moved, setMoved] = useState(false);
  const [found, setFound] = useState<Set<number>>(() => new Set());
  const done = found.size === WORDS.length;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // 렌즈 가운데에 낱말이 0.4초 머물면 모은다. 손가락이 조금씩 떨려도(같은 낱말 위라면) 시간을 다시 재지 않는다.
  const hitWord = done || !moved ? null : WORDS.find((w) => !found.has(w.n) && Math.hypot(w.x - lens.x, w.y - 8 - lens.y) < R * 0.62) ?? null;
  const hitN = hitWord?.n ?? null;
  useEffect(() => {
    if (hitN === null) return;
    const t = window.setTimeout(() => {
      setFound((prev) => {
        if (prev.has(hitN)) return prev;
        const next = new Set(prev); next.add(hitN);
        play(next.size === WORDS.length ? "clue-correct" : "lock-tick"); buzz(next.size === WORDS.length ? [20, 40, 20, 40, 60] : 18);
        return next;
      });
    }, 420);
    return () => window.clearTimeout(t);
  }, [hitN]);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => doneRef.current(), reduce ? 200 : 2600);
    return () => window.clearTimeout(t);
  }, [done, reduce]);

  const toSvg = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    // 손가락에 가리지 않게 렌즈를 손가락보다 조금 위에 둔다
    const lift = e.pointerType === "touch" ? 64 : 0;
    return { x: Math.max(0, Math.min(W, (e.clientX - r.left) / r.width * W)), y: Math.max(0, Math.min(H, (e.clientY - lift - r.top) / r.height * H)) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); setLens(toSvg(e)); setMoved(true); };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (e.buttons || e.pointerType === "touch") setLens(toSvg(e)); };

  const lensStyle = { "--lx": `${lens.x / W * 100}%`, "--ly": `${lens.y / H * 100}%`, "--lr": `${R / W * 100}cqw` } as CSSProperties;
  const ordered = WORDS.filter((w) => found.has(w.n));
  return <div className={s.rf} data-testid="red-film" data-found={found.size} data-done={done || undefined}>
    <div className={s.rfMemo} aria-live="polite">
      <span className={s.rfMemoLabel}>해독 메모 {found.size}/{WORDS.length}</span>
      <ol>{WORDS.map((w) => <li key={w.n} data-on={found.has(w.n) || undefined}>{found.has(w.n) ? w.text : "□"}</li>)}</ol>
      {done && <span className={s.cwStamp} aria-hidden>해독 완료</span>}
    </div>
    <div ref={box} className={s.rfLetter} style={lensStyle} onPointerDown={down} onPointerMove={move}
      role="application" aria-label="검열된 편지. 끌어서 붉은 필름으로 비추면 숨은 낱말이 드러나요">
      <Letter filtered={false} found={found} />
      <div className={s.rfFiltered}><Letter filtered found={found} /></div>
      <span className={s.rfLens} aria-hidden />
      {!moved && <span className={s.rfHint} aria-hidden>필름을 끌어 편지를 비춰요</span>}
    </div>
    <p className={s.note} role="status">{done
      ? `숨은 글: ${ordered.map((w) => w.text).join(" ")}. 이 번호가 기록실 금고 번호예요.`
      : "붉은 줄 밑에 파란 글씨가 숨어 있어요. 필름을 낱말 위에 잠깐 멈추면 해독 메모에 모여요."}</p>
    <p className={s.rfCredit}>편지는 게임을 위해 꾸민 것이에요.</p>
    {/* 화면 읽기 프로그램용: 끌기 없이도 낱말을 하나씩 모을 수 있다 */}
    <button type="button" className={s.srOnly} onClick={() => { const next = WORDS.find((w) => !found.has(w.n)); setMoved(true); if (next) setLens({ x: next.x, y: next.y - 8 }); }}>
      다음 숨은 낱말 비추기
    </button>
  </div>;
}
