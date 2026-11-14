"use client";
// 지휘관 깃발 작전의 깃발 판(hh 2026-11-08). 카메라 화면 위에(그림으로 하면 그린 풍경 위에) 목표 쪽 깃발이 떠 있다.
// 폰을 돌려(그림이면 화면을 끌어) 깃발을 가운데 줄에 맞추고 잠깐 들고 있으면 길 위에 꽂힌다.
// 판마다 깃발 수, 가운데 줄의 좁기, 한 곳에 쓰는 시간이 다르다. 방향은 공개된 장소 방향이다(정답 아님).
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { play } from "@/lib/sound";
import { angleDiff, FIELD_BEARING } from "@/lib/field-sense";
import { SenseGate } from "./sense-gate";
import { buzz, saveDogamPhoto, type SenseMode, snapVideo, useCamera, useDialHeading, useDogamPhoto, useDragTurn, useHeading } from "./use-field-sense";
import s from "./dogam.module.css";

export type FlagTarget = { label: string; bearing: number; meters: number; tol: number; hold: number };

/** 세로로 든 폰 뒤 카메라의 가로 화각(대략). 화면 가운데 68%에 ±26°를 놓는다(깃발이 테두리에 잘리지 않게). */
const FOV = 52;
const K = 34 / (FOV / 2);
const xFor = (d: number) => 50 + d * K;
const BLUE = "#2867b2";

function FlagMark({ near, small }: { near?: boolean; small?: boolean }) {
  return <svg viewBox="0 0 60 120" className={s.flagMark} data-near={near || undefined} data-small={small || undefined} aria-hidden="true">
    <path d="M14 6 V116" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    <path d="M14 6 V116" stroke="#22302a" strokeWidth="3" strokeLinecap="round" />
    <path className={s.flagCloth} d="M16 8 h38 l-10 12 10 12 h-38z" fill={BLUE} stroke="#fff" strokeWidth="2" />
    <ellipse cx="14" cy="116" rx="9" ry="3" fill="rgba(0,0,0,.35)" />
  </svg>;
}

/** 찍은 장면 가운데에 꽂은 깃발을 그려 넣는다. */
function drawFlag(c: CanvasRenderingContext2D, w: number, h: number) {
  const k = h / 420, x = w / 2, top = h * 0.3, bottom = h * 0.62;
  c.lineCap = "round";
  c.strokeStyle = "#fff"; c.lineWidth = 7 * k; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
  c.strokeStyle = "#22302a"; c.lineWidth = 4 * k; c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
  c.fillStyle = BLUE; c.strokeStyle = "#fff"; c.lineWidth = 2.5 * k;
  c.beginPath(); c.moveTo(x + 2 * k, top); c.lineTo(x + 52 * k, top); c.lineTo(x + 38 * k, top + 16 * k);
  c.lineTo(x + 52 * k, top + 32 * k); c.lineTo(x + 2 * k, top + 32 * k); c.closePath(); c.fill(); c.stroke();
}

/** 위쪽 방위 띠(북·동·남·서와 15°마다 눈금). */
function HeadingTape({ heading }: { heading: number }) {
  const ticks: { d: number; label?: string }[] = [];
  const first = Math.ceil((heading - 60) / 15) * 15;
  for (let b = first; b <= heading + 60; b += 15) {
    const n = ((b % 360) + 360) % 360;
    ticks.push({ d: angleDiff(n, heading), label: ({ 0: "북", 90: "동", 180: "남", 270: "서" } as Record<number, string>)[n] });
  }
  return <div className={s.tape} aria-hidden="true">
    {ticks.map((t) => <i key={t.d.toFixed(1)} style={{ left: `${xFor(t.d)}%` }} data-label={t.label}>{t.label}</i>)}
  </div>;
}

