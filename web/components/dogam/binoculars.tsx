"use client";
// 정찰원 쌍안경: 길 건너편 그림을 끌어서 둘러보고, 두 손가락·배율 단추·휠로 당긴다.
// 대상이 렌즈 안에 들어오고 2.4배 넘게 당기면 '찾았어요'. 찾기는 화면 동작일 뿐, 답(꽃잎 수)은 서버가 확인한다.
import { useEffect, useRef, useState } from "react";
import { play } from "@/lib/sound";
import { PANORAMA, Panorama } from "./dogam-art";
import s from "./dogam.module.css";

const ZOOMS = [1, 2, 4];
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동이 없는 기기 */ } };

/** need배 넘게 당겨 대상을 렌즈 안에 두면 찾는다. holdMs가 있으면 그만큼 붙잡고 있어야 한다(다음 판). */
export function Binoculars({ found, onFound, reduce, need = 2.4, holdMs = 0 }: {
  found: boolean; onFound: () => void; reduce: boolean; need?: number; holdMs?: number;
}) {
  const box = useRef<HTMLDivElement>(null), pano = useRef<SVGSVGElement>(null), ring = useRef<HTMLDivElement>(null);
  const control = useRef<{ zoomTo(z: number): void } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hint, setHint] = useState(found ? "찾았어요. 꽃잎을 하나씩 세어 봐요" : "길 건너편을 천천히 둘러봐요");
  const foundRef = useRef(found), onFoundRef = useRef(onFound);
  foundRef.current = found; onFoundRef.current = onFound;

  useEffect(() => {
    const el = box.current!, svg = pano.current!, mark = ring.current!;
    const { width: SW, height: SH, target } = PANORAMA;
    let W = 0, H = 0, k = 1, z = 1, tx = 0, ty = 0, r = 100, c1 = 0, c2 = 0, raf = 0, lastHint = "", lastZoom = 1, holdTimer = 0;
    const say = (text: string) => { if (text !== lastHint) { lastHint = text; setHint(text); } };
    function layout(keep: boolean) {
      const cx = keep ? (W / 2 - tx) / (k * z) : 250, cy = keep ? (H / 2 - ty) / (k * z) : 200;
      W = el.clientWidth; H = el.clientHeight; k = Math.max(W / SW, H / SH);
      r = Math.min(H * 0.46, W / 3.7); const d = r * 0.78; c1 = W / 2 - d; c2 = W / 2 + d;
      el.style.setProperty("--r", `${r}px`); el.style.setProperty("--c1", `${c1}px`); el.style.setProperty("--c2", `${c2}px`);
      tx = W / 2 - cx * k * z; ty = H / 2 - cy * k * z; apply();
    }
    function apply() {
      const sw = SW * k * z, sh = SH * k * z;
      tx = Math.min(0, Math.max(W - sw, tx)); ty = Math.min(0, Math.max(H - sh, ty));
      svg.style.width = `${sw}px`; svg.style.height = `${sh}px`; svg.style.transform = `translate(${tx}px,${ty}px)`;
      const shown = Math.round(z * 10) / 10;
      if (shown !== lastZoom) { lastZoom = shown; setZoom(shown); }
      check();
    }
    function check() {
      const sx = tx + target.x * k * z, sy = ty + target.y * k * z;
      const inside = Math.hypot(sx - c1, sy - H / 2) < r * 0.7 || Math.hypot(sx - c2, sy - H / 2) < r * 0.7;
      const close = inside && z >= need;
      mark.hidden = !close;
      if (close) {
        const size = 66 * k * z;
        Object.assign(mark.style, { left: `${sx}px`, top: `${sy}px`, width: `${size}px`, height: `${size}px` });
      }
      const hit = () => {
        foundRef.current = true; play("stop-open"); buzz(25);
        say("찾았어요");
        onFoundRef.current();
      };
      if (close && !foundRef.current) {
        if (!holdMs) hit();
        else if (!holdTimer) { say("그대로 잠깐 붙잡아요"); holdTimer = window.setTimeout(() => { holdTimer = 0; hit(); }, holdMs); }
      } else if (!foundRef.current) {
        if (holdTimer) { window.clearTimeout(holdTimer); holdTimer = 0; }
        say(z < need - 0.4 ? (inside ? "보여요. 더 당겨 봐요" : "길 건너편을 천천히 둘러봐요") : "조형물을 동그라미 안으로 옮겨요");
      }
    }
    function zoomAt(nz: number, mx: number, my: number) {
      nz = Math.max(1, Math.min(4, nz)); tx = mx - (mx - tx) * (nz / z); ty = my - (my - ty) * (nz / z); z = nz; apply();
    }
    function zoomTo(goal: number) {
      cancelAnimationFrame(raf);
      const from = z, t0 = performance.now(), dur = reduce ? 1 : 260;
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        zoomAt(from + (goal - from) * e, W / 2, H / 2);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    control.current = { zoomTo };
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { x: number; y: number; d: number } | null = null;
    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) pinch = pinchInfo();
      el.dataset.drag = "true"; cancelAnimationFrame(raf);
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY }; pts.set(e.pointerId, cur);
      if (pts.size === 1) { tx += cur.x - prev.x; ty += cur.y - prev.y; apply(); }
      else if (pts.size === 2) {
        const p = pinchInfo();
        if (pinch) {
          const rc = el.getBoundingClientRect();
          tx += p.x - pinch.x; ty += p.y - pinch.y; zoomAt(z * p.d / pinch.d, p.x - rc.left, p.y - rc.top);
        }
        pinch = p;
      }
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) delete el.dataset.drag; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const rc = el.getBoundingClientRect();
      zoomAt(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - rc.left, e.clientY - rc.top);
    };
    const key = (e: KeyboardEvent) => {
      const m = ({ ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] } as Record<string, number[]>)[e.key];
      if (m) { tx += m[0]; ty += m[1]; apply(); e.preventDefault(); }
      if (e.key === "+" || e.key === "=") { zoomTo(Math.min(4, z * 1.5)); e.preventDefault(); }
      if (e.key === "-") { zoomTo(Math.max(1, z / 1.5)); e.preventDefault(); }
    };
    const resize = () => layout(true);
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    layout(false);
    return () => {
      cancelAnimationFrame(raf); control.current = null; window.clearTimeout(holdTimer);
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel); el.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
    };
  }, [reduce, need, holdMs]);

  return <>
    <div ref={box} className={s.bino} tabIndex={0} data-testid="dogam-binoculars"
      aria-label="쌍안경 화면. 화살표 키로 둘러보고 + − 키로 당겨요">
      <div className={s.binoView}>
        <svg ref={pano} className={s.pano} viewBox={`0 0 ${PANORAMA.width} ${PANORAMA.height}`} aria-hidden="true" focusable="false"><Panorama /></svg>
        <div className={s.shade} />
      </div>
      <div ref={ring} className={s.ring} hidden />
      <span className={s.pill}>{zoom}×</span>
      <span className={s.binoHint} role="status">{hint}</span>
    </div>
    <div className={s.zooms} role="group" aria-label="배율">
      {ZOOMS.map((z) => <button key={z} type="button" className={s.zbtn} aria-pressed={Math.abs(zoom - z) < 0.15}
        onClick={() => control.current?.zoomTo(z)}>{z}×</button>)}
    </div>
  </>;
}
