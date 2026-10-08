"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, Footprints, X } from "lucide-react";
import { ROLES, type SiteInfo } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import { play } from "@/lib/sound";

// 거점에 처음 도착하면 나레이션보다 먼저 한 번 뜨는 '거점 원판' 화면.
// 포켓몬고 포켓스톱의 구성(하늘 배경·둥근 사진 원판·돌리면 열리는 방울)을 빌리되,
// 그림·이름은 우리 것만 쓴다. 추모 거점(reverent)에서는 반짝임·튕김 없이 차분하게 연다.

// 거점 한 줄 설명. 나레이션·힌트에 이미 쓰인 공개 사실만 두고, 단서의 답이 되는 값은 넣지 않는다.
const LINES: Record<string, string> = {
  gate: "5·18 사적지 · 추모의 마음으로 머물러라.",
  yongbong: "1957년에 세운 옛 대학 본부 · 오월의 기록을 품은 곳",
};

// 원판을 돌린 뒤 네 보직 방울이 내려앉는 자리(원판 지름 대비, 원판 가운데 기준)
const SETTLE = [
  { x: -0.4, y: 0.44 },
  { x: -0.14, y: 0.6 },
  { x: 0.14, y: 0.6 },
  { x: 0.4, y: 0.44 },
];
const TIMING = {
  lively: { spin: 1100, bubble: 650, stagger: 120, turn: 720 },
  calm: { spin: 1800, bubble: 1100, stagger: 260, turn: 360 },
};

// 같은 게임·거점에서는 한 번만 띄운다(새로고침해도 다시 띄우지 않는다).
// localStorage "hoguk:stop"="off"는 e2e 시험에서 이 화면을 끄는 스위치다.
const seenKey = (gameId: string, siteId: string) =>
  `hoguk:stop-seen:${gameId}:${siteId}`;

export function stopEnabled() {
  try {
    return localStorage.getItem("hoguk:stop") !== "off";
  } catch {
    return true;
  }
}

export function stopSeen(gameId: string, siteId: string) {
  try {
    return sessionStorage.getItem(seenKey(gameId, siteId)) === "1";
  } catch {
    return false;
  }
}

export function markStopSeen(gameId: string, siteId: string) {
  try {
    sessionStorage.setItem(seenKey(gameId, siteId), "1");
  } catch {}
}

