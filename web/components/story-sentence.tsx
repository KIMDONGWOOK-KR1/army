"use client";
import { useEffect, useRef, useState } from "react";
import { motion, useDragControls, type PanInfo } from "motion/react";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { Check, GripVertical, Plus } from "lucide-react";
import { motionTokens, springs } from "@/lib/motion-tokens";
import s from "./closing-v2.module.css";

/** Participant choices only; there is no preferred or prefilled combination. */
export function StorySentence({ words, choices, onChange, disabled = false }: { words: string[]; choices: string[]; onChange: (words: string[]) => void; disabled?: boolean }) {
  const [slot, setSlot] = useState(0);
  const [hover, setHover] = useState<number | null>(null), [epoch, setEpoch] = useState(0), [notice, setNotice] = useState("");
  const targets = useRef<(HTMLButtonElement | null)[]>([]);
  const reduce = useMotionPreference();
  useEffect(() => { setHover(null); }, [reduce, disabled]);
  useEffect(() => {
    const cancel = () => { setEpoch((n) => n + 1); setHover(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("keydown", key); window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const hit = (info: PanInfo) => {
    const x = info.point.x - window.scrollX, y = info.point.y - window.scrollY;
    return targets.current.findIndex((node) => {
      if (!node) return false;
      const r = node.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  };
  const place = (word: string, target: number) => {
    if (disabled || target < 0 || target >= words.length) return;
    onChange(words.map((v, n) => n === target ? word : v)); setSlot(target);
    setNotice(`${target + 1}번째 자리에 낱말을 놓았어요.`);
  };
  return <div className={s.wordTray} data-testid="story-word-tray">
    <p>{reduce ? "빈칸을 누르고, 우리 팀의 낱말을 놓으세요." : "낱말 손잡이를 빈칸으로 끌어 놓으세요. 빈칸과 낱말을 차례로 눌러도 돼요."}</p>
    <div className={s.wordSpaces}>{words.map((word, i) => <button type="button" key={i} ref={(node) => { targets.current[i] = node; }}
      disabled={disabled} aria-label={`낱말 자리 ${i + 1}`} aria-pressed={slot === i} data-drop-target={hover === i}
      onClick={() => setSlot(i)}><span>{i + 1}</span>{word ? <motion.strong key={word} initial={{ opacity: 1, scale: 1 }}
        animate={reduce ? { opacity: 1 } : { scale: [1, motionTokens.scale.pop, 1] }} transition={{ duration: motionTokens.duration.fast }}>{word}</motion.strong> : <Plus size={24} aria-hidden />}</button>)}</div>
    <div className={s.wordMagnets} key={`${epoch}-${reduce}-${disabled}`}>{choices.map((word, i) => <WordMagnet key={word} word={word} index={i}
      selected={words[slot] === word} reduce={reduce} disabled={disabled} onPlace={() => place(word, slot)}
      onOver={(info) => { const target = hit(info); setHover(target < 0 ? null : target); }}
      onDrop={(info, cancelled) => {
        setHover(null); const target = cancelled ? -1 : hit(info);
        if (target >= 0) place(word, target); else setNotice("빈칸에 놓으면 문장에 들어가요.");
      }} />)}</div>
    <p className="sr-only" role="status">{notice}</p>
  </div>;
}

function WordMagnet({ word, index, selected, reduce, disabled, onPlace, onOver, onDrop }: {
  word: string; index: number; selected: boolean; reduce: boolean; disabled: boolean;
  onPlace: () => void; onOver: (info: PanInfo) => void; onDrop: (info: PanInfo, cancelled: boolean) => void;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  return <motion.div className={s.wordMagnet} data-dragging={dragging} initial={false} drag={!reduce && !disabled} dragControls={controls} dragListener={false}
    dragSnapToOrigin dragMomentum={false} dragTransition={{ bounceStiffness: springs.release.stiffness, bounceDamping: springs.release.damping }}
    transition={springs.release} onDragStart={() => setDragging(true)} onDrag={(_, info) => onOver(info)}
    onDragEnd={(event, info) => { setDragging(false); onDrop(info, event.type === "pointercancel"); }}>
    <button type="button" disabled={disabled} data-testid={`joint-word-${index + 1}`} aria-pressed={selected} onClick={onPlace}>
      {word}{selected && <Check size={16} aria-hidden />}
    </button>
    {!reduce && <button type="button" disabled={disabled} className={s.wordGrip} data-testid={`joint-grip-${index + 1}`} aria-label={`낱말 ${index + 1} 끌기`}
      onPointerDown={(event) => { if (!disabled) controls.start(event); }}><GripVertical size={20} aria-hidden /></button>}
  </motion.div>;
}
