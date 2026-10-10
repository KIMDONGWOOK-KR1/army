"use client";
import { useEffect, useState } from "react";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import { ROLE_NAMES, ROLES, type Command } from "@/supabase/functions/_shared/types";
import styles from "./closing-v2.module.css";
import { NextStageAction } from "./yongbong-panel";

type Props = { snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null> };

export function SharedDraftPanel({ snapshot, busy, send }: Props) {
  const { self, game, stage } = snapshot;
  const memorial = stage.completion.type === "confirm";
  const draft = memorial ? self.memorial_record : self.joint_record;
  const template = stage.recordTemplate;
  const [text, setText] = useState(draft?.text ?? "");
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [words, setWords] = useState(draft?.words ?? Array<string>(template?.wordCount ?? 3).fill(""));
  const [editing, setEditing] = useState(false);
  // A remote edit never silently changes the version of an unsent local draft.
  const [version, setVersion] = useState(draft?.draft_version ?? 0);
  const ready = game.report_mask.every(Boolean) && (memorial || game.retro_mask?.every(Boolean));
  const closed = game.site_phase === "cleared" || game.status === "done";
  if (!template || !self.role) return null;
  const edit = () => {
    setText(draft?.text ?? ""); setReason(draft?.reason ?? "");
    setWords(draft?.words ?? Array<string>(template.wordCount).fill(""));
    setVersion(draft?.draft_version ?? 0); setEditing(true);
  };
  return <section className={styles.card} data-testid={memorial ? "memorial-record" : "joint-record"}>
    <h3>{memorial ? "추모의 벽 공동 기록" : "봉지 공동 기록"}</h3>
    <p>개인 본문은 본인에게만 보인다. 이 공동 문장과 근거는 팀 전체가 읽는다.</p>
    {draft ? <>
      <p>기록 버전 {draft.draft_version}</p>
      <p>{draft.words.join(" · ")}</p>
      <blockquote>{draft.text}</blockquote><p>근거: {draft.reason}</p>
      <ul>{ROLES.map((r, i) => <li key={r}>{ROLE_NAMES[r]} · {draft.confirm_mask[i] ? "확인 완료" : "확인 대기"}</li>)}</ul>
      <button className="button primary" disabled={busy || closed || !ready || editing || draft.confirm_mask[ROLES.indexOf(self.role)]}
        onClick={() => void send({ action: memorial ? "confirm-stage" : "consent-joint-record", stage_id: stage.id, draft_version: draft.draft_version })}>
        {stage.completion.type === "confirm" ? stage.completion.labels[self.role] : "공동 기록에 동의"}
      </button>
    </> : <p>{ready ? "지휘관이 공동 문장과 근거를 작성한다." : memorial ? "전원의 조사 보고를 기다리는 중" : "전원의 개인 회고를 기다리는 중"}</p>}
    {!closed && self.role === "commander" && !editing && <button className="button secondary" disabled={busy || !ready} onClick={edit}>
      {draft ? "공동 기록 수정" : "공동 기록 작성"}
    </button>}
    {editing && !closed && <form className={styles.stack} onSubmit={async (event) => {
      event.preventDefault();
      const next = await send({ action: memorial ? "draft-memorial-record" : "draft-joint-record", stage_id: stage.id,
        draft_version: version, words, text, reason });
      if (next) setEditing(false);
    }}>
      <p>{template.prompt}</p>
      {version !== (draft?.draft_version ?? 0) && <p role="alert">기록이 바뀌었다. 작성을 취소하고 최신 내용을 다시 열어라.</p>}
      {words.map((w, i) => <label className={styles.field} key={i}><span>낱말 {i + 1}</span>
        <select aria-label={`낱말 ${i + 1}`} required value={w} onChange={(e) => setWords(words.map((v, n) => n === i ? e.target.value : v))}>
          <option value="">선택</option>{template.wordChoices.map((v) => <option key={v}>{v}</option>)}
        </select></label>)}
      <label className={styles.field}><span>공동 문장</span><textarea aria-label="공동 문장" required maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label className={styles.field}><span>공동 근거</span><textarea aria-label="공동 근거" required maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <p>내용이 바뀌면 기존 확인은 초기화된다.</p>
      <button className="button primary" disabled={busy || version !== (draft?.draft_version ?? 0)}>공동 기록 저장</button>
      <button type="button" className="button secondary" onClick={() => setEditing(false)}>작성 취소</button>
    </form>}
  </section>;
}

