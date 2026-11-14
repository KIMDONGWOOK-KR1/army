"use client";
// 암호해독관 탁본(진짜 카메라): 표지석 글자를 틀에 맞춰 찍으면, 그 사진의 새긴 선은 종이로 남고 평평한 면에만
// 먹이 묻는 탁본 종이가 된다. 손가락으로 문지를수록 먹이 올라 글자가 드러난다. 사진은 이 폰에만 남는다.
// 번호는 탁본(또는 표지석)을 보고 고른다(답은 서버가 확인).
import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { play, staticNoise, type StaticHandle } from "@/lib/sound";
import { rubbingInk } from "@/lib/field-sense";
import { SenseGate } from "./sense-gate";
import { buzz, saveDogamPhoto, snapVideo, useCamera, useDogamPhoto } from "./use-field-sense";
import s from "./dogam.module.css";

const NEED = 0.55;

/** 사진을 탁본 먹 그림(검은 먹 + 투명한 종이 자리)으로 바꾼다. */
function inkSheet(src: HTMLCanvasElement) {
  const w = src.width, h = src.height, ctx = src.getContext("2d");
  if (!ctx) return null;
  const px = ctx.getImageData(0, 0, w, h).data, lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  const ink = rubbingInk(lum, w, h);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const o = out.getContext("2d");
  if (!o) return null;
  const img = o.createImageData(w, h);
  let seed = 11;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 16807) % 2147483647;
    const grain = 0.82 + 0.18 * (seed / 2147483647);
    img.data[i * 4] = 30; img.data[i * 4 + 1] = 31; img.data[i * 4 + 2] = 34;
    img.data[i * 4 + 3] = Math.round(255 * ink[i] * grain);
  }
  o.putImageData(img, 0, 0);
  return out;
}

