"use client";
import { useEffect, useRef, useState } from "react";
import { play } from "@/lib/sound";

// 흑백 타자 화면. 탭하면 글자를 모두 보이고, 버튼으로 닫는다.
export function Narration({
  lines,
  onClose,
  auto = false,
}: {
  lines: string[];
  onClose: () => void;
  auto?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    modal?.querySelector<HTMLButtonElement>(".narration-close")?.focus();
    return () => { modal?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const full = lines.join("\n");
  const [shown, setShown] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  const done = shown >= full.length;
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      setShown(full.length);
  }, [full]);
  useEffect(() => {
    if (done) return;
    const ch = full[shown];
    const t = window.setTimeout(
      () => {
        setShown((n) => n + 1);
        // 타자 소리는 소리 엔진을 거친다(소리 끄기를 따른다)
        if (ch && ch.trim()) play("typewriter");
      },
      ch === "\n" ? 420 : 55,
    );
    return () => window.clearTimeout(t);
  }, [shown, done, full]);
  useEffect(() => {
    if (!auto || !done) return;
    const timer = window.setTimeout(() => close.current(), 2200);
    return () => window.clearTimeout(timer);
  }, [auto, done]);
  return (
    <dialog ref={dialog} className="narration" aria-label="기록" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="narration-header">
        <p className="narration-label" aria-hidden="true">記錄</p>
        <span>기억을 여는 이야기</span>
      </header>
      <div className="narration-body" tabIndex={0} role="region" aria-label="기록 본문" onClick={() => setShown(full.length)}>
        <p className="narration-sr">{lines.join(" ")}</p>
        <div className="narration-text" aria-hidden="true">
          {lines.map((line, index) => {
            const offset = lines.slice(0, index).reduce((n, text) => n + text.length + 1, 0);
            const count = Math.max(0, shown - offset);
            return <p key={index}>{line.slice(0, count)}<span className="narration-pending">{line.slice(count)}</span></p>;
          })}
        </div>
      </div>
      <footer className="narration-footer">
        {!done && <button className="narration-reveal" onClick={() => setShown(full.length)}>한 번에 읽기</button>}
        <button className="narration-close" onClick={onClose}>{done ? "계속" : "건너뛰기"}</button>
      </footer>
    </dialog>
  );
}
