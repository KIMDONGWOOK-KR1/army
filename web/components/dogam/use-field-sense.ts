"use client";
// 현장 도구의 폰 기능: 뒤 카메라, 나침반, 흔들림 없이 멈춤, 내 폰에만 남는 도감 사진.
// 사진과 카메라 화면은 어디에도 올리지 않는다(이 폰의 탭 안에만 둔다).
import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { stopPhotoStream } from "@/lib/scout-photo/capture";
import { norm360, rearHeading, trueHeading } from "@/lib/field-sense";

export type SenseTool = "binoculars" | "rubbing" | "radio" | "compass";
export type SenseMode = "live" | "drawn";

/** 이 폰에서 진짜 카메라·나침반을 쓸 수 있는지(https·폰 화면). 주소 끝 ?sense=live|drawn 으로 바꿔 볼 수 있다. */
export function senseSupport() {
  if (typeof window === "undefined") return { phone: false, secure: false, camera: false, compass: false, forced: null as SenseMode | null };
  const q = new URLSearchParams(window.location.search).get("sense");
  const forced: SenseMode | null = q === "live" || q === "drawn" ? q : null;
  const secure = window.isSecureContext;
  return {
    phone: matchMedia("(pointer: coarse)").matches,
    secure,
    camera: secure && !!navigator.mediaDevices?.getUserMedia,
    compass: secure && "DeviceOrientationEvent" in window,
    forced,
  };
}

const MODE_KEY = "hoguk:dogam-sense:";
/** 도구마다 진짜 기능으로 할지 그림으로 할지. '그림으로 하기'를 누르면 이 탭에서는 기억한다. */
export function useSenseMode(tool: SenseTool, needs: ("camera" | "compass")[]) {
  const [mode, setMode] = useState<SenseMode | null>(null);
  const [why, setWhy] = useState<"insecure" | "desk" | "picked" | null>(null);
  useEffect(() => {
    const sup = senseSupport();
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(MODE_KEY + tool); } catch { /* 저장소가 막힌 탭 */ }
    const able = needs.some((n) => sup[n]);
    const next: SenseMode = sup.forced ?? (saved === "drawn" ? "drawn" : sup.phone && able ? "live" : "drawn");
    setMode(next);
    setWhy(next === "live" ? null : saved === "drawn" ? "picked" : sup.phone && !sup.secure ? "insecure" : "desk");
    // needs는 도구마다 고정이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  const choose = useCallback((next: SenseMode) => {
    try { sessionStorage.setItem(MODE_KEY + tool, next); } catch { /* 저장소가 막힌 탭 */ }
    setMode(next); setWhy(next === "drawn" ? "picked" : null);
  }, [tool]);
  return { mode, why, choose };
}

export type CamState = "off" | "opening" | "on" | "denied" | "none" | "insecure" | "paused";

/** 뒤 카메라. open()은 단추를 누른 그 순간에 불러야 한다(아이폰 권한 창). 화면을 떠나거나 탭을 숨기면 끈다. */
export function useCamera() {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const gen = useRef(0);
  const [state, setState] = useState<CamState>("off");
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      el.play().catch(() => undefined);
    }
  }, []);
  const close = useCallback((next: CamState = "off") => {
    gen.current += 1;
    stopPhotoStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setState(next);
  }, []);
  const open = useCallback(async () => {
    const mine = ++gen.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setState("insecure"); return false; }
    setState("opening");
    try {
      const got = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      if (mine !== gen.current) { stopPhotoStream(got); return false; }
      stream.current = got;
      if (video.current) { video.current.srcObject = got; video.current.play().catch(() => undefined); }
      setState("on");
      return true;
    } catch (error) {
      if (mine !== gen.current) return false;
      const name = error instanceof DOMException ? error.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none");
      return false;
    }
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden && stream.current) close("paused"); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); close(); };
  }, [close]);
  return { video, attach, state, open, close };
}

export type HeadingState = "off" | "asking" | "on" | "denied" | "none";
type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

/** 나침반(진북 기준, 뒤 카메라가 향하는 쪽). start()는 단추를 누른 그 순간에 불러야 한다(아이폰 권한 창).
 * 값이 2초 안에 안 오면 이 폰은 나침반을 못 쓰는 것으로 본다. */
