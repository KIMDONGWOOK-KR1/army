"use client";
import { useEffect, useRef, useState } from "react";
import { MotionConfig, Reorder, useDragControls } from "motion/react";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { motionTokens, springs } from "@/lib/motion-tokens";
import type { Step, StepAnswer } from "@/supabase/functions/_shared/types";
import s from "./story-mission.module.css";

/** Reorders the participant's draft only; the server still judges the submitted answer. */
export function StoryOrder({ step, value, onChange, disabled }: {
  step: Step; value: StepAnswer; onChange: (value: StepAnswer) => void; disabled: boolean;
}) {
  const choices = step.choices ?? [], chosen = Array.isArray(value) ? value.filter(Boolean) : [];
  const reduce = useMotionPreference();
  const before = useRef<string[] | null>(null);
  const [epoch, setEpoch] = useState(0), [notice, setNotice] = useState("");
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => {
    if ((reduce || disabled) && before.current) {
      change.current(before.current); before.current = null;
      setEpoch((n) => n + 1); setNotice("옮기기를 취소했어요.");
    }
  }, [reduce, disabled]);
  useEffect(() => {
    const cancel = () => {
      if (!before.current) return;
      change.current(before.current); before.current = null;
      setEpoch((n) => n + 1); setNotice("옮기기를 취소했어요.");
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("keydown", key); window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const move = (i: number, offset: number) => {
    if (disabled || i + offset < 0 || i + offset >= chosen.length) return;
    const next = [...chosen]; [next[i], next[i + offset]] = [next[i + offset], next[i]];
    onChange(next); setNotice(`${i + 1}번째 카드를 ${i + offset + 1}번째로 옮겼어요.`);
  };
  return <div className={s.order} data-testid="story-order">
    <p>{reduce ? "사건을 골라 놓고, 화살표로 순서를 바꾸세요." : "사건을 골라 놓고, 손잡이를 끌어 순서를 맞추세요."}</p>
    <MotionConfig reducedMotion={reduce ? "always" : "user"}><Reorder.Group key={`${epoch}-${reduce}-${disabled}`} as="ol" axis="y" values={chosen} onReorder={(next) => { if (!disabled) onChange(next); }}
      aria-label="배열한 사건 카드" className={s.timeline}>
      {chosen.map((id, i) => <OrderCard key={id} id={id} index={i} text={choices[Number(id) - 1]} count={chosen.length} reduce={reduce} disabled={disabled}
        onMove={(offset) => move(i, offset)} onRemove={() => { onChange(chosen.filter((v) => v !== id)); setNotice("카드를 다시 고를 수 있어요."); }}
        onStart={() => { before.current = [...chosen]; setNotice("카드를 옮기는 중이에요. 취소하려면 Esc를 누르세요."); }}
        onEnd={(cancelled) => { if (cancelled && before.current) { onChange(before.current); setEpoch((n) => n + 1); } before.current = null; setNotice(cancelled ? "옮기기를 취소했어요." : "카드 순서를 바꿨어요."); }} />)}
      {chosen.length < choices.length && <li className={s.emptySlot}><span className={s.index}>{chosen.length + 1}</span><p>다음 사건을 여기에 놓으세요</p></li>}
    </Reorder.Group></MotionConfig>
    <div className={s.choices}>{choices.map((choice, i) => !chosen.includes(String(i + 1)) && <button key={i} type="button" disabled={disabled}
      data-testid={`order-choice-${step.id}-${i + 1}`} onClick={() => { onChange([...chosen, String(i + 1)]); setNotice("사건 카드를 놓았어요."); }}>
      <Plus size={18} aria-hidden /><span>{choice}</span>
    </button>)}</div>
    <p role="status">카드 {chosen.length} / {choices.length}장 배치{notice && ` · ${notice}`}</p>
  </div>;
}

function OrderCard({ id, index, text, count, reduce, disabled, onMove, onRemove, onStart, onEnd }: {
  id: string; index: number; text: string; count: number; reduce: boolean; disabled: boolean;
  onMove: (offset: number) => void; onRemove: () => void; onStart: () => void; onEnd: (cancelled: boolean) => void;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  return <Reorder.Item value={id} initial={false} layout="position" transition={reduce ? { duration: motionTokens.duration.instant } : springs.snappy}
    className={s.orderCard} data-dragging={dragging} data-testid={`order-card-${id}`} dragListener={false} dragControls={controls} drag={reduce || disabled ? false : "y"}
    dragMomentum={false} onDragStart={() => { setDragging(true); onStart(); }} onDragEnd={(event) => { setDragging(false); onEnd(event.type === "pointercancel"); }}>
    <span className={s.index}>{index + 1}</span><p>{text}</p>
    <div className={s.reorder}>
      {!reduce && <button type="button" className={s.dragHandle} data-testid={`order-grip-${id}`} aria-label={`${index + 1}번째 카드 끌기`} disabled={disabled || count < 2}
        onPointerDown={(event) => { if (!disabled && count > 1) controls.start(event); }} onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); onMove(event.key === "ArrowUp" ? -1 : 1); }
        }}><GripVertical size={20} aria-hidden /></button>}
      <button type="button" aria-label={`${index + 1}번째 카드 위로`} disabled={disabled || index === 0} onClick={() => onMove(-1)}><ArrowUp size={18} /></button>
      <button type="button" aria-label={`${index + 1}번째 카드 아래로`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}><ArrowDown size={18} /></button>
      <button type="button" aria-label={`${index + 1}번째 카드 빼기`} disabled={disabled} onClick={onRemove}><X size={18} /></button>
    </div>
  </Reorder.Item>;
}
