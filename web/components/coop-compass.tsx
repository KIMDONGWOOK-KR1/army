"use client";
import { BookOpen, Check, ChevronDown, Footprints, Flower2, Flag } from "lucide-react";
import type { CSSProperties } from "react";
import type { V2Response } from "@/lib/game-snapshot";
import { coopGuide, expeditionStops } from "@/lib/coop-guide";
import { ROLE_NAMES } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import styles from "./coop-compass.module.css";

export function CoopCompass({ snapshot, onRecords, compact = false }: {
  snapshot: V2Response; onRecords: () => void; compact?: boolean;
}) {
  const guide = coopGuide(snapshot);
  const index = snapshot.course.sites.findIndex(site => site.id === snapshot.stage.id);
  const Icon = guide.quiet ? Flower2 : Footprints;
  return <section className={`${styles.compass} ${compact ? styles.compact : ""}`} data-testid="coop-compass" data-quiet={guide.quiet} tabIndex={compact ? 0 : undefined} aria-label="우리 탐방과 내 다음 행동">
    <div className={styles.top}><span><Icon size={16} aria-hidden="true" /> {compact ? "우리 팀 탐방" : `${index + 1}/${snapshot.course.sites.length} · ${snapshot.stage.name}`}</span>
      <button type="button" onClick={onRecords}><BookOpen size={16} aria-hidden="true" />기록첩</button></div>
    <p className={styles.action}><b>{snapshot.self.role ? ROLE_NAMES[snapshot.self.role] : "우리 팀"} · 지금 할 일</b>{guide.action}</p>
    {guide.until && <p className={styles.until} data-testid="coop-until"><Flag size={14} aria-hidden="true" /><span><b>다음으로</b> {guide.until}</span></p>}
    <details className={styles.team}>
      {/* 팀 플레이 화면처럼 네 보직의 진행을 접힌 상태에서도 한눈에 보인다(완료 여부만, 단서는 없다) */}
      <summary><span className={styles.roster} aria-hidden="true">{guide.members.map(member => {
        const RoleIcon = ROLE_ICONS[member.role];
        return <i key={member.role} data-done={member.done} data-me={member.me} style={{"--member-color": ROLE_COLORS[member.role]} as CSSProperties}>
          <RoleIcon size={13} strokeWidth={2.4} />{member.done && <Check size={9} strokeWidth={3.2} />}</i>;
      })}</span><span>네 사람의 발걸음</span><strong>{guide.label} {guide.count}/4</strong><ChevronDown size={16} aria-hidden="true" /></summary>
      <ul aria-label="역할별 진행 상태">{guide.members.map(member => {
        const RoleIcon = ROLE_ICONS[member.role];
        return <li key={member.role} style={{"--member-color": ROLE_COLORS[member.role]} as CSSProperties}>
          <span className={styles.avatar}><RoleIcon size={21} aria-hidden="true" />{member.done && <Check size={12} aria-hidden="true" />}</span>
          <div><b>{ROLE_NAMES[member.role]}{member.me ? " · 나" : ""}</b><span>{member.nickname} · {member.joined ? member.status : "합류 대기"}</span>
            {member.joined && !member.online && <small>연결 확인 중</small>}</div>
        </li>;
      })}</ul>
      <p className={styles.privacy}>{guide.quiet ? "각자의 속도로 마음을 전해요." : "완료 상태만 함께 보여요. 개인 단서와 회고 본문은 나만 볼 수 있어요."}</p>
    </details>
  </section>;
}

export function ExpeditionPassport({ snapshot }: {snapshot: V2Response}) {
  const stops = expeditionStops(snapshot);
  const count = stops.filter(site => site.status === "complete").length;
  return <section className={styles.passport} data-testid="expedition-passport" aria-label="우리의 탐방 기록첩">
    <span className={styles.eyebrow}>우리의 탐방 기록첩</span>
    <h2>네 개의 시선이 남긴 발자국</h2>
    <p>함께 마친 장소 {count}/{stops.length} · 기록은 아래에서 다시 읽어요.</p>
    <ol>{stops.map((site, i) => <li key={site.id} data-state={site.status} aria-current={site.status === "current" ? "step" : undefined}>
      <span className={styles.stamp}>{site.status === "complete" ? <Check size={22} aria-hidden="true" /> : String(i+1).padStart(2,"0")}</span>
      <div><b>{site.name}</b><span>{site.status === "complete" ? "함께 남긴 기록" : site.status === "current" ? "지금 이곳" : "앞으로 만날 이야기"}</span></div>
    </li>)}</ol>
    <p className={styles.privacy}>함께 마친 장소의 기록이 차곡차곡 남아요.</p>
  </section>;
}