export function useHeading() {
  const [state, setState] = useState<HeadingState>("off");
  const [heading, setHeading] = useState<number | null>(null);
  const live = useRef<number | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const start = useCallback(() => {
    stopRef.current();
    if (!window.isSecureContext || !("DeviceOrientationEvent" in window)) { setState("none"); return Promise.resolve(false); }
    const Ctor = window.DeviceOrientationEvent as OrientationCtor;
    // 권한 요청은 await 앞에서 바로 불러야 한다(누른 순간을 놓치면 아이폰이 거절한다)
    const asked = Ctor.requestPermission ? Ctor.requestPermission() : Promise.resolve("granted");
    setState("asking");
    return asked.then((answer) => {
      // 아이폰은 granted/denied, 일부 크롬은 prompt를 돌려준다. 거절만 막고, 값이 안 오면 아래 시간 제한이 가른다.
      if (answer === "denied") { setState("denied"); return false; }
      let sx = 0, sy = 0, got = false, last = 0;
      const take = (magnetic: number) => {
        if (!Number.isFinite(magnetic)) return;
        const h = trueHeading(magnetic) * Math.PI / 180;
        // 방위를 단위 벡터로 부드럽게 섞는다(359°↔1° 경계에서 튀지 않게)
        if (!got) { sx = Math.sin(h); sy = Math.cos(h); } else { sx = sx * 0.78 + Math.sin(h) * 0.22; sy = sy * 0.78 + Math.cos(h) * 0.22; }
        got = true;
        const deg = ((Math.atan2(sx, sy) * 180 / Math.PI) + 360) % 360;
        live.current = deg;
        const now = performance.now();
        if (now - last > 70) { last = now; setHeading(deg); }
      };
      const onAbs = (e: DeviceOrientationEvent) => {
        if (e.alpha == null || e.beta == null || e.gamma == null) return;
        take(rearHeading(e.alpha, e.beta, e.gamma));
      };
      const onRel = (e: DeviceOrientationEvent) => {
        const ios = (e as OrientationEventIOS).webkitCompassHeading;
        if (typeof ios === "number" && ios >= 0) take(ios);
        else if (e.absolute && e.alpha != null && e.beta != null && e.gamma != null) take(rearHeading(e.alpha, e.beta, e.gamma));
      };
      const hasAbs = "ondeviceorientationabsolute" in window;
      if (hasAbs) window.addEventListener("deviceorientationabsolute", onAbs as EventListener);
      window.addEventListener("deviceorientation", onRel);
      const wait = window.setTimeout(() => { if (!got) { stopRef.current(); setState("none"); } }, 2200);
      stopRef.current = () => {
        window.clearTimeout(wait);
        if (hasAbs) window.removeEventListener("deviceorientationabsolute", onAbs as EventListener);
        window.removeEventListener("deviceorientation", onRel);
      };
      setState("on");
      return true;
    }).catch(() => { setState("denied"); return false; });
  }, []);
  const stop = useCallback(() => { stopRef.current(); stopRef.current = () => {}; setState("off"); }, []);
  useEffect(() => () => stopRef.current(), []);
  return { state, heading, live, start, stop };
}

/** 그림으로 할 때의 나침반: 화면을 끌거나 화살표 키로 방향을 돌린다. useHeading과 같은 모양으로 돌려준다. */
export function useDialHeading(initial = 300) {
  const [state, setState] = useState<HeadingState>("off");
  const [heading, setHeading] = useState<number | null>(null);
  const live = useRef<number | null>(null);
  const set = useCallback((deg: number) => { const v = norm360(deg); live.current = v; setHeading(v); }, []);
  const start = useCallback(() => { set(live.current ?? initial); setState("on"); return Promise.resolve(true); }, [set, initial]);
  const stop = useCallback(() => setState("off"), []);
  const turn = useCallback((delta: number) => set((live.current ?? initial) + delta), [set, initial]);
  return { state, heading, live, start, stop, turn };
}

/** 끌어서 돌리기: 화면을 오른쪽으로 끌면 왼쪽(반시계)으로 돈다. 왼쪽·오른쪽 화살표는 5°씩. */
export function useDragTurn(el: RefObject<HTMLElement | null>, turn: (delta: number) => void, on: boolean, perPx = 0.32) {
  const turnRef = useRef(turn);
  turnRef.current = turn;
  useEffect(() => {
    const box = el.current;
    if (!box || !on) return;
    let last: number | null = null, id = -1;
    const down = (e: PointerEvent) => { if (last != null) return; id = e.pointerId; last = e.clientX; box.setPointerCapture?.(e.pointerId); };
    const move = (e: PointerEvent) => { if (e.pointerId !== id || last == null) return; turnRef.current(-(e.clientX - last) * perPx); last = e.clientX; };
    const up = (e: PointerEvent) => { if (e.pointerId === id) last = null; };
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { turnRef.current(-5); e.preventDefault(); }
      if (e.key === "ArrowRight") { turnRef.current(5); e.preventDefault(); }
    };
    box.addEventListener("pointerdown", down); box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up); box.addEventListener("keydown", key);
    return () => {
      box.removeEventListener("pointerdown", down); box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up); box.removeEventListener("pointercancel", up); box.removeEventListener("keydown", key);
    };
  }, [el, on, perPx]);
}

