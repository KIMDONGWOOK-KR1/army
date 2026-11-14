"use client";
// 지휘관 정문 퀴즈(hh 2026-11-09): 듀오링고 같은 짧은 퀘스트 한 판. 객관식 · 순서 맞히기 · 현장 찾기 세 문제.
// 문제 글·선택지·해설은 서버 문항에서 오고, 정답은 서버만 안다(이 화면은 고른 번호만 낸다). 점수는 보이지 않는다.
// 틀리면 그 칸만 흔들리고 다시 고른다. 맞히면 가운데에서 체크와 해설을 보고 '계속하기'로 넘어간다.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, MapPin, RotateCcw, X } from "lucide-react";
import { isV2Response, type GameResponse, type V2Response } from "@/lib/game-snapshot";
import { plain } from "@/lib/practice-text";
import { play } from "@/lib/sound";
import type { Command, Step } from "@/supabase/functions/_shared/types";
import { SlotArt } from "./dogam-art";
import { createPortal } from "react-dom";
import { buzz } from "./use-field-sense";
import { MissionDialog, SuccessMark } from "./mission-dialog";
import { missionText } from "./display-text";
import s from "./dogam.module.css";

type Send = (command: Command) => Promise<GameResponse | null>;
/** 답과 무관한 공개 정보: 현장에서 대상을 찾은 뒤 여는 문항. */
const FIELD_STEP = "G-01.dogam-q4";
const NUMS = ["①", "②", "③", "④", "⑤"];
const JAMO = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ"];
const solved = (status?: string) => status === "done" || status === "explained";

type Feedback = { ok: true; streak: number; retried: boolean } | { ok: false; text: string } | null;

export function QuizRun({ steps, snapshot, busy, send, reduce, onSolved, onDone }: {
  steps: Step[]; snapshot: V2Response; busy: boolean; send: Send; reduce: boolean;
  onSolved: (step: Step) => void; onDone: () => void;
}) {
  const progress = snapshot.self.step_progress;
  const isSolved = (st: Step) => solved(progress[st.id]?.status);
  const firstOpen = () => { const i = steps.findIndex((st) => !isSolved(st)); return i < 0 ? steps.length : i; };
  const [cur, setCur] = useState(firstOpen);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);
  // 이번 풀이에서 서버가 확인한 정답만 격려한다. 힌트 완료·재접속으로 연속 정답을 추정하지 않는다.
  const run = useRef({ count: 0, awarded: new Set<string>(), retried: new Set<string>() });
  const completionSent = useRef(false);
  useEffect(() => {
    if (cur >= steps.length && !completionSent.current) { completionSent.current = true; onDone(); }
  }, [cur, steps.length, onDone]);
  const doneCount = steps.filter(isSolved).length;
  const filled = feedback?.ok || (steps[cur] && isSolved(steps[cur])) ? cur + 1 : cur;
  const waiting = busy || checking;

  useEffect(() => { scroll.current?.scrollTo({ top: 0, behavior: "auto" }); }, [cur]);

  const next = () => {
    if (progress[steps[cur]?.id]?.status === "explained") run.current.count = 0;
    setFeedback(null); if (cur + 1 >= steps.length) onDone(); else setCur((c) => c + 1); play("tap");
  };

  if (cur >= steps.length) return <p className={s.say} role="status">내 자물쇠 숫자를 준비하고 있어요…</p>;
  const step = steps[cur];
  const explanation = snapshot.self.explanations[step.id];
  const explained = progress[step.id]?.status === "explained";
  const cheer = explained ? "해설로 확인했어요" : feedback?.ok && feedback.streak > 1
    ? `${feedback.streak}문제 연속 정답!` : feedback?.ok && feedback.retried ? "다시 도전해서 해냈어요!" : "맞혔어요!";

  const submit = async (answer: string | string[]) => {
    if (waiting || pending.current) return null;
    pending.current = true; setChecking(true);
    try {
      const res = await send({ action: "submit-step", stage_id: snapshot.stage.id, step_id: step.id, answer });
      if (!res || !isV2Response(res)) return null;
      if (res.result?.accepted === false) {
        run.current.count = 0; run.current.retried.add(step.id);
        play("clue-wrong"); buzz(40);
        setFeedback({ ok: false, text: step.type === "order" ? "괜찮아요. 날짜를 떠올리며 순서를 바꿔 봐요." : "괜찮아요. 다른 답으로 다시 도전해 봐요." });
        return false;
      }
      if (res.self.step_progress[step.id]?.status !== "done") return null;
      if (!run.current.awarded.has(step.id)) {
        run.current.awarded.add(step.id); run.current.count += 1;
      }
      play("clue-correct"); buzz([20, 40, 20]);
      setFeedback({ ok: true, streak: run.current.count, retried: run.current.retried.has(step.id) }); onSolved(step);
      return true;
    } finally {
      pending.current = false; setChecking(false);
    }
  };

  return <section className={s.quiz} data-testid="quiz-run" data-q={cur + 1} data-reduced={reduce || undefined}>
    <div ref={scroll} className={s.quizScroll}>
    <div className={s.quizMeta}><span className={s.quizCount}>문제 {cur + 1} / {steps.length}</span>
    <QuizRecords count={steps.length} filled={filled} />
    </div>
    <div key={`question:${step.id}`} className={s.quizQuestion}>
      <h2>{plain(step.prompt)}</h2>
    </div>
    {step.id === FIELD_STEP
      ? <FieldGate key={step.id} done={isSolved(step)}>{(open) => open && <Choices key={step.id} dock={dock} step={step} busy={waiting} locked={!!feedback?.ok}
        onSubmit={submit} onRetry={() => setFeedback(null)} wrong={feedback && !feedback.ok ? feedback.text : null} />}</FieldGate>
      : step.type === "order"
        ? <Order key={step.id} dock={dock} step={step} busy={waiting} locked={!!feedback?.ok} onSubmit={submit}
          wrong={feedback && !feedback.ok ? feedback.text : null} onRetry={() => setFeedback(null)} />
        : <Choices key={step.id} dock={dock} step={step} busy={waiting} locked={!!feedback?.ok} onSubmit={submit}
          wrong={feedback && !feedback.ok ? feedback.text : null} onRetry={() => setFeedback(null)} />}
    </div>
    <div ref={setDock} className={s.quizFooter} />
    {(feedback?.ok || (isSolved(step) && !feedback)) && <MissionDialog key={step.id} label={progress[step.id]?.status === "explained" ? "해설로 확인했어요" : "맞혔어요!"}
      className={s.quizSheet} testId="quiz-feedback">
      <SuccessMark />
      <h3 className={s.quizVerdict} data-testid="quiz-cheer">{cheer}</h3>
      <div className={s.quizCollection}>
        <QuizRecords count={steps.length} filled={cur + 1} />
        <p className={s.quizResultCount}>기록 {cur + 1} / {steps.length}</p>
      </div>
      {explanation && <p className={s.quizWhy}>{missionText(explanation)}</p>}
      <button type="button" className={`${s.btn} ${s.quizGo}`} onClick={next} data-sound="none" data-testid="quiz-next" autoFocus>
        {cur + 1 < steps.length ? "다음 문제" : "내 숫자 확인하기"}<ArrowRight size={20} aria-hidden />
      </button>
    </MissionDialog>}
    <span className={s.sr} aria-live="polite">{doneCount}문제 풀었어요</span>
  </section>;
}

