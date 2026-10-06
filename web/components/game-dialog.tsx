"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function GameDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="game-dialog"
      aria-label={title}
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="닫기"
          onClick={() => ref.current?.close()}
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
