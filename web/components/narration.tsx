"use client";
import { useEffect, useRef, useState } from "react";
import { play } from "@/lib/sound";

// 흑백 타자 화면. 탭하면 글자를 모두 보이고, 버튼으로 닫는다.
export function Narration({
  lines,
  onClose,
  auto = false,
  label = "기록",
  closeLabel = "계속",
  kind = "common",
  emphasis,
}: {
  lines: string[];
  onClose: () => void;
  auto?: boolean;
  label?: string;
  closeLabel?: string;
  kind?: "common" | "personal";
  emphasis?: "first-line" | "last-line";
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
  // Reserve the complete sentence layout so typing does not move words between lines.
  const reveal = (start: number, end: number) => {
    const text = full.slice(start, end);
    const count = Math.max(0, shown - start);
    return <>{text.slice(0, count)}<span style={{ visibility: "hidden" }}>{text.slice(count)}</span></>;
  };
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
    <dialog ref={dialog} className="narration" data-narration-kind={kind} aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="narration-header">
        <p className="narration-label" aria-hidden="true">{label === "기록" ? "記錄" : label}</p>
        <span>{kind === "personal" ? "나에게 전해진 임무" : "기억을 여는 이야기"}</span>
      </header>
      <div className="narration-body" tabIndex={0} role="region" aria-label={`${label} 본문`} onClick={() => setShown(full.length)}>
        <p className="narration-sr">{lines.join(" ")}</p>
        <div className="narration-text" aria-hidden="true">
          {full.split("\n").map((line, index, paragraphs) => {
            const start = paragraphs.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
            const emphasized = emphasis === "first-line" ? index === 0
              : emphasis === "last-line" && index === paragraphs.length - 1;
            const text = reveal(start, start + line.length);
            return <p className="narration-line" key={index}>
              {emphasized ? <strong>{text}</strong> : text}
              {index === paragraphs.length - 1 && <span className="narration-caret" style={{ visibility: done ? "visible" : "hidden" }} />}
            </p>;
          })}
        </div>
      </div>
      <footer className="narration-footer">
        {!done && <button className="narration-reveal" onClick={() => setShown(full.length)}>한 번에 읽기</button>}
        <button className="narration-close" onClick={onClose}>{done ? closeLabel : "건너뛰기"}</button>
      </footer>
    </dialog>
  );
}
