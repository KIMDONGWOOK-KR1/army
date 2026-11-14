"use client";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import s from "./dogam.module.css";

/** 가운데 안내창. native dialog로 배경 조작을 막고 초점·Escape·복귀를 함께 처리한다. */
export function MissionDialog({ children, label, onClose, className, style, testId }: {
  children: ReactNode; label: string; onClose?: () => void;
  className?: string; style?: CSSProperties; testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`${s.modal} ${className ?? ""}`} style={style} aria-label={label}
    data-testid={testId} onCancel={(e) => { e.preventDefault(); onClose?.(); }}
    onKeyDown={(e) => {
      if (e.key !== "Tab") return;
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")]
        .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}
    onClick={(e) => {
      if (!onClose || e.target !== e.currentTarget) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }}>
    {children}
  </dialog>;
}

/** 체크 그리기 → 작은 빛 번짐. 역사 해설을 가리지 않는 짧은 성공 동작. */
export function SuccessMark() {
  return <div className={s.successMark} aria-hidden="true">
    <span className={s.successHalo} />
    <svg viewBox="0 0 64 64" focusable="false">
      <circle cx="32" cy="32" r="28" />
      <path d="m19 32 9 9 18-19" pathLength="1" />
    </svg>
    {Array.from({ length: 6 }, (_, i) => <i key={i} style={{ "--angle": `${i * 60}deg` } as CSSProperties} />)}
  </div>;
}
