"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Compass, ImageIcon, RotateCcw } from "lucide-react";
import type { PhotoGateClient, PhotoGateReply, PhotoUnavailableReason, ScoutPhotoMission } from "@/lib/scout-photo/contract";
import { scoutPhotoMission } from "@/lib/scout-photo/fixture";
import { createMockPhotoGateClient } from "@/lib/scout-photo/mock";
import { capturePhoto, stopPhotoStream } from "@/lib/scout-photo/capture";

type RetryIntent =
  | { kind: "photo"; requestId: string; photo: Blob }
  | { kind: "unavailable"; requestId: string; reason: PhotoUnavailableReason }
  | { kind: "choice"; requestId: string; stepId: string; answer: string };

/** FE may restyle this view; grading and counters always come from the client adapter. */
export function ScoutPhotoMissionView({ mission, client }: { mission: ScoutPhotoMission; client: PhotoGateClient }) {
  const [reply, setReply] = useState<PhotoGateReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [openingCamera, setOpeningCamera] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState<RetryIntent | null>(null);
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState<PhotoUnavailableReason>("camera_unavailable");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const cameraGeneration = useRef(0);
  const alive = useRef(true);
  const busyLock = useRef(false);

  function closeCamera() {
    cameraGeneration.current += 1;
    stopPhotoStream(stream.current);
    stream.current = null;
    setCameraOn(false);
    setOpeningCamera(false);
  }

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    client.getState().then((initial) => { if (!cancelled) setReply(initial); }).catch(() => {
      if (!cancelled) setMessage("미션을 불러오지 못했습니다. 페이지를 다시 열어 주세요.");
    });
    return () => {
      cancelled = true;
      alive.current = false;
      cameraGeneration.current += 1;
      request.current?.abort();
      stopPhotoStream(stream.current);
      stream.current = null;
    };
  }, [client]);

  useEffect(() => {
    if (!photo) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const suspendCamera = () => { if (document.hidden) closeCamera(); };
    const leavePage = () => {
      closeCamera();
      request.current?.abort();
      setPhoto(null);
      setRetry(null);
    };
    document.addEventListener("visibilitychange", suspendCamera);
    window.addEventListener("pagehide", leavePage);
    return () => {
      document.removeEventListener("visibilitychange", suspendCamera);
      window.removeEventListener("pagehide", leavePage);
    };
  }, []);

  async function openCamera() {
    if (busyLock.current) return;
    closeCamera();
    const generation = ++cameraGeneration.current;
    setPhoto(null);
    setRetry(null);
    setShowUnavailable(false);
    setMessage("");
    setOpeningCamera(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다. 촬영 불가를 선택할 수도 있습니다.");
      }
      const opened = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } },
      });
      if (!alive.current || generation !== cameraGeneration.current) { stopPhotoStream(opened); return; }
      stream.current = opened;
      setCameraOn(true);
    } catch (error) {
      if (alive.current && generation === cameraGeneration.current) {
        setMessage(error instanceof Error && error.message.startsWith("카메라는") ? error.message : "카메라를 열지 못했습니다. 권한을 확인하거나 촬영 불가를 선택해 주세요.");
      }
    } finally {
      if (alive.current && generation === cameraGeneration.current) setOpeningCamera(false);
    }
  }

  async function takePhoto() {
    if (!video.current || busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    const generation = cameraGeneration.current;
    try {
      const captured = await capturePhoto(video.current);
      if (!alive.current || generation !== cameraGeneration.current) return;
      setPhoto(captured);
      setRetry(null);
      setMessage("촬영한 사진을 확인한 뒤 제출해 주세요.");
      closeCamera();
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : "촬영에 실패했습니다.");
    } finally {
      busyLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function submit(intent: RetryIntent) {
    if (busyLock.current) return;
    if (intent.kind === "unavailable") closeCamera();
    busyLock.current = true;
    setBusy(true);
    setMessage(intent.kind === "choice" ? "답안을 확인하고 있습니다." : "사진 판정을 기다리고 있습니다.");
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = intent.kind === "photo"
        ? await client.submitPhoto({ requestId: intent.requestId, stepId: mission.photoStep.id, photo: intent.photo }, controller.signal)
        : intent.kind === "unavailable"
          ? await client.reportUnavailable({ requestId: intent.requestId, stepId: mission.photoStep.id, reason: intent.reason }, controller.signal)
          : await client.submitChoice({ requestId: intent.requestId, stepId: intent.stepId, answer: intent.answer }, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setReply(next);
      if (next.state.photo.status !== "pending") closeCamera();
      if (next.result.kind === "error") {
        setMessage(next.result.error.message);
        setRetry(next.result.error.retryable ? intent : null);
        return;
      }
      setRetry(null);
      setPhoto(null);
      setShowUnavailable(false);
      const messages: Record<string, string> = {
        photo_verified: "사진 검증을 통과했습니다. 다음 문제를 풀어 주세요.",
        photo_retry: "검증을 통과하지 못했습니다. 다시 촬영하거나 촬영 불가를 선택해 주세요.",
        photo_failed_pass: "사진 검증 실패 후 통과",
        choice_accepted: "답안을 확인했습니다.",
        choice_rejected: "답안을 다시 확인해 주세요.",
      };
      setMessage(messages[next.result.kind] ?? "상태를 확인했습니다.");
      if (next.result.kind === "choice_accepted") setAnswer("");
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      setRetry(intent);
      setMessage("연결을 처리하지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다.");
    } finally {
      busyLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const state = reply?.state;
  const photoComplete = state && state.photo.status !== "pending";
  const question = mission.choiceSteps.find((step) => !state?.choiceProgress[step.id]);

  return <div className="photo-mission" aria-busy={busy}>
    <section className="photo-card" aria-labelledby="photo-clue-title">
      <span className="photo-eyebrow">정문 · 정찰원 개인 단서</span>
      <h1 id="photo-clue-title">{mission.title}</h1>
      <div className="photo-clue">
        {mission.asset.url ? <img className="photo-sticker-image" src={mission.asset.url} alt={mission.asset.alt} /> : <div className="photo-sticker" role="img" aria-label={mission.asset.alt}>
          <Compass size={60} strokeWidth={1.4} aria-hidden="true" />
          <span>상징 이미지 자리</span>
        </div>}
        <div className="photo-clue-copy"><p className="photo-riddle">{mission.photoStep.prompt}</p><p>{mission.instruction}</p></div>
      </div>
      {!mission.asset.confirmed && <p className="photo-caption">상징 이미지는 준비 중입니다. 실물 사진은 단서로 표시하지 않습니다.</p>}
    </section>

    {!state ? <p role="status">미션을 준비하고 있습니다.</p> : <>
      <ol className="photo-steps" aria-label="미션 진행 순서">
        <li aria-current={!photoComplete ? "step" : undefined}>1. 사진 확인</li>
        <li aria-current={photoComplete && !state.completed ? "step" : undefined}>2. 객관식</li>
        <li aria-current={state.completed ? "step" : undefined}>3. 완료</li>
      </ol>

      {!photoComplete && <section className="photo-card" aria-labelledby="photo-capture-title">
        <div className="photo-section-heading"><h2 id="photo-capture-title">현장에서 직접 촬영</h2><span className="photo-count">실패 {state.photo.failureCount} / 3</span></div>
        <p>사람의 얼굴·명찰·차량번호가 나오지 않게 조형물만 촬영해 주세요.</p>
        <div className="photo-camera-frame">
          {cameraOn ? <>
            <video ref={(element) => { video.current = element; if (element && stream.current && element.srcObject !== stream.current) element.srcObject = stream.current; }} autoPlay muted playsInline aria-label="촬영 중인 카메라" />
            <span className="photo-camera-guide">대상이 화면 안에 들어오게 촬영해 주세요</span>
          </> : previewUrl ? <img src={previewUrl} alt="방금 촬영한 사진 미리보기" /> : <div className="photo-camera-empty"><Camera size={40} aria-hidden="true" /><span>카메라로 대상을 촬영해 주세요</span></div>}
        </div>
        <div className="photo-actions">
          {cameraOn ? <><button type="button" disabled={busy} onClick={takePhoto}>사진 촬영</button><button type="button" className="photo-secondary" disabled={busy} onClick={closeCamera}>카메라 닫기</button></>
            : photo ? <><button type="button" disabled={busy || !!retry} onClick={() => submit({ kind: "photo", requestId: crypto.randomUUID(), photo })}>사진 제출</button><button type="button" className="photo-secondary" disabled={busy} onClick={openCamera}>다시 촬영</button></>
              : <button type="button" disabled={busy || openingCamera || !!retry} onClick={openCamera}>{openingCamera ? "카메라 여는 중…" : "카메라 켜기"}</button>}
          {openingCamera && <button type="button" className="photo-secondary" onClick={closeCamera}>카메라 요청 취소</button>}
          <button type="button" className="photo-secondary" disabled={busy || openingCamera || !!retry} onClick={() => { closeCamera(); setPhoto(null); setShowUnavailable(true); }}>촬영 불가</button>
        </div>
        {showUnavailable && <fieldset className="photo-unavailable" disabled={busy}>
          <legend>촬영할 수 없는 이유</legend>
          <label><input type="radio" name="unavailable-reason" value="camera_unavailable" checked={reason === "camera_unavailable"} onChange={() => setReason("camera_unavailable")} />카메라 오류 또는 권한 문제</label>
          <label><input type="radio" name="unavailable-reason" value="photography_prohibited" checked={reason === "photography_prohibited"} onChange={() => setReason("photography_prohibited")} />촬영 금지 장소</label>
          <p>선택을 제출하면 실패 1회로 기록됩니다. 총 3회가 되면 사진 단계만 통과하고 다음 문제로 이동합니다.</p>
          <button type="button" disabled={busy || !!retry} onClick={() => submit({ kind: "unavailable", requestId: crypto.randomUUID(), reason })}>촬영 불가 제출</button>
        </fieldset>}
        <p className="photo-caption">감점 미확정 · 이 시연에서는 점수를 변경하지 않습니다.</p>
      </section>}

      {photoComplete && <section className="photo-card photo-outcome" data-verified={state.photo.verified} aria-labelledby="photo-outcome-title">
        <h2 id="photo-outcome-title">{state.photo.verified ? "사진 검증 통과" : "사진 검증 실패 후 통과"}</h2>
        <p>{state.photo.verified ? "이제 찾아낸 대상에 관한 문제를 풀어 주세요." : "사진 검증 성공으로 기록되지 않습니다. 다음 객관식 문제를 풀어 주세요."}</p>
      </section>}

      {photoComplete && !state.completed && question && <section className="photo-card" aria-labelledby="photo-choice-title">
        <span className="photo-eyebrow">객관식 · 코스 데이터 예시</span>
        <h2 id="photo-choice-title">{question.title}</h2><p>{question.prompt}</p>
        <fieldset className="photo-choices" disabled={busy || !!retry}>
          <legend className="photo-sr-only">답안 선택</legend>
          {question.choices.map((choice) => <label key={choice.value}><input type="radio" name={question.id} value={choice.value} checked={answer === choice.value} onChange={() => setAnswer(choice.value)} /><span>{choice.label}</span></label>)}
        </fieldset>
        <button type="button" disabled={busy || !answer || !!retry} onClick={() => submit({ kind: "choice", requestId: crypto.randomUUID(), stepId: question.id, answer })}>답안 제출</button>
      </section>}

      {state.completed && <section className="photo-card" aria-labelledby="photo-complete-title"><h2 id="photo-complete-title">개인 미션 시연 완료</h2><p>실제 방의 보고·숫자·자물쇠에는 반영되지 않습니다.</p></section>}
    </>}
    <div className="photo-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</div>
    {retry && <button type="button" disabled={busy} onClick={() => submit(retry)}>같은 요청으로 다시 시도</button>}
  </div>;
}

export default function ScoutPhotoPreview() {
  function newClient() {
    const mock = createMockPhotoGateClient({ delayMs: 700 });
    mock.setPhotoOutcome("match");
    mock.setChoiceOutcome("accepted");
    return mock;
  }
  const [client, setClient] = useState(newClient);
  const [revision, setRevision] = useState(0);
  const [role, setRole] = useState("scout");
  function resetPreview() {
    setClient(newClient());
    setRevision((value) => value + 1);
  }
  return <main id="main-content" className="photo-preview">
    <div className="photo-preview-shell">
      <header className="photo-preview-header"><a href="/">← 첫 화면</a><span>개발용 화면 · 모델 미연결</span></header>
      <aside className="photo-dev-controls" aria-label="개발용 모의 판정 설정">
        <div><ImageIcon size={20} aria-hidden="true" /><strong>정찰원 사진 미션 미리보기</strong></div>
        <p>사진은 이 브라우저 안에서만 처리합니다. 서버 업로드·실제 채점·게임 저장은 하지 않습니다.</p>
        <div className="photo-control-grid" key={revision}>
          <label>미리 볼 역할<select aria-label="미리 볼 역할" value={role} onChange={(event) => { setRole(event.target.value); resetPreview(); }}><option value="scout">정찰원</option><option value="commander">지휘관</option><option value="signal">통신원</option><option value="cipher">암호해독관</option></select></label>
          <label>사진 모의 판정<select aria-label="사진 모의 판정" defaultValue="match" onChange={(event) => client.setPhotoOutcome(event.target.value as "match" | "no_match" | "service_error")}><option value="match">성공</option><option value="no_match">실패</option><option value="service_error">서버 오류</option></select></label>
          <label>객관식 모의 판정<select aria-label="객관식 모의 판정" defaultValue="accepted" onChange={(event) => client.setChoiceOutcome(event.target.value as "accepted" | "rejected")}><option value="accepted">정답 처리</option><option value="rejected">오답 처리</option></select></label>
        </div>
        <button type="button" className="photo-secondary" onClick={resetPreview}><RotateCcw size={16} aria-hidden="true" />시연 처음부터</button>
        <p className="photo-caption">선택지는 정답이 없는 합성 예시입니다. 모의 판정 설정으로 화면 상태만 시험합니다. 새로고침하면 초기화됩니다.</p>
      </aside>
      {role === "scout" ? <ScoutPhotoMissionView key={revision} mission={scoutPhotoMission} client={client} /> : <section className="photo-card"><h1>정찰원 개인 임무</h1><p>이 역할에는 정찰원의 이미지·단서·문항을 표시하지 않습니다.</p><p className="photo-caption">개발 화면의 숨김 시연입니다. 실제 역할 권한 검증은 BE 연결 때 적용합니다.</p></section>}
    </div>
  </main>;
}
