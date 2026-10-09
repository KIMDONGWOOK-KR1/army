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
  // 자동 시연: 다 쳐지면 잠시 보여 주고 닫는다.
  useEffect(() => {
    if (!auto || !done) return;
    const t = window.setTimeout(() => close.current(), 2200);
    return () => window.clearTimeout(t);
  }, [auto, done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="narration"
      role="dialog"
      aria-modal="true"
      aria-label="기록"
      onClick={() => setShown(full.length)}
    >
      <p className="narration-label" aria-hidden="true">
        記錄
      </p>
      <p className="narration-sr">{lines.join(" ")}</p>
      <div className="narration-text" aria-hidden="true">
        {full.slice(0, shown)}
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
        {done ? "계속" : "건너뛰기"}
      </button>
    </div>
  );
}
