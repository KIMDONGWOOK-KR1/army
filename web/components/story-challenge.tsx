"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownRight, Send } from "lucide-react";
import { isV2Response, type GameResponse, type V2Response } from "@/lib/game-snapshot";
import type { Command, Step, StepAnswer } from "@/supabase/functions/_shared/types";
import { hasCompleteDraft, playCopy } from "@/lib/story-play";
import { emptyStepAnswer } from "./verify-input";
import { StoryStepInput } from "./story-step-input";
import { ClueParcel, DiscoveryStamp, type Discovery } from "./story-discovery";
import { PaperFlight } from "./paper-flight";
import type { PaperMotion, PaperRect } from "@/lib/paper-motion";
import s from "./story-mission.module.css";

export type StoryProps = { snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null>; onShowDigit?: () => void };
export function StoryChallenge({ step, snapshot, busy, send, discovery }: StoryProps & { step: Step; discovery: Discovery }) {
  const [answer, setAnswer] = useState<StepAnswer>(() => emptyStepAnswer(step));
  const [feedback, setFeedback] = useState("");
  const p = snapshot.self.step_progress[step.id], done = p?.status === "done" || p?.status === "explained";
  const copy = playCopy(step), available = p?.status === "open";
  const opened = discovery.opened.includes(step.id), collected = discovery.collected.includes(step.id);
  const content = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null), wasDone = useRef(done);
  const [flight, setFlight] = useState<PaperMotion | null>(null);
  const finishFlight = useCallback(() => setFlight(null), []);
  useEffect(() => {
    if (done && !wasDone.current && form.current?.getClientRects().length)
      form.current.querySelector<HTMLButtonElement>('[data-testid="story-claim"]')?.focus({ preventScroll: true });
    wasDone.current = done;
  }, [done]);
  const reveal = (kind: "opened" | "collected", animate: boolean, from: PaperRect) => {
    const target = Array.from(form.current?.closest('[data-testid="story-workbench"]')?.querySelectorAll<HTMLButtonElement>("[data-story-step]") ?? [])
      .find((button) => button.dataset.storyStep === step.id)?.getBoundingClientRect();
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // If the notebook is off-screen, finish locally rather than fly out of view.
      const to = target && target.top >= 0 && target.bottom <= innerHeight ? target : undefined;
      setFlight({ kind: kind === "opened" ? "open" : "collect", from, to });
    }
    discovery.mark(kind, step.id, animate);
    requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
  };
  return <form ref={form} className={s.challenge} data-testid={`mission-v2-step-${step.id}`} autoComplete="off" onSubmit={async (e) => {
    e.preventDefault(); if (busy || !available || !hasCompleteDraft(step, answer)) return;
    setFeedback("");
    const next = await send({ action: "submit-step", stage_id: snapshot.stage.id, step_id: step.id, answer });
    if (!next || !isV2Response(next)) return;
    if (next.result?.accepted === false) setFeedback(snapshot.self.mission?.scenes.find((scene) => scene.trigger === "retry")?.text
      ?? "아직 맞물리지 않는 단서가 있어요. 근거를 다시 대조해보세요. 문제 오답은 자물쇠 시도 횟수를 줄이지 않습니다.");
    else setAnswer(emptyStepAnswer(step));
  }}>
    {flight && discovery.motion === `${flight.kind === "open" ? "opened" : "collected"}:${step.id}` && <PaperFlight motion={flight} role={snapshot.self.role!} onFinish={finishFlight} />}
    {!done && available && !opened && <ClueParcel role={snapshot.self.role!} onOpen={(animate, origin) => reveal("opened", animate, origin)} />}
    {!done && available && opened && <div className={s.openedClue} ref={content} tabIndex={-1} aria-label={copy.title} data-testid="story-clue-content"
      data-motion={discovery.motion === `opened:${step.id}`}>
      <p className={s.objective}>{copy.tip}</p>
      {step.note && <p className={s.pencilNote}>{step.note}</p>}
      <fieldset className={s.fields} disabled={busy}><legend className={s.sr}>단서 조작</legend>
        <StoryStepInput step={step} value={answer} onChange={setAnswer} disabled={busy} />
        {feedback && <div className={s.retry} role="status"><CornerDownRight size={20} aria-hidden /><p>{feedback}</p></div>}
        <button type="submit" className={s.primaryAction} data-testid="story-submit" disabled={!hasCompleteDraft(step, answer)}>
          {busy ? "기록을 보내는 중…" : copy.action}<Send size={18} aria-hidden />
        </button>
      </fieldset>
    </div>}
    {done && !collected && <ClueParcel role={snapshot.self.role!} reward onOpen={(animate, origin) => reveal("collected", animate, origin)} />}
    {done && collected && <div className={s.discovery} role="status" ref={content} tabIndex={-1}>
      <DiscoveryStamp role={snapshot.self.role!} animate={discovery.motion === `collected:${step.id}`} />
      <span className={s.paperLabel}>{p.status === "explained" ? "해설로 이어진 기록" : "조사 완료"}</span>
      <h3>수첩에 기록 도장을 남겼어요</h3>
      <p>{snapshot.self.rewards[step.id] ?? snapshot.self.explanations[step.id] ?? "동료의 단서와 연결해보세요."}</p>
    </div>}
    <details className={s.disclosure} data-testid="story-reference">
      <summary>원문·자료 펼치기</summary><p>{step.prompt}</p>
      {step.sourceIds?.map((id) => snapshot.stage.sources.find((source) => source.id === id)).filter(Boolean).map((source) =>
        <a key={source!.id} href={source!.url} target="_blank" rel="noreferrer">{source!.title} ↗</a>)}
      {p?.record && <dl>{Object.entries(p.record).map(([key, text]) => <div key={key}><dt>{step.fields?.find((f) => f.id === key)?.label ?? "내 기록"}</dt><dd>{text}</dd></div>)}</dl>}
      {snapshot.self.explanations[step.id] && <p>{snapshot.self.explanations[step.id]}</p>}
    </details>
  </form>;
}
