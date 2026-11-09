"use client";
// 정찰원 쌍안경(진짜 카메라): 뒤 카메라 화면에 쌍안경 테두리를 씌우고 두 손가락·배율 단추로 당긴다.
// minZoom배 넘게 당긴 채 잠깐 멈추면 그 장면을 찍는다(사진은 이 폰에만). 판이 올라갈수록 더 당기고 더 오래,
// 더 가만히 있어야 한다(당긴 가운데만 보고 흔들림을 잰다). 무엇을 찍었는지는 판정하지 않는다. 길은 건너지 않는다.
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { play } from "@/lib/sound";
import { SenseGate } from "./sense-gate";
import { buzz, saveDogamPhoto, snapVideo, useCamera, useDogamPhoto, useSteady } from "./use-field-sense";
import s from "./dogam.module.css";

const ZOOMS = [1, 2, 4];
const RING = 2 * Math.PI * 34;

export type ScopeText = { title: string; body: string; find: string; aim: string; alt: string };
const DEFAULT_TEXT: ScopeText = {
  title: "쌍안경을 진짜 카메라로 켜요",
  body: "길 건너편 '피어나다'를 카메라로 당겨 봐요. 찍은 사진은 이 폰의 도감에만 붙어요.",
  find: "길 건너편 꽃 모양 조형물을 찾아 2배 넘게 당겨요",
  aim: "조형물을 가운데 두고 멈추면 찍어요",
  alt: "쌍안경으로 찍은 길 건너편 조형물 사진",
};

export function LiveBinoculars({ found, onFound, onDrawn, photoKey, minZoom = 2, steadyMs = 1200, limit = 5.5, text = DEFAULT_TEXT }: {
  found: boolean; onFound: () => void; onDrawn: () => void; photoKey: string;
  minZoom?: number; steadyMs?: number; limit?: number; text?: ScopeText;
}) {
  const cam = useCamera();
  const box = useRef<HTMLDivElement>(null);
  const photo = useDogamPhoto(photoKey);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const shotRef = useRef(found);
  const on = cam.state === "on";
  const progress = useSteady(cam.video, on && zoom >= minZoom && !shotRef.current, steadyMs, zoom, limit);

  // 쌍안경 두 렌즈 자리(상자 크기에 맞춘다)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight, r = Math.min(H * 0.46, W / 3.7), d = r * 0.78;
      el.style.setProperty("--r", `${r}px`); el.style.setProperty("--c1", `${W / 2 - d}px`); el.style.setProperty("--c2", `${W / 2 + d}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 두 손가락으로 벌려 당기기(끌기는 없다. 폰을 움직여 둘러본다)
  useEffect(() => {
    const el = box.current;
    if (!el || !on) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { d: number; z: number } | null = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const down = (e: PointerEvent) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) start = { d: dist(), z: zoomRef.current }; };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start) setZoom(Math.round(Math.max(1, Math.min(4, start.z * dist() / start.d)) * 10) / 10);
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) start = null; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
    };
  }, [on]);

  const shoot = () => {
    const v = cam.video.current, el = box.current;
    if (!v || !el || shotRef.current) return;
    const canvas = snapVideo(v, { width: el.clientWidth, height: el.clientHeight }, zoomRef.current);
    if (!canvas) return;
    shotRef.current = true;
    saveDogamPhoto(photoKey, canvas.toDataURL("image/jpeg", 0.82));
    canvas.width = 0;
    cam.close();
    play("stop-open"); buzz(25);
    onFound();
  };
  const shootRef = useRef(shoot);
  shootRef.current = shoot;
  useEffect(() => { if (progress >= 1) shootRef.current(); }, [progress]);

  const shot = found || shotRef.current;
  const hint = shot ? "찰칵, 찍었어요"
    : zoom < minZoom ? text.find
    : progress > 0 ? "그대로 잠깐 멈춰요" : text.aim;
  const problem = cam.state === "denied" || cam.state === "none" || cam.state === "insecure" || cam.state === "paused" ? cam.state : null;

  return <>
    <div ref={box} className={`${s.bino} ${s.liveBox}`} data-testid="dogam-live-binoculars" data-shot={shot || undefined}>
      <div className={s.binoView}>
        {shot && photo ? <img className={s.liveShot} src={photo} alt={text.alt} />
          : <video ref={cam.attach} className={s.liveVideo} playsInline muted autoPlay aria-label="뒤 카메라 화면"
            style={{ transform: `scale(${zoom})` }} />}
        <div className={s.shade} />
      </div>
      {on && !shot && <svg className={s.aim} viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="34" className={s.aimTrack} />
        <circle cx="40" cy="40" r="34" className={s.aimFill} strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
      </svg>}
      {(on || shot) && <span className={s.pill}>{shot ? "찰칵" : `${zoom}×`}</span>}
      {(on || shot) && <span className={s.binoHint} role="status">{hint}</span>}
      {!on && !shot && <SenseGate kind="camera" dark title={text.title} body={text.body}
        action="카메라 켜기" onAction={() => void cam.open()} onDrawn={onDrawn} problem={problem} busy={cam.state === "opening"} />}
      {shot && !photo && <span className={s.liveDone}>찾았어요</span>}
    </div>
    {on && !shot && <>
      <div className={s.zooms} role="group" aria-label="배율">
        {ZOOMS.map((z) => <button key={z} type="button" className={s.zbtn} aria-pressed={Math.abs(zoom - z) < 0.15}
          onClick={() => setZoom(z)}>{z}×</button>)}
        <button type="button" className={`${s.zbtn} ${s.shutter}`} disabled={zoom < minZoom} onClick={shoot} aria-label="지금 찍기">
          <Camera size={18} aria-hidden /> 찍기
        </button>
      </div>
      <p className={s.note}>길은 건너지 않아도 돼요. 이쪽 인도에서 당겨 봐요.</p>
    </>}
  </>;
}