// 판 진행: 이 폰에서만 깨는 판(현장 동작)의 깬 수. 서버가 모르는 값이라 이 탭에만 둔다.
const ROUND_KEY = "hoguk:rounds:";
const rounds = new Map<string, number>();
const roundListeners = new Set<() => void>();
function readRounds(key: string) {
  if (!rounds.has(key)) {
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(ROUND_KEY + key)) || 0; } catch { /* 저장소가 막힌 탭 */ }
    rounds.set(key, saved);
  }
  return rounds.get(key) ?? 0;
}
export function saveRounds(key: string, n: number) {
  if (n <= readRounds(key)) return;
  rounds.set(key, n);
  try { sessionStorage.setItem(ROUND_KEY + key, String(n)); } catch { /* 이 화면에서만 */ }
  roundListeners.forEach((fn) => fn());
}
const subscribeRounds = (fn: () => void) => { roundListeners.add(fn); return () => { roundListeners.delete(fn); }; };
export function useRounds(key: string) {
  return useSyncExternalStore(subscribeRounds, () => readRounds(key), () => 0);
}

/** 카메라를 대상에 맞춘 채 흔들림 없이 멈춘 시간(0~1). 작은 화면(40×30)의 밝기 차이만 보고, 사진은 남기지 않는다.
 * zoom배로 당겼으면 보이는 가운데만 본다(당길수록 손떨림이 커 보인다). limit이 작을수록 더 가만히 있어야 한다. */
export function useSteady(video: RefObject<HTMLVideoElement | null>, active: boolean, ms = 1200, zoom = 1, limit = 5.5) {
  const [progress, setProgress] = useState(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!active) { setProgress(0); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 40; canvas.height = 30;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const n = 1200, now = new Float32Array(n);
    let prev: Float32Array | null = null, steady = 0, last = 0, raf = 0, shown = -1;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth || (last && t - last < 100)) return;
      const dt = last ? t - last : 0;
      last = t;
      const z = Math.max(1, zoomRef.current), cw = v.videoWidth / z, ch = v.videoHeight / z;
      ctx.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, 40, 30);
      const px = ctx.getImageData(0, 0, 40, 30).data;
      let sum = 0, diff = 0;
      for (let i = 0; i < n; i++) {
        const l = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
        if (prev) diff += Math.abs(l - prev[i]);
        now[i] = l; sum += l;
      }
      const mean = sum / n;
      const calm = !!prev && diff / n < limit && mean > 14 && mean < 245;
      (prev ??= new Float32Array(n)).set(now);
      steady = calm ? steady + dt : 0;
      const p = Math.round(Math.min(1, steady / ms) * 20) / 20;
      if (p !== shown) { shown = p; setProgress(p); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, video, ms, limit]);
  return progress;
}

/** 비디오의 보이는 부분(object-fit: cover로 잘린 가운데)을 zoom배 당긴 만큼 잘라 작은 JPEG로 만든다. */
export function snapVideo(v: HTMLVideoElement, box: { width: number; height: number }, zoom = 1, maxW = 520) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh || !box.width || !box.height) return null;
  const a = box.width / box.height;
  let w = vw, h = vw / a;
  if (h > vh) { h = vh; w = vh * a; }
  w /= zoom; h /= zoom;
  const out = document.createElement("canvas");
  out.width = Math.round(Math.min(maxW, w)); out.height = Math.round(out.width / a);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(v, (vw - w) / 2, (vh - h) / 2, w, h, 0, 0, out.width, out.height);
  return out;
}

// 도감 사진: 이 폰의 이 탭에만 둔다(올리지 않는다). 새로 고침해도 남게 sessionStorage에도 적어 둔다.
const PHOTO_KEY = "hoguk:dogam-photo:";
const photos = new Map<string, string>();
const listeners = new Set<() => void>();
export function saveDogamPhoto(key: string, url: string) {
  photos.set(key, url);
  try { sessionStorage.setItem(PHOTO_KEY + key, url); } catch { /* 저장소가 막혔거나 꽉 찼으면 이 화면에서만 */ }
  listeners.forEach((fn) => fn());
}
function readPhoto(key: string) {
  if (!photos.has(key)) {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(PHOTO_KEY + key); } catch { /* 저장소가 막힌 탭 */ }
    photos.set(key, saved ?? "");
  }
  return photos.get(key) || null;
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useDogamPhoto(key: string) {
  return useSyncExternalStore(subscribe, () => readPhoto(key), () => null);
}

export const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동이 없는 기기 */ } };
