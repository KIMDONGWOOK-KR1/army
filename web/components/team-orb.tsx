"use client";
// 우측 상단 부가 기능 묶음(hh 2026-10-28): '함께 모으기'(팀 상태)·기록첩(이동 화면)·지도(문제 화면)를 작은 원형 단추로 둔다.
// 문제 화면에서는 세로로 쌓으면 문제 카드를 덮어서 가로 한 줄로 두고, 기록첩은 메뉴(≡)에서 연다.
// '함께 모으기'는 기본으로 닫혀 있고, 누르면 넓은 화면에서는 단추 옆 작은 팝오버, 좁은 화면에서는 아래 시트로 열린다.
// 닫기 단추·Esc·바깥 누르기로 닫히고, 닫으면 초점이 단추로 돌아온다. 단추 아래 짧은 이름과 마우스 툴팁으로 기능을 알 수 있다.
// 진행에 꼭 필요한 팀 상태(몇 명이 마쳤는지)는 닫힌 단추의 n/4 배지로 늘 보인다.
import { BookOpen, Check, Flower2, Map as MapIcon, Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { V2Response } from "@/lib/game-snapshot";
import { coopGuide } from "@/lib/coop-guide";
import { ROLE_NAMES } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import styles from "./team-orb.module.css";

export function TeamOrb({ snapshot, onRecords, onMap, quiet = false, mapOnly = false }: {
  snapshot: V2Response;
  /** 이동 화면: 기록첩 열기(문제 화면에서는 메뉴로) */
  onRecords?: () => void;
  /** 문제 화면: 지도로 잠깐 나갔다 오기 */
  onMap?: () => void;
  /** 문제 풀이 중에는 시선을 덜 끌게 작고 옅게 */
  quiet?: boolean;
  /** 문제 푸는 화면: 위에는 지도만(hh 2026-11-09: 함께 동그라미는 문제 화면에서 뺀다) */
  mapOnly?: boolean;
}) {
  const guide = coopGuide(snapshot);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const orb = useRef<HTMLButtonElement>(null), close = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null);
  const shut = (focus = true) => {
    setOpen(false);
    if (focus) requestAnimationFrame(() => orb.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } };
    // 바깥을 누르면 닫는다. 지도(캔버스)를 누른 것이면 그 누름이 카메라·표석으로 가지 않게 막고,
    // 다른 단추(도착 확인 등)는 닫히면서 그대로 눌린다. 좁은 화면의 시트는 뒤 가림막이 먼저 받아 닫기만 한다
    const outside = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!root.current || root.current.contains(target)) return;
      shut(false);
      if (!target.closest?.("canvas")) return;
      e.preventDefault(); e.stopPropagation();
      const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 600);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", outside, true); };
  }, [open]);
  // 네 칸 고리: 마친 보직은 제 색, 아직이면 옅게
  const ring = `conic-gradient(${guide.members.map((m, i) =>
    `${ROLE_COLORS[m.role]}${m.done ? "" : "40"} ${i * 25}% ${(i + 1) * 25 - 2}%, transparent ${(i + 1) * 25 - 2}% ${(i + 1) * 25}%`).join(", ")})`;
  const Icon = guide.quiet ? Flower2 : Users;
  return <div ref={root} className={styles.side} data-testid="coop-compass" data-open={open} data-quiet={guide.quiet} data-dim={quiet}>
    {!mapOnly && <div className={styles.item}>
      <button ref={orb} type="button" className={styles.orb} aria-expanded={open} aria-controls={panelId} onClick={() => open ? shut() : setOpen(true)}
        aria-label={`팀 퀘스트(함께 모으기): ${guide.headline}, ${guide.label} ${guide.count}/4, ${open ? "접기" : "펼치기"}`}
        title="함께 모으기 · 팀 상태 보기" data-waiting={guide.waiting}>
        <span className={styles.ring} style={{ background: ring }} aria-hidden="true" />
        <span className={styles.core} aria-hidden="true"><Icon size={20} strokeWidth={2.4} /></span>
        <b className={styles.badge}>{guide.count}/4</b>
        <span className={styles.srOnly}>{guide.headline}</span>
      </button>
      <span className={styles.label} aria-hidden="true">함께</span>
    </div>}
    {onRecords && <div className={styles.item}>
      <button type="button" className={styles.round} aria-label="기록첩" title="기록첩 · 모은 기록 보기" onClick={() => { shut(false); onRecords(); }}>
        <BookOpen size={20} aria-hidden="true" />
      </button>
      <span className={styles.label} aria-hidden="true">기록첩</span>
    </div>}
    {onMap && <div className={styles.item}>
      <button type="button" className={styles.round} aria-label="지도 보기: 내 위치와 거점" title="지도 · 내 위치 보기" onClick={() => { shut(false); onMap(); }}>
        <MapIcon size={20} aria-hidden="true" />
      </button>
      <span className={styles.label} aria-hidden="true">지도</span>
    </div>}
    {open && <>
      <span className={styles.scrim} aria-hidden="true" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); shut(false); }} />
      <div className={styles.pop} id={panelId} role="dialog" aria-label="함께 모으기 · 팀 상태">
        <div className={styles.popHead}>
          <p className={styles.head}>{guide.headline}<em>{guide.label} {guide.count}/4</em></p>
          <button ref={close} type="button" className={styles.close} aria-label="닫기" onClick={() => shut()}><X size={18} aria-hidden="true" /></button>
        </div>
        <p className={styles.action}>{guide.action}</p>
        <ul className={styles.members} aria-label="역할별 진행 상태">{guide.members.map((member) => {
          const RoleIcon = ROLE_ICONS[member.role];
          return <li key={member.role} data-done={member.done} style={{ "--member-color": ROLE_COLORS[member.role] } as CSSProperties}>
            <span className={styles.avatar}><RoleIcon size={14} aria-hidden="true" />{member.done && <Check size={10} strokeWidth={3} aria-hidden="true" />}</span>
            <span>{ROLE_NAMES[member.role]}{member.me ? " · 나" : ""}</span>
          </li>;
        })}</ul>
      </div>
    </>}
  </div>;
}