export function StopScreen({
  site,
  total,
  auto = false,
  onClose,
}: {
  site: Pick<SiteInfo, "id" | "seq" | "name" | "reverent">;
  total: number;
  // 발표용 자동 시연: 스스로 원판을 돌리고 잠시 뒤 닫는다
  auto?: boolean;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    started = useRef(false),
    swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  close.current = onClose;
  const calm = site.reverent,
    t = calm ? TIMING.calm : TIMING.lively,
    line = LINES[site.id],
    id = useId(),
    [phase, setPhase] = useState<"idle" | "spin" | "open">("idle"),
    [dir, setDir] = useState(1),
    [face, setFace] = useState(true);
  const count = Math.max(1, total);

  // 원판 돌리기: 밀기·누르기·Enter·Space 모두 한 번만 받는다.
  // 움직임 줄이기를 켠 기기에서는 돌리지 않고 바로 연다.
  const spin = (direction: number) => {
    if (started.current) return;
    started.current = true;
    setDir(direction < 0 ? -1 : 1);
    setPhase(
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "open"
        : "spin",
    );
  };

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const box = root.current;
      if (!box) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      // 화면이 막 열려 초점이 대화상자 자체에 있을 때도 Enter·Space로 원판을 돌린다
      if (
        (e.key === "Enter" || e.key === " ") &&
        document.activeElement === box
      ) {
        e.preventDefault();
        spin(1);
        return;
      }
      if (e.key !== "Tab") return;
      // 대화상자 안에서만 초점이 돈다
      const items = Array.from(
        box.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      const first = items[0],
        last = items[items.length - 1],
        at = document.activeElement;
      if (!first) return;
      if (e.shiftKey && (at === first || at === box || !box.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !box.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 원판이 열리는 순간의 소리(추모 거점에서는 편경 한 번만 낮게)
  useEffect(() => {
    if (phase === "open") play("stop-open", { calm });
  }, [phase]);

  useEffect(() => {
    if (phase !== "spin") return;
    const timer = window.setTimeout(() => setPhase("open"), t.spin);
    return () => window.clearTimeout(timer);
  }, [phase, t.spin]);

  useEffect(() => {
    if (!auto || phase === "spin") return;
    const timer =
      phase === "idle"
        ? window.setTimeout(() => spin(1), 1400)
        : window.setTimeout(
            () => close.current(),
            t.bubble + t.stagger * (ROLES.length - 1) + 2400,
          );
    return () => window.clearTimeout(timer);
  }, [auto, phase]);

  return (
    <div
      ref={root}
      className={`stop-screen ${calm ? "calm" : ""}`}
      data-phase={phase}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={line ? `${id}-line` : undefined}
      tabIndex={-1}
      style={
        {
          "--spin-ms": `${t.spin}ms`,
          "--bubble-ms": `${t.bubble}ms`,
          "--stagger-ms": `${t.stagger}ms`,
          "--turn": `${dir * t.turn}deg`,
        } as CSSProperties
      }
    >
      <div className="stop-backdrop" aria-hidden="true">
        <i className="stop-ground" />
      </div>

      <div className="stop-head">
        <div>
          <h2 id={`${id}-title`}>{site.name}</h2>
          {line && <p id={`${id}-line`}>{line}</p>}
        </div>
        <button
          className="stop-round"
          aria-label="다음으로"
          onClick={() => close.current()}
        >
          <ChevronRight size={28} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>

      <div className="stop-center">
        <span className="stop-pill">{calm ? "단서 4" : "+ 단서 4"}</span>
        <div className="stop-stage">
          <button
            className="stop-disc"
            aria-label="원판 돌리기"
            aria-describedby={`${id}-hint`}
            aria-disabled={phase !== "idle"}
            onClick={() => spin(1)}
            onPointerDown={(e) => {
              swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const from = swipe.current;
              if (!from || from.id !== e.pointerId) return;
              const dx = e.clientX - from.x,
                dy = e.clientY - from.y;
              if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) {
                swipe.current = null;
                spin(dx);
              }
            }}
            onPointerUp={() => (swipe.current = null)}
            onPointerCancel={() => (swipe.current = null)}
          >
            {/* 단추는 제자리에 두고 안쪽 몸체만 떠오르고 돈다(누를 자리가 흔들리지 않게) */}
            <span className="stop-disc-body">
              <span className="stop-ring" />
              <span className="stop-ring gold" />
              <span className="stop-face">
                <span className="stop-seal">記</span>
                {face && (
                  <img
                    src={`/stops/${site.id}.webp`}
                    alt=""
                    draggable={false}
                    onError={() => setFace(false)}
                  />
                )}
              </span>
            </span>
          </button>
          {!calm && (
            <span className="stop-sparks" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ "--i": i } as CSSProperties} />
              ))}
            </span>
          )}
          <span className="stop-bubbles" aria-hidden="true">
            {ROLES.map((r, i) => {
              const Icon = ROLE_ICONS[r];
              return (
                <span
                  key={r}
                  className="stop-bubble"
                  style={
                    {
                      "--i": i,
                      "--c": ROLE_COLORS[r],
                      "--x": SETTLE[i].x,
                      "--y": SETTLE[i].y,
                    } as CSSProperties
                  }
                >
                  <span>
                    <Icon size={26} strokeWidth={2.4} />
                  </span>
                </span>
              );
            })}
          </span>
        </div>
        <p className="stop-line" id={`${id}-hint`} aria-live="polite">
          <span key={phase === "open" ? "open" : "hint"}>
            {phase === "open"
              ? "네 보직의 단서를 받았다."
              : "원판을 밀어 기록을 펼쳐라"}
          </span>
        </p>
      </div>

      <div className="stop-foot">
        <div className="stop-progress">
          <span className="stop-progress-icon" aria-hidden="true">
            <Footprints size={20} />
          </span>
          <span className="stop-progress-text">
            <b>
              기억의 흔적 {site.seq}/{count}
            </b>
            <span
              className="stop-progress-bar"
              role="progressbar"
              aria-label="기억의 흔적"
              aria-valuemin={0}
              aria-valuemax={count}
              aria-valuenow={site.seq}
            >
              <i style={{ width: `${(site.seq / count) * 100}%` }} />
            </span>
          </span>
        </div>
        <button
          className="stop-round stop-close"
          aria-label="닫고 계속"
          onClick={() => close.current()}
        >
          <X size={28} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