/** 그림으로 할 때의 정문 둘레 풍경(대략의 방향만 맞춘 예시 그림). 이름은 깃발 이름표가 맡는다. */
const SCENERY = [
  { key: "hall", bearing: FIELD_BEARING.hall },
  { key: "park", bearing: FIELD_BEARING.park },
  { key: "bloom", bearing: FIELD_BEARING.bloom },
];
function Scenery({ heading }: { heading: number }) {
  return <div className={s.scenery} aria-hidden="true">
    {SCENERY.map((p) => {
      const x = xFor(angleDiff(p.bearing, heading));
      if (x < -20 || x > 120) return null;
      return <div key={p.key} className={s.scene} data-kind={p.key} style={{ left: `${x}%` }}>
        {p.key === "hall" && <svg viewBox="0 0 120 90"><path d="M50 90 L58 52 H62 L70 90Z" fill="#9b958a" />
          <rect x="6" y="30" width="108" height="34" fill="#8e3f31" /><rect x="50" y="18" width="20" height="46" fill="#7b352a" /></svg>}
        {p.key === "park" && <svg viewBox="0 0 120 90"><circle cx="30" cy="44" r="20" fill="#5f8a58" /><circle cx="58" cy="36" r="24" fill="#4f7a4a" />
          <circle cx="90" cy="46" r="18" fill="#628d5a" /><rect x="52" y="58" width="16" height="26" fill="#a9a293" /></svg>}
        {p.key === "bloom" && <svg viewBox="0 0 120 90"><rect x="58" y="40" width="4" height="46" fill="#7a7a74" />
          <ellipse cx="60" cy="34" rx="16" ry="12" fill="#c98d6f" /></svg>}
      </div>;
    })}
    {/* 용봉관 쪽 곧은 길 */}
    {(() => { const x = xFor(angleDiff(FIELD_BEARING.hall, heading)); return x > -60 && x < 160
      ? <div className={s.road} style={{ "--x": `${x}%` } as CSSProperties} /> : null; })()}
  </div>;
}

