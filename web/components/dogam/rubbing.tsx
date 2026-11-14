"use client";
// 암호해독관 탁본: 표지석에 댄 종이를 손가락으로 문지르면 새긴 글자가 하얗게 떠오른다.
// 숫자 자리는 닳아서 탁본에 안 나온다. 숫자는 표지석을 직접 보고 읽는다(답은 서버가 확인).
import { useEffect, useRef, useState } from "react";
import { play, staticNoise, type StaticHandle } from "@/lib/sound";
import s from "./dogam.module.css";

const NEED = 0.46;
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동이 없는 기기 */ } };

export function Rubbing({ done, onDone, reduce }: { done: boolean; onDone: () => void; reduce: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const finishRef = useRef<() => void>(() => {});
  const [touched, setTouched] = useState(done);
  const [progress, setProgress] = useState(done ? 1 : 0);
  const [finished, setFinished] = useState(done);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext("2d");
    if (!ctx) return;
    let W = 0, H = 0, dpr = 1, over = done, drawing = false, lastPt: { x: number; y: number } | null = null, lastCheck = 0;
    let big = 60, mid = 30, x0 = 0, lw = 0, gap = 44, y1 = 0, y2 = 0;
    let worn: { x: number; y: number; r: number; a: number }[] = [];
    let hiss: StaticHandle | null = null, quiet = 0;
    const rand = (seed: number) => { let v = seed; return () => { v = (v * 16807) % 2147483647; return (v - 1) / 2147483646; }; };
    function plan() {
      big = Math.min(64, W * 0.19); mid = Math.min(32, W * 0.095); y1 = H * 0.3; y2 = H * 0.58;
      ctx!.font = `700 ${mid}px "Noto Serif KR", serif`;
      lw = ctx!.measureText("사적지 제").width; const rw = ctx!.measureText("호").width; gap = mid * 1.5;
      x0 = W / 2 - (lw + gap + rw) / 2;
      const rnd = rand(7), gx = x0 + lw + gap / 2; worn = [];
      for (let i = 0; i < 70; i++)
        worn.push({ x: gx + (rnd() - 0.5) * gap * 0.62, y: y2 + (rnd() - 0.5) * mid * 0.95, r: 1.2 + rnd() * 2.8, a: 0.3 + rnd() * 0.5 });
    }
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); plan();
    }
    // 새긴 글자 자리는 먹이 묻지 않아 종이색(하얗게)으로 남는다
    function carve() {
      const c = ctx!;
      c.save(); c.globalCompositeOperation = "destination-out"; c.fillStyle = "#000"; c.strokeStyle = "#000"; c.textBaseline = "middle";
      c.textAlign = "center"; c.font = `700 ${big}px "Noto Serif KR", serif`; c.fillText("5·18", W / 2, y1);
      c.textAlign = "left"; c.font = `700 ${mid}px "Noto Serif KR", serif`; c.fillText("사적지 제", x0, y2); c.fillText("호", x0 + lw + gap, y2);
      for (const [w, y] of [[0.62, 0.77], [0.62, 0.84], [0.4, 0.91]]) {
        c.beginPath(); const bw = W * w, bx = W / 2 - bw / 2, by = H * y - 2;
        if (c.roundRect) c.roundRect(bx, by, bw, 4, 2); else c.rect(bx, by, bw, 4);
        c.fill();
      }
      c.lineWidth = 3; c.strokeRect(9.5, 9.5, W - 19, H - 19);
      for (const p of worn) { c.globalAlpha = p.a; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    function dab(x: number, y: number) {
      const R = 20, g = ctx!.createRadialGradient(x, y, 2, x, y, R);
      g.addColorStop(0, "rgba(34,35,38,.30)"); g.addColorStop(1, "rgba(34,35,38,0)");
      ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(x, y, R, 0, Math.PI * 2); ctx!.fill();
    }
    function strokeTo(p: { x: number; y: number }) {
      if (!lastPt) { dab(p.x, p.y); lastPt = p; return; }
      const dx = p.x - lastPt.x, dy = p.y - lastPt.y, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 5));
      for (let i = 1; i <= steps; i++) dab(lastPt.x + dx * i / steps, lastPt.y + dy * i / steps);
      lastPt = p;
    }
    const local = (e: PointerEvent) => { const rc = cv.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; };
    function coverage() {
      const d = ctx!.getImageData(0, 0, cv.width, cv.height).data; let hit = 0, tot = 0;
      for (let y = 0; y < cv.height; y += 8) for (let x = 0; x < cv.width; x += 8) { tot++; if (d[(y * cv.width + x) * 4 + 3] > 70) hit++; }
      return tot ? hit / tot : 0;
    }
    const quietDown = () => { hiss?.stop(); hiss = null; };
    function finish() {
      if (over) return; over = true; drawing = false; quietDown();
      setProgress(1); setTouched(true);
      let i = 0;
      const after = () => { setFinished(true); play("stop-open"); buzz(25); onDoneRef.current(); };
      const step = () => { ctx!.fillStyle = "rgba(34,35,38,.13)"; ctx!.fillRect(0, 0, W, H); carve(); if (++i < 10) requestAnimationFrame(step); else after(); };
      if (reduce) { ctx!.fillStyle = "rgba(34,35,38,.75)"; ctx!.fillRect(0, 0, W, H); carve(); after(); } else requestAnimationFrame(step);
    }
    finishRef.current = finish;
    const down = (e: PointerEvent) => {
      if (over) return;
      cv.setPointerCapture(e.pointerId); drawing = true; lastPt = null; setTouched(true);
      strokeTo(local(e)); carve();
    };
    const move = (e: PointerEvent) => {
      if (!drawing || over) return;
      const evs = e.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [e]) strokeTo(local(ev));
      carve();
      // 문지르는 동안만 종이 긁는 소리(잡음)를 낮게 깐다
      if (!hiss) { hiss = staticNoise(); hiss.setSignal(0.7); }
      window.clearTimeout(quiet); quiet = window.setTimeout(quietDown, 140);
      const now = performance.now();
      if (now - lastCheck > 160) {
        lastCheck = now;
        const c = coverage();
        setProgress(Math.min(1, c / NEED));
        if (c >= NEED) finish();
      }
    };
    const up = () => { drawing = false; lastPt = null; quietDown(); };
    size();
    if (done) { ctx.fillStyle = "rgba(34,35,38,.75)"; ctx.fillRect(0, 0, W, H); carve(); }
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    // 글꼴이 늦게 오면 글자 자리를 다시 잰다
    document.fonts?.load(`700 ${mid}px "Noto Serif KR"`).then(() => { if (!over && !lastPt) plan(); }).catch(() => {});
    return () => {
      window.clearTimeout(quiet); quietDown();
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up);
    };
    // done은 처음 그릴 때만 본다(문지른 종이를 다시 그리지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return <>
    <div className={s.rub}>
      <canvas ref={canvas} className={s.rubCanvas} data-testid="dogam-rubbing" aria-label="탁본 종이. 문지르면 글자가 떠요" />
      <div className={s.rubHint} style={{ opacity: touched ? 0 : 1 }}><span>여기를 문질러요</span></div>
    </div>
    <div className={s.meter} aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
    {!finished && <button type="button" className={`${s.btn} ${s.ghost} ${s.small}`} onClick={() => finishRef.current()}>
      문지르기 어려우면 한 번에 뜨기
    </button>}
  </>;
}
