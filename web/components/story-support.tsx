"use client";
import { BookOpen, LifeBuoy, Mail } from "lucide-react";
import { ROLES, ROLE_NAMES } from "@/supabase/functions/_shared/types";
import { SharedRecords, YongbongPanel } from "./yongbong-panel";
import type { StoryProps } from "./story-challenge";
import s from "./story-mission.module.css";

export function StorySupport({ snapshot, busy, send, inboxOnly = false }: StoryProps & { inboxOnly?: boolean }) {
  const { game, self, stage } = snapshot, role = self.role!;
  if (inboxOnly) return <details className={s.radioMessage} data-testid="story-inbox">
    <summary><Mail size={20} aria-hidden />동료의 자료 묶음 도착<span>읽기</span></summary>
    <SharedRecords records={self.shared_records!} />
  </details>;
  const allDone = self.mission!.steps.every((step) => ["done", "explained"].includes(self.step_progress[step.id]?.status));
  return <>
    {!!stage.altModes?.length && <details className={s.disclosure} data-testid="story-visit-options"><summary>실내 관람이 어렵나요?</summary>
      <YongbongPanel snapshot={{ ...snapshot, self: { ...self, shared_records: [] } }} busy={busy} send={send} />
    </details>}
    <details className={s.disclosure} data-testid="story-help"><summary><LifeBuoy size={18} aria-hidden />도움 무전{self.hints.length ? ` · ${self.hints.length}개 도착` : ""}</summary>
      {self.hints.map((hint, i) => <p key={i}>{i + 1}. {hint}</p>)}
      {role === "commander" ? <><p>동료가 막혔다면 도움을 보내세요. 3단계는 해설로 이어집니다.</p>
        {ROLES.map((r, i) => { const level = game.hint_level[r] ?? 0, next = level + 1;
          return <div className={s.hintRow} key={r}><span>{ROLE_NAMES[r]} · {level}/3{next <= 3 ? ` · 감점 ${stage.scoring.enabled ? stage.scoring.hintPenalty[next as 1 | 2 | 3] ?? "미정" : 0}` : ""}</span>
            <button type="button" disabled={busy || level >= 3 || game.report_mask[i] || (r === role && allDone)}
              onClick={() => void send({ action: "request-hint", stage_id: stage.id, target_role: r, level: next })}>
              {level >= 3 ? `${ROLE_NAMES[r]} 힌트 완료` : `${ROLE_NAMES[r]} ${next}단계 힌트`}</button></div>;
        })}</> : !self.hints.length && <p>지휘관에게 도움이 필요한 단서를 말해주세요.</p>}
      <div className={s.explanationConfirm}><BookOpen size={20} aria-hidden /><p>내 단서들의 해설을 읽었다면 확인해주세요.</p>
        <button type="button" disabled={busy || !allDone || game.confirm_mask[ROLES.indexOf(role)]}
          onClick={() => void send({ action: "confirm-explanation", stage_id: stage.id })}>
          {game.confirm_mask[ROLES.indexOf(role)] ? "내 해설 읽음 확인 완료" : "내 해설 읽음 확인"}</button>
      </div>
    </details>
  </>;
}
