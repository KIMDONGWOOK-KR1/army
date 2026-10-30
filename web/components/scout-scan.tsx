"use client";
// 정찰원 '사진으로 찾기'(hh 2026-10-27): 아이폰 '빠른 시작'(새 아이폰으로 옮기기)처럼, 단서를 보고 찾은 대상을
// 카메라 동그라미 안에 맞추고 잠깐 멈추면 알아서 찍어 확인한다. 맞으면 동그라미가 금빛 체크로 바뀌고
// 도장이 기록첩으로 들어간다. 틀릴수록 실루엣이 선명해지고 2번째에는 위치를 알려 준다.
// 3번 틀리면 '사진 검증 실패 후 통과'로 사진 단계만 넘어가고, 뒤 문제와 보고는 그대로 남는다.
// 판정은 PR #17의 모의 판정기다(개발 서버 전용). NEXT_PUBLIC_PHOTO_VERIFY=local이면 로컬 사진 판정 서버가 실제로 판정한다.
// 어둡거나 흔들려 판정하지 못한 사진(다시 찍기)은 실패로 세지 않는다.
import { type RefObject, useEffect, useRef, useState } from "react";
import { BookOpen, Camera, CameraOff, ScanSearch, X } from "lucide-react";
import type { PhotoGateState, PhotoOutcome, PhotoUnavailableReason } from "@/lib/scout-photo/contract";
import { capturePhoto, stopPhotoStream } from "@/lib/scout-photo/capture";
import { requestId } from "@/lib/request-id";
import { scanSession } from "@/lib/scout-photo/session";
import type { ScoutScanSite } from "@/lib/scout-photo/sites";
import styles from "./scout-scan.module.css";

type Intent =
  | { kind: "photo"; requestId: string; photo: Blob }
  | { kind: "unavailable"; requestId: string; reason: PhotoUnavailableReason };

const FOUND_MS = 2600;
// 흔들림 없이 이만큼 멈추면 알아서 찍는다. 작은 화면(40×30)의 밝기 차이로만 보고, 사진을 따로 남기지 않는다.
const STEADY_MS = 1200;
const STEADY_DIFF = 5.5;
const RING = 2 * Math.PI * 40;
// 둥근 받침 위 불꽃(정문 표지석의 청동 불꽃을 단순하게 그린 모양). 실루엣·조준선·빛나는 윤곽에 같이 쓴다.
const FLAME = "M42 10C61 15 70 31 64 47C77 55 86 72 86 92C86 116 70 132 50 132C29 132 14 116 14 94C14 71 31 56 43 45C49 32 47 19 42 10Z";
const TONGUE = "M51 122C40 111 39 94 50 80C60 93 62 110 51 122Z";

export function FlameMark({ variant, className, blur = 0 }: {
  variant: "silhouette" | "outline"; className?: string; blur?: number;
}) {
  return (
    <svg className={className} viewBox="0 0 100 152" aria-hidden="true" focusable="false"
      style={blur ? { filter: `blur(${blur}px)` } : undefined}>
      {variant === "silhouette" ? (
        <>
          <defs>
            <linearGradient id="scan-bronze" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#8b6a4b" />
              <stop offset="1" stopColor="#4b3829" />
            </linearGradient>
          </defs>
          <path d={FLAME} fill="url(#scan-bronze)" />
          <path d={TONGUE} fill="#2f241b" opacity=".45" />
          <ellipse cx="50" cy="143" rx="24" ry="6" fill="#4b3829" />
        </>
      ) : (
        <>
          <path d={FLAME} className={styles.line} />
          <ellipse cx="50" cy="143" rx="24" ry="6" className={styles.line} />
        </>
      )}
    </svg>
  );
}

