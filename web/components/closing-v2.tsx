"use client";
import { isStoryB, STORY_B, STORY_B_JOINT_HINTS } from "@/lib/narration";
import { composeRecordSentence } from "@/supabase/functions/_shared/record-sentence";
import { plain } from "@/lib/practice-text";
import { useEffect, useState } from "react";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import { ROLE_NAMES, ROLES, type Command } from "@/supabase/functions/_shared/types";
import styles from "./closing-v2.module.css";
import { NextStageAction } from "./yongbong-panel";
import { StorySentence } from "./story-sentence";

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
  const [hintLevel, setHintLevel] = useState(0);
  // A remote edit never silently changes the version of an unsent local draft.
  const [version, setVersion] = useState(draft?.draft_version ?? 0);
  const story = !memorial && isStoryB(snapshot.course);
  const composedText = template?.sentenceParts ? composeRecordSentence(template.sentenceParts, words, "______") : undefined;
  const ready = game.report_mask.every(Boolean) && (memorial || game.retro_mask?.every(Boolean));
  const closed = game.site_phase === "cleared" || game.status === "done";
  if (!template || !self.role) return null;
  const edit = () => {
    setText(draft?.text ?? ""); setReason(draft?.reason ?? "");
    setWords(draft?.words ?? Array<string>(template.wordCount).fill(""));
    setVersion(draft?.draft_version ?? 0); setEditing(true);
  };
  return <section className={`${styles.card} ${story ? styles.jointPaper : ""}`} data-testid={memorial ? "memorial-record" : "joint-record"}>
    {story && <span className={styles.chapter}>마지막 장 · 우리의 문장</span>}
    <h3>{memorial ? "추모의 벽 공동 기록" : "봉지 공동 기록"}</h3>
    <p>개인 본문은 본인에게만 보인다. 이 공동 문장과 근거는 팀 전체가 읽는다.</p>
    {draft ? <>
      <p>기록 버전 {draft.draft_version}</p>
      <p>{draft.words.map(plain).join(" · ")}</p>
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
        draft_version: version, words, text: composedText ?? text, reason });
      if (next) setEditing(false);
    }}>
      <p>{plain(template.prompt)}</p>
      {isStoryB(snapshot.course) && <div>
        {STORY_B_JOINT_HINTS.slice(0, hintLevel).map((hint, i) => <p key={i}>{i + 1}단계 힌트: {hint}</p>)}
        {hintLevel < 3 && <button className="button secondary" type="button" onClick={() => setHintLevel(hintLevel + 1)}>공동 기록 {hintLevel + 1}단계 힌트</button>}
      </div>}
      {version !== (draft?.draft_version ?? 0) && <p role="alert">기록이 바뀌었다. 작성을 취소하고 최신 내용을 다시 열어라.</p>}
      {story ? <StorySentence words={words} choices={template.wordChoices} onChange={setWords} disabled={busy || version !== (draft?.draft_version ?? 0)} /> : words.map((w, i) => <label className={styles.field} key={i}><span>낱말 {i + 1}</span>
        <select aria-label={`낱말 ${i + 1}`} required value={w} onChange={(e) => setWords(words.map((v, n) => n === i ? e.target.value : v))}>
          <option value="">선택</option>{template.wordChoices.map((v) => <option key={v} value={v}>{plain(v)}</option>)}
        </select></label>)}
      {composedText ? <div className={styles.composed}><span>함께 남길 문장</span><p data-testid="joint-preview" aria-label="공동 문장 미리보기" aria-live="polite">{composedText}</p><p>고른 낱말이 문장에 이어집니다. 정해진 조합은 없어요.</p></div>
        : <label className={styles.field}><span>공동 문장</span><textarea aria-label="공동 문장" required maxLength={600} value={text} onChange={(e) => setText(e.target.value)} /></label>}
      <label className={styles.field}><span>공동 근거</span><textarea aria-label="공동 근거" required maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <p>내용이 바뀌면 기존 확인은 초기화된다.</p>
      <button className="button primary" disabled={busy || version !== (draft?.draft_version ?? 0) || words.some((w) => !w)}>공동 기록 저장</button>
      <button type="button" className="button secondary" onClick={() => setEditing(false)}>작성 취소</button>
    </form>}
  </section>;
}

