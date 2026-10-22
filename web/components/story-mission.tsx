"use client";
import { useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, CircleHelp, LockKeyhole, Radio, Send } from "lucide-react";
import { ROLES, ROLE_NAMES, type SceneText } from "@/supabase/functions/_shared/types";
import { playCopy, STORY_TOOLS } from "@/lib/story-play";
import { personalMissionBody } from "@/lib/gate-narration";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import { StoryChallenge, type StoryProps } from "./story-challenge";
import { MissionAsset } from "./mission-asset";
import { StorySupport } from "./story-support";
import { useDiscovery } from "./story-discovery";
import s from "./story-mission.module.css";

const finished = (status?: string) => status === "done" || status === "explained";

/** Four distinct tools; receives only the caller's server-projected mission. */
export function StoryMission(props: StoryProps) {
  const { snapshot: snap, busy, send, onShowDigit } = props;
  const { self, game, stage } = snap, role = self.role!, mission = self.mission!, steps = mission.steps;
  const discovery = useDiscovery(game.id, stage.id, role, steps.map((step) => step.id));
  const [selected, setSelected] = useState((steps.find((step) => !finished(self.step_progress[step.id]?.status)) ?? steps[0])?.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = steps.find((step) => step.id === selected) ?? steps[0];
  const completed = steps.filter((step) => finished(self.step_progress[step.id]?.status)).length;
  const done = steps.length > 0 && completed === steps.length;
  const cleared = game.stage_phase === "done" || game.site_phase === "cleared";
  const locked = current && self.step_progress[current.id]?.status === "locked";
  const next = steps.find((step) => !finished(self.step_progress[step.id]?.status));
  const waitingRoles = [...new Set([...(current?.requires ?? []).map((r) => r.role), ...(current?.requiresReports ?? [])])].filter((r) => r !== role);
  const requiredReports = [...new Set(steps.flatMap((step) => step.requiresReports ?? []))];
  const remainingReports = requiredReports.filter((target) => !game.report_mask[ROLES.indexOf(target)]);
  const visibleScene = (scene: SceneText) => scene.trigger === "enter" ||
    (scene.trigger === "role-complete" && done) ||
    (scene.trigger === "reports-ready" && game.report_mask.every(Boolean)) ||
    (scene.trigger === "stage-complete" && cleared) ||
    (scene.trigger === "scout-reported" && game.report_mask[ROLES.indexOf("scout")]);
  const tool = STORY_TOOLS[role], Icon = ROLE_ICONS[role];
  const select = (id: string) => { discovery.clearMotion(); setSelected(id); requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "nearest" }); }); };
  return <div className={s.workbench} data-testid="story-workbench" data-role={role} style={{ "--role-ink": ROLE_COLORS[role] } as CSSProperties}>
    <header className={s.toolHead}>
      <div><span className={s.chapter}>현장 기록 · {stage.name}</span><h2><Icon size={24} aria-hidden />{tool.name}</h2></div>
      <span className={s.toolNumber} aria-hidden>{String(snap.current_site.seq).padStart(2, "0")}</span>
    </header>
    <div className={s.crew} aria-label="팀 보고 상황">{ROLES.map((r, i) => {
      const MemberIcon = ROLE_ICONS[r];
      return <div key={r} data-ready={game.report_mask[i]} data-self={r === role}><MemberIcon size={18} aria-hidden /><span>{ROLE_NAMES[r]}</span>
        <small>{game.report_mask[i] ? "보고 완료" : `조사 ${game.step_done_count[r] ?? 0}`}</small></div>;
    })}</div>
    {role === "commander" && self.transfer_clue && <details className={s.radioMessage} data-testid="mission-v2-transfer-clue">
      <summary><Radio size={20} aria-hidden />{self.transfer_clue.label}<span>열기</span></summary>
      <strong>{self.transfer_clue.value}</strong><p>통신원에게 말로 전하세요.</p>
    </details>}
    {!!self.shared_records?.length && <StorySupport {...props} inboxOnly />}
    <section className={s.deck} data-testid="story-mission-deck">
      <div className={s.fragmentHeading}><span>나의 조사 수첩</span><span>{completed} / {steps.length}</span></div>
      <div className={s.questProgress} role="progressbar" aria-label="조사 완료" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={steps.length}>
        <span style={{ transform: `scaleX(${steps.length ? completed / steps.length : 0})` }} />
      </div>
      <nav className={s.fragments} aria-label="조사 단서 선택">{steps.map((step, i) => {
        const status = self.step_progress[step.id]?.status;
        return <button key={step.id} type="button" data-testid={`story-step-tab-${step.id}`} data-story-step={step.id} aria-current={current?.id === step.id ? "step" : undefined}
          data-complete={finished(status)} data-collected={finished(status) && discovery.collected.includes(step.id)} aria-label={`단서 ${i + 1} · ${playCopy(step).title} · ${finished(status) ? discovery.collected.includes(step.id) ? "기록 보관" : "완료 · 기록 펼치기" : status === "locked" ? "대기" : "조사 중"}`}
          onClick={() => select(step.id)}>{finished(status) ? <Check size={20} /> : status === "locked" ? <LockKeyhole size={18} /> : <span>{i + 1}</span>}</button>;
      })}</nav>
      <h3 className={s.challengeTitle} ref={heading} tabIndex={-1}>{current ? playCopy(current).title : "배정된 조사를 기다리는 중"}</h3>
      {locked && <div className={s.waiting} role="status">
        <div className={s.linkDiagram} aria-hidden><Radio /><i /><Icon /><i /><LockKeyhole /></div>
        <strong>다음 단서를 기다리는 중</strong>
        <p>{waitingRoles.length ? `${waitingRoles.map((r) => ROLE_NAMES[r]).join("·")}에게 확인한 내용을 물어보세요.` : "앞 단서를 마치면 이 기록이 열려요."}</p>
        <span className={s.pencilNote}>누구도 혼자 모든 단서를 볼 수 없어요.</span>
        {role === "commander" && self.transfer_clue && <p>먼저 위의 신호를 통신원에게 전하세요.</p>}
      </div>}
      {steps.map((step) => <div key={step.id} hidden={step.id !== current?.id}><StoryChallenge {...props} busy={busy || cleared} step={step} discovery={discovery} /></div>)}
      {current && finished(self.step_progress[current.id]?.status) && next && <button className={s.nextAction} type="button" onClick={() => select(next.id)}>다음 단서 열기<ArrowRight size={18} /></button>}
      {done && <section className={s.reportDock} data-testid="story-report-dock">
        <h3>{self.reported ? "동료에게 이어진 기록" : "내 단서가 모두 모였어요"}</h3><p>{tool.handoff}</p>
        {self.reported ? <>
          <p>{mission.digit ? "내 숫자를 지휘관에게 말로 전하세요." : "조사 결과를 팀에 말로 전달하세요."}</p>
          {mission.digit && (onShowDigit ? <button className={s.primaryAction} type="button" onClick={onShowDigit}>내 숫자 확인<Check size={18} /></button>
            : self.digit !== null && <div className="private-digit" data-testid="mission-v2-private-digit">{self.digit}</div>)}
          <p>다른 기기에는 보고 완료 표시만 전달됩니다.</p>
        </> : <>
          {!!remainingReports.length && <p>선행 보고 대기: {remainingReports.map((target) => ROLE_NAMES[target]).join(" · ")}</p>}
          <button className={s.primaryAction} type="button" disabled={busy || cleared || !!remainingReports.length} onClick={() => void send({ action: "submit-report", stage_id: stage.id })}>조사 결과 보고<Send size={18} /></button>
        </>}
      </section>}
    </section>
    <StorySupport {...props} busy={busy || cleared} />
    <details className={s.disclosure}><summary><CircleHelp size={18} aria-hidden />작전 이야기·관찰 안내</summary>
      {visibleScene(mission.intro) && <p>{personalMissionBody(mission.intro.text)}</p>}
      <MissionAsset asset={mission.asset} stageId={stage.id} role={role} />
      {stage.narration.filter(visibleScene).map((line) => <p key={line.id}>{line.text}</p>)}
      {mission.scenes.filter(visibleScene).map((scene) => <p key={scene.id}>{scene.text}</p>)}
    </details>
  </div>;
}
