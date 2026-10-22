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
        {full.split("\n").map((line, index, paragraphs) => {
          const start = paragraphs.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
          const emphasized = emphasis === "first-line" ? index === 0
            : emphasis === "last-line" && index === paragraphs.length - 1;
          const text = reveal(start, start + line.length);
          return <span className="narration-line" key={index}>
            {emphasized ? <strong>{text}</strong> : text}
            {index === paragraphs.length - 1 && <span className="narration-caret" style={{ visibility: done ? "visible" : "hidden" }} />}
            {index < paragraphs.length - 1 ? "\n" : null}
          </span>;
        })}
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