export function LiveRubbing({ done, onDone, onDrawn, photoKey, reduce }: {
  done: boolean; onDone: () => void; onDrawn: () => void; photoKey: string; reduce: boolean;
}) {
  const cam = useCamera();
  const photo = useDogamPhoto(photoKey);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(done ? 1 : 0);
  const [finished, setFinished] = useState(done);
  const finishRef = useRef<() => void>(() => {});
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const capture = () => {
    const v = cam.video.current;
    if (!v) return;
    // 탁본 종이는 비디오 자리와 같은 크기다(틀 안쪽)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const snap = snapVideo(v, { width: v.clientWidth, height: v.clientHeight }, 1, Math.min(640, Math.round(v.clientWidth * dpr)));
    const ink = snap && inkSheet(snap);
    if (snap) snap.width = 0;
    if (!ink) return;
    cam.close();
    play("dial-tick");
    setSheet(ink);
  };

  // 문지르기: 먹 그림을 손가락 자리만큼 조금씩 옮겨 찍는다
  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx || !sheet) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let over = false, drawing = false, last: { x: number; y: number } | null = null, lastCheck = 0, quiet = 0;
    let hiss: StaticHandle | null = null;
    // 먹이 묻을 자리의 비율(문지른 정도를 이 비율에 견준다)
    const inkShare = (() => {
      const c = sheet.getContext("2d")!, d = c.getImageData(0, 0, sheet.width, sheet.height).data;
      let hit = 0, tot = 0;
      for (let i = 3; i < d.length; i += 4 * 9) { tot++; if (d[i] > 120) hit++; }
      return Math.max(0.2, tot ? hit / tot : 1);
    })();
    const dab = (x: number, y: number) => {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 0.3; ctx.drawImage(sheet, 0, 0, W, H); ctx.restore();
    };
    const strokeTo = (p: { x: number; y: number }) => {
      if (!last) { dab(p.x, p.y); last = p; return; }
      const dx = p.x - last.x, dy = p.y - last.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 7));
      for (let i = 1; i <= n; i++) dab(last.x + dx * i / n, last.y + dy * i / n);
      last = p;
    };
    const coverage = () => {
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let hit = 0, tot = 0;
      for (let y = 0; y < cv.height; y += 8) for (let x = 0; x < cv.width; x += 8) { tot++; if (d[(y * cv.width + x) * 4 + 3] > 60) hit++; }
      return tot ? hit / tot / inkShare : 0;
    };
    const local = (e: PointerEvent) => { const rc = cv.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; };
    const hush = () => { hiss?.stop(); hiss = null; };
    const finish = () => {
      if (over) return;
      over = true; drawing = false; hush(); setProgress(1);
      const after = () => {
        // 도감 칸에 붙일 탁본 사진(종이색 위에 먹)
        const out = document.createElement("canvas");
        out.width = Math.min(520, cv.width); out.height = Math.round(out.width * H / W);
        const o = out.getContext("2d");
        if (o) {
          o.fillStyle = "#f2ede1"; o.fillRect(0, 0, out.width, out.height);
          o.drawImage(cv, 0, 0, out.width, out.height);
          saveDogamPhoto(photoKey, out.toDataURL("image/jpeg", 0.85));
        }
        out.width = 0;
        setFinished(true); play("stop-open"); buzz(25); onDoneRef.current();
      };
      let i = 0;
      const step = () => { ctx.globalAlpha = 0.22; ctx.drawImage(sheet, 0, 0, W, H); ctx.globalAlpha = 1; if (++i < 9) requestAnimationFrame(step); else after(); };
      if (reduce) { ctx.globalAlpha = 0.9; ctx.drawImage(sheet, 0, 0, W, H); ctx.globalAlpha = 1; after(); } else requestAnimationFrame(step);
    };
    finishRef.current = finish;
    const down = (e: PointerEvent) => { if (over) return; cv.setPointerCapture(e.pointerId); drawing = true; last = null; strokeTo(local(e)); };
    const move = (e: PointerEvent) => {
      if (!drawing || over) return;
      const evs = e.getCoalescedEvents?.() ?? [];
      for (const ev of evs.length ? evs : [e]) strokeTo(local(ev));
      if (!hiss) { hiss = staticNoise(); hiss.setSignal(0.7); }
      window.clearTimeout(quiet); quiet = window.setTimeout(hush, 140);
      const now = performance.now();
      if (now - lastCheck > 160) {
        lastCheck = now;
        const c = coverage();
        setProgress(Math.min(1, c / NEED));
        if (c >= NEED) finish();
      }
    };
    const up = () => { drawing = false; last = null; hush(); };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    return () => {
      window.clearTimeout(quiet); hush();
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up);
    };
  }, [sheet, reduce, photoKey]);

  const retake = () => { setSheet(null); setProgress(0); void cam.open(); };
  const on = cam.state === "on";
  const problem = cam.state === "denied" || cam.state === "none" || cam.state === "insecure" || cam.state === "paused" ? cam.state : null;

  if (finished || done) return <div className={`${s.rub} ${s.rubLive}`} data-testid="dogam-live-rubbing" data-done>
    {photo ? <img className={s.rubImg} src={photo} alt="표지석 탁본" /> : <span className={s.liveDone}>탁본을 떴어요</span>}
  </div>;

  return <>
    <div className={`${s.rub} ${s.rubLive}`} data-testid="dogam-live-rubbing">
      {sheet ? <>
        <canvas ref={canvas} className={s.rubCanvas} aria-label="탁본 종이. 문지르면 표지석 글자가 떠요" />
        {progress === 0 && <div className={s.rubHint}><span>여기를 문질러요</span></div>}
      </> : <>
        <video ref={cam.attach} className={s.rubVideo} playsInline muted autoPlay aria-label="뒤 카메라 화면" />
        {on && <div className={s.rubGuide} aria-hidden><span>표지석 글자를 틀에 맞춰요</span></div>}
        {!on && <SenseGate kind="camera" dark title="진짜 표지석으로 탁본을 떠요"
          body="카메라로 표지석 글자를 찍으면 그 사진이 탁본 종이가 돼요. 사진은 이 폰에만 남아요."
          action="카메라 켜기" onAction={() => void cam.open()} onDrawn={onDrawn} problem={problem} busy={cam.state === "opening"} />}
      </>}
    </div>
    {on && !sheet && <button type="button" className={`${s.btn} ${s.roleBtn}`} onClick={capture} data-sound="none">
      <Camera size={18} aria-hidden /> 이대로 종이 대기
    </button>}
    {sheet && <>
      <div className={s.meter} aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className={s.row2}>
        <button type="button" className={`${s.btn} ${s.ghost} ${s.small}`} onClick={retake}><RotateCcw size={16} aria-hidden /> 다시 찍기</button>
        <button type="button" className={`${s.btn} ${s.ghost} ${s.small}`} onClick={() => finishRef.current()}>한 번에 뜨기</button>
      </div>
    </>}
  </>;
}