export function RetroPanel(props: Props) {
  const { snapshot: s, busy, send } = props;
  const [text, setText] = useState(s.self.retro ?? "");
  const [editing, setEditing] = useState(!s.self.retro);
  return <div className={styles.stack}>
    <section className={styles.card} data-testid="personal-retro">
      <h3>내 회고</h3><p>{s.self.mission?.steps[0]?.prompt}</p>
      <p>정답은 없다. 내 본문은 다른 역할에게 공개되지 않는다. 저장한 내용을 바꾸면 팀 동의가 모두 초기화된다.</p>
      {!editing ? <><p>{s.self.retro}</p><button className="button secondary" disabled={busy}
        onClick={() => { setText(s.self.retro ?? ""); setEditing(true); }}>회고 수정</button></> :
        <form className={styles.stack} onSubmit={async (e) => {
          e.preventDefault();
          if (await send({ action: "submit-retro", stage_id: s.stage.id, text })) setEditing(false);
        }}>
          <label className={styles.field}><span>개인 회고 본문</span><textarea aria-label="개인 회고 본문" required maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <button className="button primary" disabled={busy}>회고 저장</button>
        </form>}
      <ul>{ROLES.map((r, i) => <li key={r}>{ROLE_NAMES[r]} · {s.game.retro_mask?.[i] ? "회고 완료" : "회고 대기"}</li>)}</ul>
    </section>
    <SharedDraftPanel {...props} />
  </div>;
}

/** Optional local pause; never a completion rule or countdown. */
export function MemorialDeparture(props: Props) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!paused) return;
    const timer = setTimeout(() => setPaused(false), 10000);
    return () => clearTimeout(timer);
  }, [paused]);
  if (props.snapshot.stage.kind !== "memorial") return <NextStageAction {...props} />;
  return <section className={styles.card}>
    <p>원하면 조용히 잠시 머무르라. 언제든 이동 준비를 할 수 있다.</p>
    <button className="button secondary" onClick={() => setPaused(!paused)}>{paused ? "지금 이동 준비" : "조용히 머무르기"}</button>
    {paused ? <p role="status">잠시 머무르는 중</p> : <NextStageAction {...props} />}
  </section>;
}

export function ResultV2({ snapshot: s }: { snapshot: V2Response }) {
  const result = s.self.result;
  if (!result) return null;
  return <section className={styles.result} data-testid="result-v2">
    <h1 data-scene-heading tabIndex={-1}>함께 완성한 기록</h1>
    <p>조사 {result.investigation.completed}/{result.investigation.total} · 사초 {result.sacho.completed}/{result.sacho.total}</p>
    {result.stages.map((stage) => <section key={stage.stage_id} className={styles.card}>
      <h2>{stage.name} · {stage.completion}</h2><p>{stage.summary}</p>
      <p>도착: {stage.arrival_method === "simulated" ? "모의 확인" : "GPS 확인"}{stage.visit_mode === "outdoor" ? " · 외부 대체 조사" : ""}</p>
      <ul>{stage.roles.map((r) => <li key={r.role}>{ROLE_NAMES[r.role]} · 조사 {r.completed}/{r.total} · 보고 {r.reported ? "완료" : "대기"}
        {` · 힌트 ${r.hint_level}단계 · 해설 ${r.explained}건 · 기록 ${r.records}건 · 교차 확인 ${r.cross_checks}건`}
        <br />확인 방식: {r.methods.map((m) => ({ field: "현장", official_digital: "공식 디지털 자료", explained: "해설", simulated: "모의", proxy: "대리 확인" }[m])).join(", ") || "없음"}
      </li>)}</ul>
      {stage.memorial_record && <><blockquote>{stage.memorial_record.text}</blockquote><p>근거: {stage.memorial_record.reason}</p></>}
    </section>)}
    {result.joint_records.map((record) => <section key={record.stage_id} className={styles.card} data-testid="final-joint-record">
      <h2>최종 공동 기록</h2><p>{record.words?.join(" · ")}</p><blockquote>{record.text}</blockquote><p>근거: {record.reason}</p>
      <p>회고 {record.retro_mask.filter(Boolean).length}/4 · 동의 {record.confirm_mask?.filter(Boolean).length}/4</p>
    </section>)}
    {s.self.retro && <section className={styles.card}><h2>내 회고</h2><p>{s.self.retro}</p></section>}
    <p>보조 기록 점수: {result.supplementary_score}</p>
    <p>시간 점수와 랭킹은 계산하지 않는다. 교차 확인은 선행 보고·자료 연결이 있는 문제를 직접 완료한 건수다.</p>
  </section>;
}