/** 카메라를 동그라미에 맞춘 채 잠깐 멈추면 onSteady를 부른다. 진행(0~1)을 돌려준다 */
function useSteady(video: RefObject<HTMLVideoElement | null>, active: boolean, onSteady: () => void) {
  const [progress, setProgress] = useState(0);
  const fire = useRef(onSteady);
  fire.current = onSteady;
  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 30;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    const n = 40 * 30, now = new Float32Array(n);
    let prev: Float32Array | null = null, steady = 0, last = 0, raf = 0, done = false;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (done || !v || v.readyState < 2 || !v.videoWidth || (last && t - last < 100)) return;
      const dt = last ? t - last : 0;
      last = t;
      context.drawImage(v, 0, 0, 40, 30);
      const px = context.getImageData(0, 0, 40, 30).data;
      let sum = 0, sq = 0, diff = 0;
      for (let i = 0; i < n; i++) {
        const l = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
        if (prev) diff += Math.abs(l - prev[i]);
        now[i] = l;
        sum += l;
        sq += l * l;
      }
      const mean = sum / n, spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
      // 흔들림이 적고, 너무 어둡거나 밝지 않고, 한 가지 색으로 덮이지 않았을 때만 '멈춤'으로 센다
      const calm = !!prev && diff / n < STEADY_DIFF && mean > 18 && mean < 240 && spread > 8;
      (prev ??= new Float32Array(n)).set(now);
      steady = calm ? steady + dt : 0;
      const next = Math.min(1, steady / STEADY_MS);
      setProgress(Math.round(next * 20) / 20);
      if (next >= 1) {
        done = true;
        fire.current();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
    };
  }, [active, video]);
  return progress;
}

