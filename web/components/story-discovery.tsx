"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, MailOpen, Sparkles } from "lucide-react";
import { ROLES, ROLE_NAMES, type Role } from "@/supabase/functions/_shared/types";
import { discoveryKey, emptyDiscovery, readDiscovery, type DiscoveryMemory } from "@/lib/story-discovery";
import { ROLE_ICONS } from "./role-style";
import type { PaperRect } from "@/lib/paper-motion";
import { PaperProp } from "./paper-flight";
import s from "./story-discovery.module.css";

export function useDiscovery(game: string, stage: string, role: string, ids: string[]) {
  const key = discoveryKey(game, stage, role), allowed = ids.join("|");
  const [memory, setMemory] = useState<DiscoveryMemory>(emptyDiscovery);
  const [motion, setMotion] = useState("");
  useEffect(() => {
    try { setMemory(readDiscovery(sessionStorage.getItem(key), allowed.split("|"))); }
    catch { setMemory(emptyDiscovery()); }
    setMotion("");
  }, [key, allowed]);
  const mark = (kind: keyof DiscoveryMemory, id: string, animate: boolean) => {
    if (!ids.includes(id)) return;
    const next = { ...memory, [kind]: [...new Set([...memory[kind], id])] };
    setMemory(next); setMotion(animate ? `${kind}:${id}` : "");
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* Cosmetic state is optional. */ }
  };
  return { ...memory, motion, mark, clearMotion: () => setMotion("") };
}
export type Discovery = ReturnType<typeof useDiscovery>;

/** Original paper prop, not a historical document or a copied game asset. */
export function ClueParcel({ role, reward = false, onOpen }: { role: Role; reward?: boolean; onOpen: (animate: boolean, origin: PaperRect) => void }) {
  const scene = useRef<HTMLSpanElement>(null);
  return <button type="button" className={s.parcel} data-reward={reward} data-testid={reward ? "story-claim" : "story-open-clue"}
    onClick={(event) => onOpen(event.detail > 0, scene.current!.getBoundingClientRect())}>
    <span className={s.propScene} ref={scene} aria-hidden="true">
      <span className={s.halo} />
      <PaperProp role={role} reward={reward} />
      <span className={s.propTag}>{reward ? "조사 완료" : "새 단서"}</span>
    </span>
    <span className={s.parcelCaption}>{reward ? <Sparkles size={20} /> : <MailOpen size={20} />}
      {reward ? "기록 조각 펼치기" : "단서 봉투 열기"}</span>
    <span className={s.parcelNote}>{reward ? "확인한 기록을 수첩에 담으세요" : "봉투를 눌러 조사를 시작하세요"}</span>
  </button>;
}

export function DiscoveryStamp({ role, animate }: { role: Role; animate: boolean }) {
  const Icon = ROLE_ICONS[role];
  return <div className={s.stampScene} data-motion={animate} aria-hidden="true" data-testid="story-discovery-stamp">
    <i /><i /><i /><i />
    <div className={s.stamp}><Icon size={40} strokeWidth={1.7} /><span>기록 보관</span><Check size={18} /></div>
  </div>;
}

/** Shown only after server-confirmed completion of an investigation site. */
export function StorySachoAssembly({ game, stage }: { game: string; stage: string }) {
  const [animate, setAnimate] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const key = discoveryKey(game, stage, "sacho");
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "seen");
    } catch { /* Still present the server-confirmed reward. */ }
    setAnimate(true);
  }, [game, stage]);
  return <div className={s.assembly} data-motion={animate} data-testid="story-sacho-assembly" aria-label="네 보직의 기록이 사초 한 장으로 모였습니다">
    <div className={s.assemblyBook} aria-hidden="true">
      <div className={s.mosaic}>{ROLES.map((role) => { const Icon = ROLE_ICONS[role]; return <span key={role}><Icon size={26} strokeWidth={1.5} /><i /></span>; })}</div>
      <span>함께 남긴 기록</span>
    </div>
    <div className={s.assemblyCrew}>{ROLES.map((role, i) => { const Icon = ROLE_ICONS[role]; return <span key={role} style={{ animationDelay: `${i * 40}ms` } as CSSProperties}>
      <Icon size={22} aria-hidden="true" /><span>{ROLE_NAMES[role]}</span><Check size={14} aria-hidden="true" /></span>; })}</div>
  </div>;
}