/** 작은 도장 세 칸. 문제를 푼 만큼만 채워, 첫 화면의 높이를 늘리지 않는다. */
function QuizRecords({ count, filled }: { count: number; filled: number }) {
  return <div className={s.recordTrail} role="progressbar" aria-valuemin={0} aria-valuemax={count} aria-valuenow={filled}
    aria-label={`기록 ${count}개 중 ${filled}개 모았어요`}>
    {Array.from({ length: count }, (_, i) => <span key={i} data-filled={i < filled || undefined} data-current={i === filled || undefined} aria-hidden>
      <b>{i < filled ? "證" : i + 1}</b>
    </span>)}
  </div>;
}

/** 현장 찾기: 먼저 눈으로 대상을 찾고 '찾았어요'를 눌러야 문제가 열린다. */
function FieldGate({ done, children }: { done: boolean; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(done);
  if (open) return <>{children(true)}</>;
  return <div className={s.quizField} data-testid="quiz-field">
    <div className={s.quizFieldArt}><SlotArt art="bloom" /></div>
    <p className={s.quizFieldKicker}><MapPin size={16} aria-hidden /> 현장 미션</p>
    <p className={s.say}>정문 인근 민주공원에서 조형물 <b>'피어나다'</b>를 찾아요. 꽃잎을 직접 눈으로 본 뒤 문제를 열어요.</p>
    <p className={s.note}>조형물 이해를 돕는 예시 그림이에요. 실제 모습은 현장에서 확인해요. 길을 건널 때는 신호를 지켜요.</p>
    <button type="button" className={`${s.btn} ${s.roleBtn}`} data-sound="confirm" onClick={() => { setOpen(true); buzz(20); }} data-testid="quiz-found">
      찾았어요, 문제 열기
    </button>
  </div>;
}

/** 객관식: 하나를 고르고 '확인하기'. 틀린 칸은 흔들리고 흐려진다. */
function Choices({ dock, step, busy, locked, wrong, onSubmit, onRetry }: {
  dock: HTMLElement | null; step: Step; busy: boolean; locked: boolean; wrong: string | null;
  onSubmit: (answer: string) => Promise<boolean | null>; onRetry: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [shake, setShake] = useState(0);
  const choose = (id: string) => { if (locked || busy) return; if (wrong) onRetry(); setPick(id); play("tap"); buzz(12); };
  const check = async () => {
    if (!pick) return;
    const ok = await onSubmit(pick);
    if (ok === false) { setMissed((m) => [...m, pick]); setShake((n) => n + 1); setPick(null); }
  };
  return <>
    <div className={s.quizOpts} role="radiogroup" aria-label="답 고르기">
      {(step.choices ?? []).map((label, i) => {
        const id = String(i + 1), miss = missed.includes(id), on = pick === id;
        return <button key={id} type="button" role="radio" aria-checked={on} disabled={busy || locked || miss}
          className={s.quizOpt} data-on={on || undefined} data-miss={miss || undefined}
          data-shake={miss && id === missed[missed.length - 1] ? shake % 2 : undefined}
          data-right={locked && on || undefined} onClick={() => choose(id)}>
          <span className={s.quizNum} aria-hidden>{miss ? <X size={16} /> : on ? <Check size={18} strokeWidth={3} /> : NUMS[i]}</span>
          <span>{plain(label)}</span>
        </button>;
      })}
    </div>
    {!locked && dock && createPortal(<div className={s.quizDock}>
      {wrong && <p className={s.quizWrong} role="alert">{wrong}</p>}
      <button type="button" className={`${s.btn} ${s.quizCheck}`} disabled={!pick || busy} aria-busy={busy} onClick={() => void check()} data-testid="quiz-check">
        {busy ? "확인 중…" : pick ? "이 답으로 확인" : "답을 골라 주세요"}
      </button>
    </div>, dock)}
  </>;
}

/** 순서 맞히기: 아래 카드를 눌러 위 칸에 차례로 놓는다. 놓은 카드를 누르면 다시 내려온다. */
function Order({ dock, step, busy, locked, wrong, onSubmit, onRetry }: {
  dock: HTMLElement | null; step: Step; busy: boolean; locked: boolean; wrong: string | null;
  onSubmit: (answer: string[]) => Promise<boolean | null>; onRetry: () => void;
}) {
  const choices = step.choices ?? [];
  const [slots, setSlots] = useState<number[]>([]);
  const [shake, setShake] = useState(0);
  const left = useMemo(() => choices.map((_, i) => i).filter((i) => !slots.includes(i)), [choices, slots]);
  const put = (i: number) => { if (locked || busy) return; if (wrong) onRetry(); setSlots((sl) => [...sl, i]); play("dial-tick"); buzz(12); };
  const take = (i: number) => { if (locked || busy) return; if (wrong) onRetry(); setSlots((sl) => sl.filter((v) => v !== i)); play("tap"); };
  const full = slots.length === choices.length;
  const check = async () => {
    const ok = await onSubmit(slots.map((i) => String(i + 1)));
    if (ok === false) setShake((n) => n + 1);
  };
  return <>
    <ol className={s.orderSlots} aria-label="일어난 차례" data-shake={wrong ? shake % 2 : undefined} data-right={locked || undefined}>
      {choices.map((_, k) => {
        const i = slots[k];
        return <li key={k} data-next={i == null && k === slots.length || undefined}>
          <span className={s.orderNo} aria-hidden>{i == null ? k + 1 : <Check size={17} />}</span>
          {i == null ? <span className={s.orderEmpty}>{k === 0 ? "가장 먼저 일어난 일" : k === choices.length - 1 ? "가장 나중에 일어난 일" : "그다음 일"}</span>
            : <button type="button" className={s.orderCard} data-placed onClick={() => take(i)} disabled={busy || locked}
              aria-label={`${k + 1}번째: ${JAMO[i]}. ${plain(choices[i])} 누르면 빼요`}>
              <b>{JAMO[i]}</b><span>{plain(choices[i])}</span>
            </button>}
          {k < choices.length - 1 && <ArrowDown className={s.orderArrow} size={16} aria-hidden />}
        </li>;
      })}
    </ol>
    {!!left.length && <div className={s.orderBank} role="group" aria-label="놓을 사건 카드">
      {left.map((i) => <button key={i} type="button" className={s.orderCard} onClick={() => put(i)} disabled={busy || locked}
        aria-label={`${JAMO[i]}. ${plain(choices[i])} 누르면 다음 칸에 놓아요`}>
        <b>{JAMO[i]}</b><span>{plain(choices[i])}</span>
      </button>)}
    </div>}
    {!locked && dock && createPortal(<div className={s.quizDock}>
      {wrong && <p className={s.quizWrong} role="alert">{wrong}</p>}
      {!!slots.length && <button type="button" className={`${s.btn} ${s.ghost} ${s.quizReset}`} onClick={() => { setSlots([]); if (wrong) onRetry(); }} aria-label="다시 놓기">
        <RotateCcw size={18} aria-hidden />
      </button>}
      <button type="button" className={`${s.btn} ${s.quizCheck}`} disabled={!full || busy} aria-busy={busy} onClick={() => void check()} data-testid="quiz-check">
        {busy ? "확인 중…" : full ? "이 순서로 확인" : `카드 ${choices.length - slots.length}장 더 놓기`}
      </button>
    </div>, dock)}
  </>;
}

