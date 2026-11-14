"use client";
// 암호해독관 '기록 닦기'(hh 2026-11-09, 11/8 맛보기에서 고름): 공을 튕겨 먼지 조각을 털면 정문 표지석 그림이 드러난다.
// 그림에는 번호를 그리지 않는다(번호는 다음 판에서 표지석을 직접 보고 읽는 서버 문항). 점수·시간 제한 없음.
import { useEffect, useRef, useState } from "react";
import { play } from "@/lib/sound";
import { buzz } from "./use-field-sense";
import s from "./dogam.module.css";

const W = 360, H = 480, PIC = 300, COLS = 8, ROWS = 6;

/** 정문 곁 둥근 표지석과 청동 불꽃(번호·글자 없이 모양만) */
function drawStone(c: CanvasRenderingContext2D) {
  const sky = c.createLinearGradient(0, 0, 0, PIC);
  sky.addColorStop(0, "#d8ecf5"); sky.addColorStop(0.62, "#eef5ea"); sky.addColorStop(0.62, "#9ccb8e"); sky.addColorStop(1, "#86b878");
  c.fillStyle = sky; c.fillRect(0, 0, W, PIC);
  // 뒤 정문 기둥(멀리)
  c.fillStyle = "#c9c2b0"; c.fillRect(24, 70, 26, 116); c.fillRect(310, 70, 26, 116);
  c.fillStyle = "#b3ab97"; c.fillRect(20, 62, 34, 10); c.fillRect(306, 62, 34, 10);
  // 받침
  c.fillStyle = "#8c8576"; c.beginPath(); c.ellipse(180, 252, 112, 18, 0, 0, Math.PI * 2); c.fill();
  // 둥근 원판 돌(가운데 구멍)
  c.fillStyle = "#6f6a60"; c.beginPath(); c.arc(180, 160, 92, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#7d776b"; c.beginPath(); c.arc(176, 154, 86, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#9cc4d6"; c.beginPath(); c.arc(180, 160, 26, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#5c574e"; c.lineWidth = 4; c.stroke();
  // 청동 불꽃
  const fl = c.createLinearGradient(0, 100, 0, 200);
  fl.addColorStop(0, "#d9a441"); fl.addColorStop(1, "#8a5a22");
  c.fillStyle = fl; c.beginPath();
  c.moveTo(180, 96); c.bezierCurveTo(206, 128, 204, 150, 192, 166); c.bezierCurveTo(198, 150, 188, 140, 182, 134);
  c.bezierCurveTo(184, 152, 170, 158, 170, 172); c.bezierCurveTo(156, 150, 162, 122, 180, 96); c.fill();
  // 앞 작은 판(글자 자리는 줄로만)
  c.fillStyle = "#3d3a34"; c.fillRect(132, 222, 96, 26);
  c.fillStyle = "#a59e8c"; c.fillRect(142, 230, 50, 3); c.fillRect(142, 238, 70, 3);
}

export function DustSweep({ onDone, reduce }: { onDone: () => void; reduce: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pct, setPct] = useState(0);
  const [clear, setClear] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const c = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pic = document.createElement("canvas"); pic.width = W * dpr; pic.height = PIC * dpr;
    const pc = pic.getContext("2d")!; pc.setTransform(dpr, 0, 0, dpr, 0, 0); drawStone(pc);
    const bw = W / COLS, bh = PIC / ROWS;
    const bricks = Array.from({ length: COLS * ROWS }, (_, i) => ({
      x: (i % COLS) * bw, y: Math.floor(i / COLS) * bh, alive: true, shade: 0.85 + ((i * 37) % 15) / 100,
    }));
    const total = bricks.length;
    let cleared = 0, combo = 0, raf = 0, last = 0, launchAt = performance.now() + 900, shake = 0, finished = false;
    const paddle = { x: W / 2, w: 88, y: 440 };
    const ball = { x: W / 2, y: 426, vx: 0, vy: 0, r: 8, stuck: true };
    const parts: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const launch = () => {
      if (!ball.stuck) return;
      ball.stuck = false;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      ball.vx = Math.cos(a) * 300; ball.vy = Math.sin(a) * 300;
    };
    const point = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; };
    const onMove = (e: PointerEvent) => { paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, point(e))); };
    const onDown = (e: PointerEvent) => { onMove(e); launch(); try { cv.setPointerCapture(e.pointerId); } catch { /* 없음 */ } };
    cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerdown", onDown);

    const step = (t: number) => {
      const dt = Math.min(0.033, (t - (last || t)) / 1000); last = t;
      if (ball.stuck && t > launchAt && !finished) launch();
      const speed = 300 + Math.min(cleared, 40) * 3;
      for (let k = 0; k < 3; k++) {
        const h = dt / 3;
        if (ball.stuck) { ball.x = paddle.x; ball.y = paddle.y - 14; continue; }
        const m = Math.hypot(ball.vx, ball.vy) || 1; ball.vx = ball.vx / m * speed; ball.vy = ball.vy / m * speed;
        ball.x += ball.vx * h; ball.y += ball.vy * h;
        if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
        if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
        if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
        if (ball.vy > 0 && ball.y + ball.r >= paddle.y && ball.y < paddle.y + 12 && Math.abs(ball.x - paddle.x) < paddle.w / 2 + ball.r) {
          const off = (ball.x - paddle.x) / (paddle.w / 2), ang = -Math.PI / 2 + off * 1.0;
          ball.vx = Math.cos(ang) * speed; ball.vy = Math.sin(ang) * speed; ball.y = paddle.y - ball.r; combo = 0;
          play("dial-tick");
        }
        if (ball.y > H + 10) { ball.stuck = true; launchAt = t + 700; combo = 0; }
        for (const b of bricks) {
          if (!b.alive) continue;
          const cx = Math.max(b.x, Math.min(ball.x, b.x + bw)), cy = Math.max(b.y, Math.min(ball.y, b.y + bh));
          const dx = ball.x - cx, dy = ball.y - cy;
          if (dx * dx + dy * dy < ball.r * ball.r) {
            if (Math.abs(dx) > Math.abs(dy)) ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
            else ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
            b.alive = false; cleared++; combo++;
            play("lock-tick"); buzz(8);
            if (!reduce) { shake = 3; for (let i = 0; i < 8; i++) parts.push({ x: b.x + bw / 2, y: b.y + bh / 2, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.8) * 140, life: 0.6 }); }
            break;
          }
        }
      }
      for (let j = parts.length - 1; j >= 0; j--) {
        const q = parts[j]; q.life -= dt; q.vy += 400 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.life <= 0) parts.splice(j, 1);
      }
      shake = Math.max(0, shake - dt * 20);
      c.save();
      if (shake) c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      c.fillStyle = "#ede6d3"; c.fillRect(0, 0, W, H);
      c.drawImage(pic, 0, 0, pic.width, pic.height, 0, 0, W, PIC);
      for (const b of bricks) {
        if (!b.alive) continue;
        const g = Math.round(196 * b.shade);
        c.fillStyle = `rgb(${g},${g - 8},${g - 26})`; c.fillRect(b.x + 1, b.y + 1, bw - 2, bh - 2);
        c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(b.x + 5, b.y + 5, 7, 3); c.fillRect(b.x + 24, b.y + 16, 4, 3);
      }
      c.fillStyle = "rgba(150,140,120,0.8)";
      for (const q of parts) { c.globalAlpha = Math.max(0, q.life / 0.6); c.fillRect(q.x, q.y, 3, 3); }
      c.globalAlpha = 1;
      c.fillStyle = "#5e4392"; c.beginPath();
      if (c.roundRect) c.roundRect(paddle.x - paddle.w / 2, paddle.y, paddle.w, 13, 6.5); else c.rect(paddle.x - paddle.w / 2, paddle.y, paddle.w, 13);
      c.fill();
      if (!finished) {
        c.fillStyle = "#7655ad"; c.beginPath(); c.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fffbee"; c.beginPath(); c.arc(ball.x - 2, ball.y - 2, 2.2, 0, Math.PI * 2); c.fill();
      }
      if (ball.stuck && !finished) {
        c.fillStyle = "#263a37"; c.font = "17px Jua, sans-serif"; c.textAlign = "center"; c.fillText("톡 누르면 공이 올라가요", W / 2, 396);
      }
      c.restore();
      setPct(Math.round(cleared / total * 100));
      if (!finished && cleared >= total) {
        finished = true; ball.stuck = true; setClear(true); play("clue-correct"); buzz([20, 40, 20]);
        window.setTimeout(() => doneRef.current(), reduce ? 200 : 1600);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerdown", onDown); };
  }, [reduce]);

  return <div className={s.dust} data-testid="dust-sweep" data-pct={pct}>
    <div className={s.dustBar}><span>먼지 {pct}% 털었어요</span><i style={{ width: `${pct}%` }} aria-hidden /></div>
    <canvas ref={canvas} className={s.dustCanvas}
      aria-label="공을 튕겨 먼지를 털어 내는 판. 아래 받침을 손가락으로 좌우로 끌어요." />
    {clear && <p className={s.dustDone} role="status">표지석이 드러났어요. 이제 진짜 표지석에 새긴 번호를 읽어요.</p>}
    <p className={s.note}>아래 받침을 손가락으로 끌어요. 공을 놓쳐도 다시 올라와요.</p>
  </div>;
}
