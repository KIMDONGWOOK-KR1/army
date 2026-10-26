"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Camera, CameraOff, Check, Compass, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { ROLES, ROLE_NAMES, type Role } from "@/supabase/functions/_shared/types";
import type { PhotoGateReply, UnavailableReason } from "@/lib/scout-photo/contract";
import { scoutPhotoMission as mission } from "@/lib/scout-photo/fixture";
import { createMockPhotoGateClient, type ChoiceOutcome, type PhotoOutcome } from "@/lib/scout-photo/mock";
import { captureFrame, stopStream } from "@/lib/scout-photo/capture";
import { ROLE_COLORS } from "./role-style";
import styles from "./scout-photo-preview.module.css";

// 정찰원 사진 미션(G-02) 개발용 미리보기: 개인 단서 → 촬영 → 미리보기 → 판정 → 객관식 → 완료.
// 판정은 모의 어댑터가 정하고, 사진은 이 기기 밖으로 나가지 않는다.
type Pane = "clue" | "camera" | "preview" | "judging" | "choice" | "done";
type Notice = { tone: "retry" | "pass" | "error" | "ok"; text: string } | null;

export function ScoutPhotoPreview() {
  const client = useMemo(() => createMockPhotoGateClient({ mission, delayMs: 900 }), []);
  const [role, setRole] = useState<Role>("scout");
  const [photoOutcome, setPhotoOutcome] = useState<PhotoOutcome>("match");
  const [choiceOutcome, setChoiceOutcome] = useState<ChoiceOutcome>("accepted");
  const [pane, setPane] = useState<Pane>("clue");
  const [state, setState] = useState(client.getState());
  const [notice, setNotice] = useState<Notice>(null);
  const [cameraError, setCameraError] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  // 서버 오류 뒤 다시 보낼 때는 같은 요청 ID를 쓴다
  const pending = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => { client.setPhotoOutcome(photoOutcome); }, [client, photoOutcome]);
  useEffect(() => { client.setChoiceOutcome(choiceOutcome); }, [client, choiceOutcome]);
  // 사진 주소는 바뀌거나 화면을 떠날 때 해제한다
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => () => stopStream(stream.current), []);

  const closeCamera = () => { stopStream(stream.current); stream.current = null; };
  const openCamera = async () => {
    setCameraError(""); setNotice(null); setPane("camera");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
    } catch {
      setCameraError("카메라를 열 수 없어요. 권한을 허용했는지 확인하거나, 찍을 수 없다면 ‘촬영 불가’를 골라요.");
    }
  };
  const shoot = async () => {
    if (!video.current?.videoWidth) return;
    const blob = await captureFrame(video.current);
    closeCamera();
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setPane("preview");
  };
  const requestId = (key: string) => {
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    return pending.current.id;
  };
  const apply = (reply: PhotoGateReply) => {
    pending.current = null;
    setState(reply.state);
    const r = reply.result;
    if (r.kind === "photo_verified") { setNotice({ tone: "ok", text: "사진 확인 완료! 이제 질문에 답해요." }); setPane("choice"); }
    else if (r.kind === "photo_failed_pass") { setNotice({ tone: "pass", text: `사진 검증 실패 후 통과 · ${r.failureCount}회 실패해 사진 단계만 넘어가요. 질문은 계속 풀어요.` }); setPane("choice"); }
    else if (r.kind === "photo_retry") { setNotice({ tone: "retry", text: `사진이 확인되지 않았어요 (${r.failureCount}/${mission.maxPhotoFailures}). 조형물이 잘 보이게 다시 찍어요.` }); setPane("clue"); }
    else if (r.kind === "choice_rejected") setNotice({ tone: "retry", text: "아직 아니에요. 사진을 떠올리며 다시 골라요." });
    else if (r.kind === "choice_accepted") { setPicked(""); setNotice(null); if (reply.state.completed) setPane("done"); }
  };
  const run = async (key: string, send: (id: string) => Promise<PhotoGateReply>, onErrorPane: Pane) => {
    setBusy(true);
    try {
      const reply = await send(requestId(key));
      if (reply.result.kind === "service_error") { setNotice({ tone: "error", text: "판정 서버에 연결하지 못했어요. 실패 횟수는 그대로예요. 잠시 후 다시 보내요." }); setPane(onErrorPane); }
      else apply(reply);
    } finally { setBusy(false); }
  };
  const submitPhoto = () => {
    if (!photo) return;
    setPane("judging");
    void run(`photo:${photo.url}`, (id) => client.submitPhoto({ requestId: id, stepId: mission.photoStep.id, photo: photo.blob }), "preview");
  };
  const unavailable = (reason: UnavailableReason) => {
    closeCamera();
    void run(`na:${state.photo.failureCount}:${reason}`, (id) => client.reportUnavailable({ requestId: id, stepId: mission.photoStep.id, reason }), "clue");
  };
  const question = mission.choiceSteps.find((q) => !state.choiceProgress[q.id]);
  const answered = mission.choiceSteps.filter((q) => state.choiceProgress[q.id]).length;
  const reset = () => window.location.reload();

  const isScout = role === "scout";
  const photoLabel = state.photo.status === "verified" ? "사진 확인 완료" : state.photo.status === "failed_pass" ? "사진 검증 실패 후 통과" : `사진 확인 중 · 실패 ${state.photo.failureCount}/${mission.maxPhotoFailures}`;

  return <main id="main-content" className={styles.page} style={{ "--role": ROLE_COLORS.scout } as CSSProperties}>
    <p className={styles.devBanner}>개발용 미리보기 · 사진을 전송하지 않아요 · 판정은 모의 결과예요</p>

    <section className={styles.card} aria-labelledby="scout-photo-title">
      <header className={styles.head}>
        <span className={styles.badge}><Compass size={16} aria-hidden="true" />정찰원 · 개인 단서</span>
        <span className={styles.step}>거점 01 · 정문</span>
      </header>
      <h1 id="scout-photo-title">상징을 찾아 사진으로 남겨요</h1>
      <ol className={styles.track} aria-label="진행 단계">
        <li data-state={state.photo.status === "pending" ? "current" : state.photo.status === "failed_pass" ? "passed" : "done"}>{state.photo.status === "failed_pass" ? "사진 넘김" : "사진"}</li>
        <li data-state={state.photo.status === "pending" ? "next" : state.completed ? "done" : "current"}>질문 {answered}/{mission.choiceSteps.length}</li>
        <li data-state={state.completed ? "current" : "next"}>보고</li>
      </ol>

      {!isScout ? <p className={styles.hidden} role="note">정찰원의 개인 단서예요. {ROLE_NAMES[role]}의 기기에는 보이지 않아요. 정찰원이 찾은 내용은 말로 들어요.</p> : <>
        {notice && <p className={styles.notice} data-tone={notice.tone} role="status">{notice.tone === "ok" ? <Check size={18} aria-hidden="true" /> : notice.tone === "pass" ? <ArrowRight size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}{notice.text}</p>}

        {pane === "clue" && <>
          <figure className={styles.clue}>
            <span className={styles.sticker} aria-hidden="true">{mission.clue.symbol}</span>
            <figcaption><b>{mission.clue.label}</b><span>{mission.clue.text}</span></figcaption>
          </figure>
          <p className={styles.guide}>{mission.photoStep.guide}</p>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy} onClick={() => void openCamera()}><Camera size={20} aria-hidden="true" />조형물 찍으러 가기</button>
            <UnavailableButtons busy={busy} onPick={unavailable} />
          </div>
        </>}

        {pane === "camera" && <>
          <div className={styles.viewfinder}>
            <video ref={video} playsInline muted aria-label="카메라 화면" />
            <span className={styles.frame} aria-hidden="true" />
            {cameraError && <p className={styles.cameraError} role="alert"><CameraOff size={18} aria-hidden="true" />{cameraError}</p>}
          </div>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={!!cameraError} onClick={() => void shoot()}><Camera size={20} aria-hidden="true" />찰칵, 찍기</button>
            <button className={styles.secondary} onClick={() => { closeCamera(); setPane("clue"); }}>단서로 돌아가기</button>
            <UnavailableButtons busy={busy} onPick={unavailable} />
          </div>
        </>}

        {(pane === "preview" || pane === "judging") && photo && <>
          <div className={styles.viewfinder}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 이 기기 메모리의 사진 미리보기 */}
            <img src={photo.url} alt="방금 찍은 조형물 사진" />
            {pane === "judging" && <p className={styles.judging} role="status" aria-live="polite"><span aria-hidden="true" />사진을 살펴보는 중…</p>}
          </div>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy} onClick={submitPhoto}><Send size={18} aria-hidden="true" />이 사진으로 확인</button>
            <button className={styles.secondary} disabled={busy} onClick={() => void openCamera()}><RotateCcw size={18} aria-hidden="true" />다시 찍기</button>
          </div>
        </>}

        {pane === "choice" && question && <fieldset className={styles.choice} disabled={busy}>
          <legend><span className={styles.photoState} data-status={state.photo.status}>{photoLabel}</span>{question.prompt}</legend>
          {question.choices.map((c, i) => <label key={c} data-picked={picked === String(i + 1)}>
            <input type="radio" name={question.id} value={i + 1} checked={picked === String(i + 1)} onChange={() => setPicked(String(i + 1))} />
            <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>{c}
          </label>)}
          <button className={styles.primary} disabled={!picked || busy} onClick={() => void run(`choice:${question.id}:${picked}:${answered}`, (id) => client.submitChoice({ requestId: id, stepId: question.id, answer: picked }), "choice")}>답 고르기<ArrowRight size={18} aria-hidden="true" /></button>
        </fieldset>}

        {pane === "done" && <div className={styles.done}>
          <span className={styles.doneSeal} aria-hidden="true"><Check size={30} /></span>
          <h2>정찰원의 조사를 마쳤어요</h2>
          <dl>
            <div><dt>사진</dt><dd data-status={state.photo.status}>{photoLabel}</dd></div>
            <div><dt>질문</dt><dd>{answered}/{mission.choiceSteps.length} 완료</dd></div>
          </dl>
          <p>미리보기는 여기까지예요. 실제 게임에서는 이어서 조사 보고를 하고, 지휘관에게 내 숫자를 말로 전해요.</p>
          <button className={styles.secondary} onClick={reset}><RotateCcw size={18} aria-hidden="true" />처음부터 다시</button>
        </div>}
      </>}
    </section>

    <details className={styles.dev} open>
      <summary>개발 도구 · 모의 결과 고르기</summary>
      <label>보는 사람<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></label>
      <label>사진 판정<select value={photoOutcome} onChange={(e) => setPhotoOutcome(e.target.value as PhotoOutcome)}><option value="match">확인됨 (match)</option><option value="no_match">확인 안 됨 (no_match)</option><option value="service_error">서버 오류 (service_error)</option></select></label>
      <label>객관식<select value={choiceOutcome} onChange={(e) => setChoiceOutcome(e.target.value as ChoiceOutcome)}><option value="accepted">수락</option><option value="rejected">거절</option></select></label>
      <p>상태는 이 탭의 메모리에만 있어요. 새로고침하면 처음으로 돌아가요.</p>
    </details>
  </main>;
}

function UnavailableButtons({ busy, onPick }: { busy: boolean; onPick: (r: UnavailableReason) => void }) {
  return <details className={styles.unavailable}>
    <summary>사진을 찍을 수 없나요?</summary>
    <p>찍지 못한 경우도 실패 횟수에 들어가요. {mission.maxPhotoFailures}번이면 사진 단계만 넘어가고 질문은 계속 풀어요.</p>
    <div>
      <button className={styles.secondary} disabled={busy} onClick={() => onPick("camera_unavailable")}>카메라를 쓸 수 없어요</button>
      <button className={styles.secondary} disabled={busy} onClick={() => onPick("photography_prohibited")}>촬영이 금지된 곳이에요</button>
    </div>
  </details>;
}