export function ScoutScan({ site, scope, onSettled }: {
  site: ScoutScanSite;
  /** 방·장소 이름표(같은 방의 같은 장소면 실패 횟수와 결과를 이어 간다) */
  scope: string;
  onSettled: (state: PhotoGateState) => void;
}) {
  const session = scanSession(scope, site);
  const [state, setState] = useState<PhotoGateState | null>(session.state);
  const [phase, setPhase] = useState<"clue" | "camera" | "judging" | "found">("clue");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<Intent | null>(null);
  const [opening, setOpening] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reason, setReason] = useState<PhotoUnavailableReason>("camera_unavailable");
  const [outcome, setOutcome] = useState<PhotoOutcome>(session.outcome);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const finder = useRef<HTMLDivElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const progress = useSteady(video, phase === "camera", () => void shoot());

  const closeCamera = () => {
    generation.current += 1;
    stopPhotoStream(stream.current);
    stream.current = null;
    setOpening(false);
  };

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    session.client.getState().then((reply) => {
      if (cancelled) return;
      session.state = reply.state;
      setState(reply.state);
    }).catch(() => undefined);
    const hide = () => { if (document.hidden) { closeCamera(); setPhase((p) => (p === "camera" ? "clue" : p)); } };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelled = true;
      alive.current = false;
      document.removeEventListener("visibilitychange", hide);
      request.current?.abort();
      closeCamera();
    };
  }, [session]);

  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // 카메라를 켜거나 결과가 나오면 동그라미가 화면 가운데 오게 내린다(단서 카드 아래로 밀려 있지 않게)
  useEffect(() => {
    if (phase === "clue") return;
    finder.current?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [phase]);

  const failures = state?.photo.failureCount ?? 0;
  // 틀릴수록 실루엣이 선명해진다(0번: 흐림, 1번: 조금 흐림, 2번: 선명 + 위치 힌트)
  const blur = failures >= 2 ? 0 : failures === 1 ? 2.5 : 7;

  async function openCamera() {
    if (lock.current) return;
    closeCamera();
    const mine = ++generation.current;
    setPhoto(null);
    setRetry(null);
    setUnavailable(false);
    setMessage("");
    setOpening(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("카메라는 https 주소(또는 이 컴퓨터의 localhost)에서만 열려요. 촬영할 수 없으면 아래에서 알려 주세요.");
      const opened = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } },
      });
      if (!alive.current || mine !== generation.current) { stopPhotoStream(opened); return; }
      stream.current = opened;
      setPhase("camera");
    } catch (error) {
      if (alive.current && mine === generation.current)
        setMessage(error instanceof Error && error.message.startsWith("카메라는") ? error.message
          : "카메라를 열지 못했어요. 권한을 확인하거나, 촬영할 수 없으면 아래에서 알려 주세요.");
    } finally {
      if (alive.current && mine === generation.current) setOpening(false);
    }
  }

  // 동그라미에 맞춰 멈추면(또는 '지금 확인'을 누르면) 그 장면을 찍어 바로 확인한다
  async function shoot() {
    if (!video.current || lock.current) return;
    let captured: Blob;
    try {
      captured = await capturePhoto(video.current);
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : "찍지 못했어요. 다시 비춰 주세요.");
      return;
    }
    if (!alive.current) return;
    closeCamera();
    setPhoto(captured);
    void submit({ kind: "photo", requestId: requestId(), photo: captured });
  }

  async function submit(intent: Intent) {
    if (lock.current) return;
    lock.current = true;
    if (intent.kind === "photo") setPhase("judging");
    setMessage(intent.kind === "photo" ? "표지석과 맞는지 확인하는 중…" : "");
    const controller = new AbortController();
    request.current = controller;
    try {
      const reply = intent.kind === "photo"
        ? await session.client.submitPhoto({ requestId: intent.requestId, stepId: `${site.stageId}.scan.photo`, photo: intent.photo }, controller.signal)
        : await session.client.reportUnavailable({ requestId: intent.requestId, stepId: `${site.stageId}.scan.photo`, reason: intent.reason }, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      session.state = reply.state;
      setState(reply.state);
      if (reply.result.kind === "error") {
        setPhase("clue");
        setMessage(reply.result.error.retryable ? "확인 서버에 닿지 못했어요. 같은 사진으로 다시 확인해요." : reply.result.error.message);
        setRetry(reply.result.error.retryable ? intent : null);
        return;
      }
      setRetry(null);
      setUnavailable(false);
      if (reply.result.kind === "photo_verified") {
        setPhase("found");
        setMessage(site.found);
        window.dispatchEvent(new CustomEvent("hoguk:scout-found"));
        const done = reply.state;
        setTimeout(() => { if (alive.current) settled.current(done); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 600 : FOUND_MS);
        return;
      }
      setPhoto(null);
      setPhase("clue");
      if (reply.result.kind === "photo_retake") {
        setMessage("어둡거나 흔들려서 확인하지 못했어요. 실패로 세지 않아요. 표지석 가까이에서 다시 비춰 봐요.");
        return;
      }
      if (reply.result.kind === "photo_failed_pass") {
        setMessage("사진 검증 실패 후 통과");
        settled.current(reply.state);
        return;
      }
      setMessage(reply.state.photo.failureCount >= 2
        ? "조금 달라요. 위치 힌트를 보고 다시 비춰 봐요."
        : "조금 달라요. 실루엣이 선명해졌어요. 다시 비춰 봐요.");
    } catch {
      if (!alive.current || controller.signal.aborted) return;
      setPhase("clue");
      setRetry(intent);
      setMessage("연결이 끊겼어요. 같은 사진으로 다시 확인해요.");
    } finally {
      lock.current = false;
    }
  }

  const judging = phase === "judging";
  const viewing = phase === "camera" || ((judging || phase === "found") && !!photoUrl);
  return (
    <section className={styles.scan} data-phase={phase} data-testid="scout-scan" aria-labelledby="scout-scan-title">
      <div className={styles.head}>
        <h3 id="scout-scan-title"><ScanSearch size={19} aria-hidden="true" /> 사진으로 찾기</h3>
        <span className={styles.count} aria-label={`사진 확인 실패 ${failures}번, 3번이면 사진 없이 넘어가요`}>실패 {failures} / 3</span>
      </div>

      {(phase === "clue" || phase === "camera") && (
        <div className={styles.clue}>
          <FlameMark variant="silhouette" className={styles.silhouette} blur={blur} />
          <div className={styles.clueText}>
            <p className={styles.riddle}>{site.riddle}</p>
            {failures >= 1 && <p className={styles.hint}><b>힌트 1</b>{site.hints[0]}</p>}
            {failures >= 2 && <p className={styles.hint}><b>힌트 2</b>{site.hints[1]}</p>}
          </div>
        </div>
      )}

      {/* 빠른 시작처럼: 밖은 어둡게, 가운데 동그라미에 대상을 맞추면 테두리가 차오르고 다 차면 알아서 확인한다 */}
      {viewing && (
        <div className={styles.viewfinder} data-state={phase} ref={finder}>
          {phase === "camera" ? (
            <video
              ref={(el) => { video.current = el; if (el && stream.current && el.srcObject !== stream.current) el.srcObject = stream.current; }}
              autoPlay muted playsInline aria-label="카메라 화면"
            />
          ) : <img src={photoUrl!} alt="방금 비춘 장면" />}
          <span className={styles.dim} aria-hidden="true" />
          <FlameMark variant="outline" className={styles.guideFlame} />
          <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle cx="50" cy="50" r="40" className={styles.ringTrack} />
            <circle cx="50" cy="50" r="40" className={styles.ringFill}
              style={{ strokeDasharray: RING, strokeDashoffset: phase === "camera" ? RING * (1 - progress) : judging ? RING * 0.7 : 0 }} />
            {phase === "found" && <path d="M36 51l10 10 19-21" className={styles.check} />}
          </svg>
          {phase === "camera" && <span className={styles.cue}>불꽃을 동그라미 안에 맞춰요</span>}
          {phase === "found" && (
            <>
              <span className={styles.stamp} aria-hidden="true">찾음</span>
              <span className={styles.book} aria-hidden="true"><BookOpen size={18} /> 기록첩</span>
            </>
          )}
        </div>
      )}

      <div className={styles.actions}>
        {phase === "camera" ? (
          <>
            <p className={styles.steady} role="status">{progress > 0 ? "그대로… 확인할게요" : "흔들리지 않게 잠깐 멈추면 알아서 확인해요"}</p>
            <button type="button" className="button secondary" onClick={() => void shoot()}>
              지금 확인 <Camera size={16} aria-hidden="true" />
            </button>
            <button type="button" className={styles.textButton} onClick={() => { closeCamera(); setPhase("clue"); }}>
              <X size={15} aria-hidden="true" /> 카메라 닫기
            </button>
          </>
        ) : phase === "clue" ? (
          <>
            {retry?.kind === "photo" ? (
              <button type="button" className="button primary" onClick={() => void submit(retry)}>같은 사진으로 다시 확인</button>
            ) : (
              <button type="button" className="button primary" disabled={opening} onClick={() => void openCamera()}>
                {opening ? "카메라 여는 중…" : failures ? "다시 비추기" : "카메라로 비추기"} <Camera size={17} aria-hidden="true" />
              </button>
            )}
            <button type="button" className={styles.textButton} onClick={() => { setUnavailable(!unavailable); setRetry(null); }}>
              <CameraOff size={15} aria-hidden="true" /> 촬영할 수 없어요
            </button>
          </>
        ) : null}
      </div>

      {unavailable && phase === "clue" && (
        <fieldset className={styles.unavailable}>
          <legend>찍을 수 없는 이유</legend>
          <label><input type="radio" name={`${scope}-reason`} checked={reason === "camera_unavailable"} onChange={() => setReason("camera_unavailable")} /> 카메라가 안 켜지거나 권한이 없어요</label>
          <label><input type="radio" name={`${scope}-reason`} checked={reason === "photography_prohibited"} onChange={() => setReason("photography_prohibited")} /> 촬영할 수 없는 곳이에요</label>
          <p>알려 주면 실패 1번으로 세요. 3번이 되면 사진 없이 문제로 넘어가요.</p>
          <button type="button" className="button secondary" onClick={() => void submit(retry?.kind === "unavailable" ? retry : { kind: "unavailable", requestId: requestId(), reason })}>
            알리기
          </button>
        </fieldset>
      )}

      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <p className={styles.privacy}>사람 얼굴·명찰·차량 번호가 나오지 않게 표지석만 비춰요. 사진은 확인에만 쓰고 남기지 않아요.</p>

      {/* 판정 서버와 잇기 전까지 쓰는 개발용 모의 판정(개발 서버에서만 보인다). 실제 판정을 쓰면 숨긴다 */}
      {session.real ? (
        <p className={styles.privacy} data-testid="scout-scan-real">로컬 사진 판정 서버로 확인해요(개발용 임시 기준).</p>
      ) : <fieldset className={styles.dev} disabled={judging}>
        <legend>시연 판정 · 판정 서버 미연결</legend>
        {([["match", "맞게"], ["no_match", "다르게"], ["retake", "다시 찍기"], ["service_error", "연결 오류"]] as const).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name={`${scope}-outcome`} value={value} checked={outcome === value}
              onChange={() => { setOutcome(value); session.outcome = value; session.client.setPhotoOutcome(value); }} />
            {label}
          </label>
        ))}
      </fieldset>}
    </section>
  );
}

/** 사진 단계를 마친 뒤 문제 위에 남기는 한 줄(성공·실패 후 통과를 구분해 적는다) */
export function ScanResult({ site, state }: { site: ScoutScanSite; state: PhotoGateState }) {
  const verified = state.photo.verified;
  return (
    <div className={styles.result} data-verified={verified} data-testid="scout-scan-result">
      <FlameMark variant="silhouette" className={styles.resultMark} />
      <p>
        <b>{verified ? "사진으로 찾음" : "사진 검증 실패 후 통과"}</b>
        {verified ? `${site.target}. ${site.next}` : "사진 확인은 성공으로 기록되지 않아요. 문제는 그대로 풀어요."}
      </p>
    </div>
  );
}
