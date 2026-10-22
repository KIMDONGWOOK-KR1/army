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
  const full = lines.join("\n");
  const [shown, setShown] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  const done = shown >= full.length;
  const visibleText = full.slice(0, shown);
  const emphasisStart = emphasis === "last-line" ? full.lastIndexOf("\n") + 1 : 0;
  const emphasisEnd = emphasis === "first-line" && full.includes("\n") ? full.indexOf("\n") : full.length;
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
  // 자동 시연: 다 쳐지면 잠시 보여 주고 닫는다.
  useEffect(() => {
    if (!auto || !done) return;
    const t = window.setTimeout(() => close.current(), 2200);
    return () => window.clearTimeout(t);
  }, [auto, done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.repeat) {
        e.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="narration"
      data-narration-kind={kind}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => setShown(full.length)}
    >
      <p className="narration-label" aria-hidden="true">
        {label === "기록" ? "記錄" : label}
      </p>
      <p className="narration-sr">{lines.join(" ")}</p>
      <div className="narration-text" aria-hidden="true">
        {emphasis ? <>
          {visibleText.slice(0, emphasisStart)}
          <strong>{visibleText.slice(emphasisStart, emphasisEnd)}</strong>
          {visibleText.slice(emphasisEnd)}
        </> : visibleText}
        <span className="narration-caret" />
      </div>
      <button
        className="narration-close"
        autoFocus
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {done ? closeLabel : "건너뛰기"}
      </button>
    </div>
  );
}
