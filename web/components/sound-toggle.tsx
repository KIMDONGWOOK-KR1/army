"use client";
import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isMuted, play, setMuted, subscribeMuted, unlock } from "@/lib/sound";

// 소리 켜기·끄기. 상단 바에는 아이콘만, 작전 메뉴에는 글자와 함께 둔다.
// 서버 그림에서는 켠 상태로 그리고, 브라우저에서 저장된 값으로 바로 바꾼다.
export function SoundToggle({ variant = "icon" }: { variant?: "icon" | "menu" }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const toggle = () => {
    setMuted(!muted);
    if (muted) {
      unlock();
      play("confirm");
    }
  };
  const Icon = muted ? VolumeX : Volume2;
  if (variant === "menu")
    return (
      <button
        className="button secondary full"
        data-sound="none"
        onClick={toggle}
      >
        {muted ? "효과음·배경음 켜기" : "효과음·배경음 끄기"}
        <Icon size={18} />
      </button>
    );
  return (
    <button
      className="icon-button sound-toggle"
      aria-label={muted ? "소리 켜기" : "소리 끄기"}
      data-sound="none"
      onClick={toggle}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