export function RetroPanel(props: Props) {
  const { snapshot: s, busy, send } = props;
  const [text, setText] = useState(s.self.retro ?? "");
  const [editing, setEditing] = useState(!s.self.retro);
  const [openRecord, setOpenRecord] = useState<string | undefined>(s.game.acquired_sites[0]?.id);
  const story = isStoryB(s.course);
  return <div className={`${styles.stack} ${story ? styles.storyClosing : ""}`}>
    {story && <ol className={styles.chapterSteps} aria-label="마지막 기록 순서"><li data-complete={!!s.self.retro}>내 말 남기기</li><li data-complete={!!s.self.joint_record}>팀 문장 만들기</li><li data-complete={s.self.joint_record?.confirm_mask.every(Boolean)}>함께 동의하기</li></ol>}
    {isStoryB(s.course) && <section className={styles.card} data-testid="three-records"><h3>함께 모은 세 장의 사초</h3>
      <p>한 장씩 펼쳐 오늘 걸어온 길을 떠올려보세요.</p>
      <div className={styles.recordShelf}>{s.game.acquired_sites.map((site, i) => <article key={site.id}>
        <button type="button" aria-expanded={openRecord === site.id} aria-controls={`collected-${site.id}`} onClick={() => setOpenRecord(openRecord === site.id ? undefined : site.id)}>
          <span aria-hidden>{site.sacho.char || ["始", "證", "憶"][i]}</span><strong>{site.sacho.name}</strong><small>{openRecord === site.id ? "접기 −" : "펼치기 +"}</small>
        </button><p id={`collected-${site.id}`} hidden={openRecord !== site.id}>{site.sacho.body}</p>
      </article>)}</div>
      <p>{STORY_B.retroGuide}</p></section>}
    <section className={`${styles.card} ${story ? styles.personalPaper : ""}`} data-testid="personal-retro">
      <h3>내 회고</h3><p className={story ? styles.retroQuestion : undefined}>{plain(s.self.mission?.steps[0]?.prompt)}</p>
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
  // 상자 없이 한 줄로: 출발(또는 기다림 안내) 옆에 '조용히 머무르기'를 작게 둔다
  return <div className={styles.depart}>
    {paused ? <p role="status">잠시 머무르는 중이다. 원할 때 이동 준비를 하라.</p> : <NextStageAction {...props} />}
    <button className="button secondary" onClick={() => setPaused(!paused)}>{paused ? "지금 이동 준비" : "조용히 머무르기"}</button>
  </div>;
}

export function ResultV2({ snapshot: s }: { snapshot: V2Response }) {
  const result = s.self.result;
  if (!result) return null;
  return <section className={`${styles.result} ${isStoryB(s.course) ? styles.storyResult : ""}`} data-testid="result-v2">
    {isStoryB(s.course) && <div className={styles.resultSeal} aria-hidden>記<span>기록철 완성</span></div>}
    <h1 data-scene-heading tabIndex={-1}>함께 완성한 기록</h1>
    {isStoryB(s.course) && <><p>{STORY_B.finishGuide}</p><details className={styles.resultDetails}><summary>오늘의 기록을 돌아보며</summary><p>{STORY_B.finish}</p></details></>}
    <p className={isStoryB(s.course) ? styles.completedJourney : undefined}>조사 {result.investigation.completed}/{result.investigation.total} · 사초 {result.sacho.completed}/{result.sacho.total}</p>
    {result.stages.map((stage) => <section key={stage.stage_id} className={styles.card}>
      <h2>{stage.name} · {stage.completion}</h2><p>{plain(stage.summary)}</p>
      <p>도착: {stage.arrival_method === "simulated" ? "모의 확인" : "GPS 확인"}{stage.visit_mode === "outdoor" ? " · 외부 대체 조사" : ""}</p>
      {/* 헌화 거점은 조사 통계 대신 국화를 올린 사람만 적는다 */}
      {stage.completion === "헌화 완료" ? <p>국화 {stage.roles.filter((r) => r.reported).length}송이를 함께 올렸다.</p> : <ul>{stage.roles.map((r) => <li key={r.role}>{ROLE_NAMES[r.role]} · 조사 {r.completed}/{r.total} · 보고 {r.reported ? "완료" : "대기"}
        {` · 힌트 ${r.hint_level}단계 · 해설 ${r.explained}건 · 기록 ${r.records}건 · 교차 확인 ${r.cross_checks}건`}
        <br />확인 방식: {r.methods.map((m) => ({ field: "현장", official_digital: "공식 디지털 자료", explained: "해설", simulated: "모의", proxy: "대리 확인" }[m])).join(", ") || "수집하지 않음"}
      </li>)}</ul>}
      {stage.memorial_record && <><blockquote>{stage.memorial_record.text}</blockquote><p>근거: {stage.memorial_record.reason}</p></>}
    </section>)}
    {result.joint_records.map((record) => <section key={record.stage_id} className={styles.card} data-testid="final-joint-record">
      <h2>최종 공동 기록</h2><p>{record.words?.map(plain).join(" · ")}</p><blockquote>{record.text}</blockquote><p>근거: {record.reason}</p>
      <p>회고 {record.retro_mask.filter(Boolean).length}/4 · 동의 {record.confirm_mask?.filter(Boolean).length}/4</p>
    </section>)}
    {s.self.retro && <section className={styles.card}><h2>내 회고</h2><p>{s.self.retro}</p></section>}
    {/* 점수 규칙이 정해지기 전까지 보조 기록 점수는 화면에 적지 않는다(계산은 그대로) */}
    <p>교차 확인은 선행 보고·자료 연결이 있는 문제를 직접 완료한 건수다.</p>
  </section>;
}