export function FlagRun({ targets, limitMs, mode, onDone, onDrawn, photoKey, reduce, gate }: {
  targets: FlagTarget[]; limitMs?: number; mode: SenseMode; onDone: () => void; onDrawn: () => void;
  photoKey?: string; reduce: boolean; gate: { title: string; body: string };
}) {
  const live = mode === "live";
  const cam = useCamera();
  const real = useHeading();
  const dial = useDialHeading(targets[0] ? targets[0].bearing + 140 : 300);
  const compass = live ? real : dial;
  const box = useRef<HTMLDivElement>(null);
  const photo = useDogamPhoto(photoKey ?? "");
  const [idx, setIdx] = useState(0);
  const [hold, setHold] = useState(0);
  const [left, setLeft] = useState(1);
  const [missed, setMissed] = useState(false);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const { live: liveHeading } = compass;
  const aiming = compass.state === "on" && !done;
  const target = targets[idx];
  useDragTurn(box, dial.turn, !live && aiming);

  // 그림으로 할 때는 판이 열리면 바로 시작한다(권한이 없다)
  const dialStart = dial.start;
  useEffect(() => { if (!live) void dialStart(); }, [live, dialStart]);

  const plant = useRef(() => {});
  plant.current = () => {
    if (done) return;
    // 첫 깃발은 그 장면을 찍어 이 폰의 기록 사진으로 남긴다(올리지 않는다)
    if (idx === 0 && photoKey) {
      const v = cam.video.current, el = box.current;
      if (live && v && el && cam.state === "on") {
        const shot = snapVideo(v, { width: el.clientWidth, height: el.clientHeight });
        const c = shot?.getContext("2d");
        if (shot && c) { drawFlag(c, shot.width, shot.height); saveDogamPhoto(photoKey, shot.toDataURL("image/jpeg", 0.82)); shot.width = 0; }
      }
    }
    setHold(0);
    if (idx + 1 < targets.length) {
      play("dial-tick"); buzz(30);
      setIdx(idx + 1); setLeft(1);
      return;
    }
    setIdx(targets.length);
    cam.close(); compass.stop();
    setDone(true); play("stop-open"); buzz([30, 60, 30]);
    window.setTimeout(() => onDoneRef.current(), reduce ? 150 : 900);
  };

  useEffect(() => {
    if (!aiming || !target) return;
    let since = 0, t0 = performance.now(), shown = 1;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (limitMs) {
        const rest = Math.max(0, 1 - (now - t0) / limitMs);
        if (Math.abs(rest - shown) > 0.02 || rest === 0) { shown = rest; setLeft(rest); }
        if (rest === 0) {
          // 시간이 지나면 이 깃발만 다시(앞에 꽂은 깃발은 그대로)
          t0 = now; since = 0; setHold(0); setMissed(true); buzz(80); play("dial-tick");
          window.setTimeout(() => setMissed(false), 1600);
          return;
        }
      }
      const h = liveHeading.current;
      if (h == null) return;
      if (Math.abs(angleDiff(target.bearing, h)) < target.tol) {
        since ||= now;
        const p = Math.min(1, (now - since) / target.hold);
        setHold(p);
        if (p >= 1) { window.clearInterval(timer); plant.current(); }
      } else if (since) { since = 0; setHold(0); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [aiming, target, limitMs, liveHeading]);

  const begin = () => {
    // 나침반 권한을 먼저(누른 순간에) 묻고, 카메라도 같은 순간에 연다
    void real.start();
    void cam.open();
  };
  const problem = live ? (real.state === "denied" || real.state === "none" ? real.state : cam.state === "paused" ? "paused" : null) : null;
  const h = compass.heading;
  const d = h == null || !target ? null : angleDiff(target.bearing, h);
  const near = d != null && target != null && Math.abs(d) < target.tol;
  // 깃발 이름표가 테두리에 잘리지 않게 가운데 60% 안에서만 깃발을 띄우고, 밖이면 가장자리 화살표로 알린다
  const off = d != null && Math.abs(xFor(d) - 50) > 30;
  const line = done ? (targets.length > 1 ? `깃발 ${targets.length}개를 다 꽂았어요` : `깃발을 꽂았어요 · ${targets[0].label}까지 ${targets[0].meters}m`)
    : missed ? "시간이 지났어요. 이 깃발부터 다시 해요"
    : d == null ? "방향을 읽는 중이에요"
    : near ? "여기예요. 그대로 잠깐 들고 있어요"
    : off ? (d > 0 ? "오른쪽으로 더 돌아요" : "왼쪽으로 더 돌아요")
    : "깃발을 가운데 줄에 맞춰요";
  // 가운데 줄의 너비로 지금 깃발이 얼마나 좁은지 보여 준다
  const band = target ? Math.max(6, target.tol * 2 * K) : 0;

  return <>
    <div ref={box} className={`${s.liveBox} ${s.flagBox}`} data-testid="field-flag-run" data-mode={mode} data-cam={cam.state}
      data-done={done || undefined} tabIndex={live ? undefined : 0}
      aria-label={live ? undefined : "풍경 화면. 끌거나 왼쪽 오른쪽 화살표로 돌려요"}>
      {live ? <video ref={cam.attach} className={s.liveVideo} playsInline muted autoPlay aria-label="뒤 카메라 화면" />
        : h != null && <Scenery heading={h} />}
      {compass.state !== "off" && !problem && h != null && <>
        <HeadingTape heading={h} />
        {targets.length > 1 && <span className={s.flagCount}>깃발 {Math.min(idx + 1, targets.length)}/{targets.length}</span>}
        {limitMs && !done && <div className={s.timeBar} data-low={left < 0.3 || undefined} aria-hidden><i style={{ width: `${left * 100}%` }} /></div>}
        {!done && <i className={s.centerBand} style={{ width: `${band}%` }} aria-hidden />}
        {targets.slice(0, idx).map((t) => {
          const x = xFor(angleDiff(t.bearing, h));
          return x > 16 && x < 84 ? <div key={t.label} className={s.flagAt} data-planted style={{ left: `${x}%` }}>
            <FlagMark small /><span className={s.flagTag}>{t.label}</span>
          </div> : null;
        })}
        {target && d != null && off && <div className={s.edgeHint} data-side={d > 0 ? "right" : "left"} aria-hidden>
          {d > 0 ? <><span>{target.label}</span><ChevronRight size={22} /></> : <><ChevronLeft size={22} /><span>{target.label}</span></>}
        </div>}
        {target && d != null && !off && <div className={s.flagAt} style={{ left: `${xFor(d)}%` }}>
          <FlagMark near={near} />
          <span className={s.flagTag}>{target.label} {target.meters}m</span>
          {near && <svg className={s.holdRing} viewBox="0 0 40 40" aria-hidden><circle cx="20" cy="20" r="16" strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - hold)} /></svg>}
        </div>}
        <span className={s.flagChip} role="status" data-miss={missed || undefined}>{line}</span>
        {live && cam.state !== "on" && cam.state !== "opening" && <span className={s.noCam}>카메라 없이 나침반만 써요</span>}
      </>}
      {done && live && photo && <img className={s.liveShot} src={photo} alt={`${targets[0].label} 쪽 길 위에 꽂은 깃발 사진`} />}
      {done && <span className={s.flagChip} role="status">{line}</span>}
      {live && !done && (real.state === "off" || problem) && <SenseGate kind={problem && problem !== "paused" ? "compass" : "both"} dark
        title={gate.title} body={gate.body} action="카메라·나침반 켜기" onAction={begin} onDrawn={onDrawn} problem={problem}
        busy={real.state === "asking"} />}
    </div>
    {aiming && <button type="button" className={`${s.btn} ${s.roleBtn}`} disabled={!near} onClick={() => plant.current()}>
      깃발 꽂기
    </button>}
    {aiming && live && <p className={s.note}>값이 튀면 폰으로 공중에 8자를 두어 번 그려 나침반을 맞춰요.</p>}
  </>;
}
