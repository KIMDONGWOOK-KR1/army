"use client";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import { soloFor } from "@/lib/client";
import { play } from "@/lib/sound";
import { ROLE_NAMES, ROLES, type Command, type Role } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS } from "./role-style";
import styles from "./tribute-v2.module.css";

const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동 없음 */ } };
const RING = 2 * Math.PI * 54;
const offeredKey = (gameId: string, stageId: string) => `hoguk:tribute-offered:${gameId}:${stageId}`;
function readOffered(key: string) { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } }
// 헌화 뒤 흩날리는 꽃잎(자리·늦춤은 고정값)
const PETALS = Array.from({ length: 12 }, (_, i) => ({ x: 6 + ((i * 37) % 88), d: 0.2 + (i % 6) * 0.35, r: (i * 53) % 360, sway: (i % 2 ? 1 : -1) * (14 + (i % 4) * 6) }));

/** 동그란 누르기 단추: 넷의 자리가 고리 네 칸으로 켜지고, 넷이 모이면 고리가 15초 동안 줄어든다. */
function HoldButton({ holding, open, remainingMs, pressed, roles, label, handlers }: {
  holding: boolean; open: boolean; remainingMs: number; pressed: boolean[]; roles: readonly Role[]; label: string;
  handlers: Record<string, unknown>;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const left = Math.max(0, Math.min(1, remainingMs / 15000));
  const seg = RING / 4;
  return <div className={styles.holdWrap} data-holding={holding || undefined} data-open={open || undefined}>
    <button type="button" className={styles.hold} data-testid="tribute-hold" aria-pressed={holding} aria-label={label}
      style={{ touchAction: "none", userSelect: "none", WebkitTouchCallout: "none" }} {...handlers}>
      <span className={styles.ripple} aria-hidden="true" />
      <span className={styles.ripple} aria-hidden="true" />
      <svg className={styles.holdRing} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r="54" className={styles.holdTrack} />
        {open
          ? <circle cx="60" cy="60" r="54" className={styles.holdTime} style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - left) }} />
          : roles.map((role, i) => <circle key={role} cx="60" cy="60" r="54" className={styles.holdSeat} data-on={pressed[i] || undefined}
            style={{ stroke: ROLE_COLORS[role], strokeDasharray: `${seg - 10} ${RING - seg + 10}`, strokeDashoffset: -(seg * i) - 5 }} />)}
      </svg>
      <span className={styles.core} aria-hidden="true">
        {open ? <><b>{seconds > 0 ? seconds : "·"}</b><small>{seconds > 0 ? "초" : "확인 중"}</small></>
          : <><span className={styles.candle}><span className={styles.flame} /></span><small>{holding ? "기다려요" : "누르고 있기"}</small></>}
      </span>
    </button>
  </div>;
}

type Props = {
  compact?: boolean;
  snapshot: V2Response;
  busy: boolean;
  /** 서버 시계에 맞춘 지금 시각(0.5초마다 갱신) */
  now: number;
  send: (command: Command) => Promise<GameResponse | null>;
};

// 하얀 국화 한 송이. 꽃잎은 가운데를 중심으로 돌려 겹친다.
function Chrysanthemum({ className, style }: { className?: string; style?: CSSProperties }) {
  const petals = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg className={className} style={style} viewBox="0 0 64 120" aria-hidden="true">
      <path d="M32 46 C31 70 33 92 32 118" stroke="#4f6b45" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M32 84 C22 78 16 80 12 86 C20 90 27 89 32 84Z" fill="#5f7d52" />
      <path d="M32 96 C42 90 48 92 52 98 C44 102 37 101 32 96Z" fill="#5f7d52" />
      {petals.map((deg) => (
        <ellipse key={`o${deg}`} cx="32" cy="16" rx="4.2" ry="14" fill="#fbf8ef" stroke="#d9d2bf" strokeWidth="0.8"
          transform={`rotate(${deg} 32 30)`} />
      ))}
      {petals.map((deg) => (
        <ellipse key={`i${deg}`} cx="32" cy="22" rx="3" ry="8.5" fill="#fffdf7" stroke="#e3dccb" strokeWidth="0.6"
          transform={`rotate(${deg + 11} 32 30)`} />
      ))}
      <circle cx="32" cy="30" r="4.5" fill="#efe3b8" />
    </svg>
  );
}

function HoldIncense({ remaining }: { remaining: number }) {
  const [initial] = useState(remaining);
  return <div className={styles.incense} aria-hidden="true"
    style={{ "--burn": "15000ms", "--burned": `${Math.min(0, initial - 15000)}ms` } as CSSProperties}>
    <span className={styles.stick}><span className={styles.smoke} /><span className={styles.ember} /></span><span className={styles.bowl} />
  </div>;
}

/** Press leases are renewed only while the physical pointer/key remains down. */
export function TributePanel({ snapshot, busy, now, send, compact = false }: Props) {
  const { self, game, stage } = snapshot;
  const step = self.mission?.steps[0];
  const done = !!game.completion || game.site_phase === "cleared" || game.status === "done";
  const solo = !!soloFor(game.id);
  const held = useRef<string | null>(null), input = useRef<string | null>(null);
  const [holding, setHolding] = useState(false);
  const queue = useRef(Promise.resolve());
  const wake = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ send, done, busy, step, stage, solo, role: self.role });
  latest.current = { send, done, busy, step, stage, solo, role: self.role };
  const release = () => {
    held.current = null; input.current = null;
    if (mounted.current) setHolding(false);
    wake.current?.();
  };
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release); window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; release(); window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release); document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => { if (done) release(); }, [done]);
  const begin = (source: string) => {
    if (held.current || latest.current.done || latest.current.busy || !step) return;
    const id = crypto.randomUUID(); held.current = id; input.current = source; setHolding(true);
    const command = (action: string): Command => ({ action: "submit-step", stage_id: stage.id, step_id: step.id,
      answer: `${action}:${id}`, ...(solo ? { simulated: true } : {}) });
    queue.current = queue.current.then(async () => {
      let action = "start", completed = false;
      try {
        while (held.current === id && !latest.current.done) {
          const res = await latest.current.send(command(action));
          if (!res) break;
          if ("stage" in res && (res.game.completion || res.game.site_phase === "cleared")) { completed = true; break; }
          if ("stage" in res && latest.current.role && !res.game.tribute?.pressed[ROLES.indexOf(latest.current.role)]) break;
          action = "hold";
          if (held.current !== id) break;
          await new Promise<void>(resolve => { const timer = setTimeout(() => { wake.current = null; resolve(); }, 800);
            wake.current = () => { clearTimeout(timer); wake.current = null; resolve(); }; });
        }
      } finally {
        if (held.current === id) release();
        if (!completed && !latest.current.done) await latest.current.send(command("release"));
      }
    }).catch(() => { if (held.current === id) release(); });
  };
  // 헌화(hh 2026-11-10): 실제 참배 순서(헌화 → 분향 → 묵념)를 따른다. 각자 국화를 밀어 올려 먼저 헌화하고,
  // 넷이 함께 15초 누르는 동안 향이 탄다(분향). 추모가 끝난 뒤 제단에 네 송이가 함께 놓인다.
  // 이 폰에서 헌화 전에 추모가 끝났다면(새로 고침 등) 끝난 뒤에 손에서 올린다.
  const offerKey = offeredKey(game.id, stage.id);
  const [offer, setOffer] = useState<"wait" | "flying" | "rest">(() => (readOffered(offerKey) ? "rest" : "wait"));
  const [lift, setLift] = useState(0);
  const liftFrom = useRef<number | null>(null);
  const offeredAfterDone = useRef(false);
  const offerNow = () => {
    if (offer !== "wait") return;
    try { sessionStorage.setItem(offerKey, "1"); } catch { /* 이 화면에서만 */ }
    offeredAfterDone.current = done;
    setOffer("flying"); setLift(0); liftFrom.current = null;
    play("digit-reveal"); buzz([20, 60, 20]);
  };
  useEffect(() => {
    if (offer !== "flying" || offeredAfterDone.current) return;
    const t = window.setTimeout(() => setOffer("rest"), 1300);
    return () => window.clearTimeout(t);
  }, [offer]);
  useEffect(() => {
    if (offer !== "flying" || !offeredAfterDone.current) return;
    const t = window.setTimeout(() => window.dispatchEvent(new CustomEvent("hoguk:tribute-laid", { detail: { stageId: stage.id } })), 3600);
    return () => window.clearTimeout(t);
  }, [offer, stage.id]);
  const liftDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (offer !== "wait") return;
    e.currentTarget.setPointerCapture(e.pointerId); liftFrom.current = e.clientY;
  };
  const liftMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (liftFrom.current === null) return;
    const dy = Math.min(0, e.clientY - liftFrom.current);
    setLift(dy);
    if (dy < -80) offerNow();
  };
  const liftUp = () => { if (liftFrom.current !== null) { liftFrom.current = null; setLift(0); } };
  const tribute = game.tribute;
  const startedAt = tribute?.started_at ?? null;
  const open = !done && startedAt !== null;
  const pressed = done ? ROLES.map(() => true) : tribute?.pressed ?? ROLES.map(() => false);
  const count = pressed.filter(Boolean).length;
  const remaining = Math.min(15, Math.max(0, Math.ceil(((tribute?.ends_at ?? now) - now) / 1000)));
  const missed = !done && !open && !!tribute?.missed;
  if (!self.role || !step || stage.completion.type !== "tribute") return null;
  const nickname = (role: (typeof ROLES)[number]) =>
    game.members.find((m) => m.role === role)?.nickname ?? ROLE_NAMES[role];
  const offered = offer !== "wait";
  const altarView = !done ? undefined : !offered ? "wait" : offer === "flying" && offeredAfterDone.current ? "flying" : "together";
  const rite = done ? 4 : offered ? 2 : 1;
  const status = done ? offer === "wait" ? "네 사람의 마음이 모였다. 내 국화를 제단에 올려 드리자."
      : "네 사람의 국화가 제단에 놓였다."
    : !offered ? "먼저 각자 국화 한 송이를 올린다. 국화를 위로 밀어 올리자."
    : open ? remaining > 0 ? `향이 타는 동안 벽에 새긴 이름 하나를 찾아 마음속으로 읽는다. ${remaining}초 남았다.` : "손을 떼지 않고 마지막 참여 확인을 기다린다."
    : missed ? "누름이 끊겨 시간이 초기화됐다. 다시 네 사람이 함께 누르자."
    : `네 사람이 모두 누르면 15초가 시작된다. 지금 ${count}명이 누르고 있다.`;
  return (
    <section className={`${styles.root}${compact ? ` ${styles.compact}` : ""}`} data-testid="tribute" data-state={done ? "done" : open ? "open" : missed ? "missed" : "idle"}>
      {!compact && <>
      <div className={styles.wall} aria-hidden="true">
        <span className={styles.lines} />
      </div>
      <h2 className={styles.title}>{stage.name}</h2>
      <p className={styles.intro}>{done ? "네 사람이 함께 추모를 마쳤다. 국화를 제단에 올려 넋을 기린다." : "각자 국화를 올린 뒤, 네 사람이 가운데 동그라미를 누른 채로 15초 동안 함께 분향한다. 한 명이라도 손을 떼면 처음부터 다시 시작한다."}</p>
      <ul className={`${styles.altar}${done ? ` ${styles.laying}` : ""}`} aria-label="추모한 사람" data-offer={altarView}>
        {ROLES.map((role, i) => {
          const me = role === self.role;
          const others = ROLES.filter((r) => r !== self.role);
          const order = me ? 0 : others.indexOf(role) + 1;
          return <li key={role} className={done ? styles.laid : pressed[i] ? styles.joined : styles.empty} data-me={me || undefined}
            style={{ "--col": 1.5 - i, "--order": order } as CSSProperties}>
            {done ? (
              <span className={styles.flowerSpot}>
                {me && altarView === "wait"
                  ? <button type="button" className={styles.hand} style={{ "--lift": `${lift}px` } as CSSProperties}
                    aria-label="국화 올리기" onClick={offerNow}
                    onPointerDown={liftDown} onPointerMove={liftMove} onPointerUp={liftUp} onPointerCancel={liftUp}>
                    <Chrysanthemum className={styles.flower} />
                  </button>
                  : <Chrysanthemum className={styles.flower} />}
                {(altarView === "flying" || altarView === "together") && <span className={styles.bloomGlow} aria-hidden="true" />}
              </span>
            ) : (
              <span className={styles.slot} data-flower={me && offered ? true : undefined}>
                {me && offered ? <Chrysanthemum className={styles.slotFlower} /> : pressed[i] && <span className={styles.flame} />}
              </span>
            )}
            <span className={styles.name}>{me ? "나" : nickname(role)}</span>
            <span className={styles.srOnly}>{done ? (me && offer === "wait" ? "올릴 국화" : "국화") : pressed[i] ? "추모함" : "기다림"}</span>
          </li>;
        })}
        {done && offer === "wait" && <li className={styles.offerHint} aria-hidden="true">
          <span className={styles.offerArrow}>↑</span>국화를 위로 밀어 올려요
        </li>}
        {(altarView === "flying" || altarView === "together") && <li className={styles.petals} aria-hidden="true">
          {PETALS.map((p, k) => <i key={k} style={{ "--x": `${p.x}%`, "--d": `${p.d}s`, "--r": `${p.r}deg`, "--sway": `${p.sway}px` } as CSSProperties} />)}
        </li>}
      </ul>
      </>}
      <ol className={styles.rite} aria-label="참배 순서">
        {["헌화", "분향", "묵념"].map((name, i) => <li key={name} data-on={rite === i + 1 || undefined} data-done={rite > i + 1 || undefined}
          aria-current={rite === i + 1 ? "step" : undefined}><b>{i + 1}</b>{name}</li>)}
      </ol>
      {!done && !offered && <div className={styles.offerRow}>
        <button type="button" className={styles.offerFlower} style={{ "--lift": `${lift}px` } as CSSProperties}
          aria-label="국화 올리기" onClick={offerNow}
          onPointerDown={liftDown} onPointerMove={liftMove} onPointerUp={liftUp} onPointerCancel={liftUp}>
          <Chrysanthemum className={styles.flower} />
        </button>
        <p><span className={styles.offerArrow} aria-hidden="true">↑</span> 국화를 위로 밀어 올려 헌화해요</p>
      </div>}
      {!done && offer === "flying" && <span className={styles.offerFly} aria-hidden="true"><Chrysanthemum className={styles.flower} /></span>}
      {!done && offered && <HoldButton holding={holding} open={open} pressed={pressed} roles={ROLES}
        remainingMs={open ? Math.max(0, (tribute?.ends_at ?? now) - now) : 15000}
        label={holding ? open ? remaining > 0 ? `${remaining}초 · 계속 누르고 있기` : "참여 확인 중 · 계속 누르고 있기" : "누르는 중 · 동료 기다리기" : "함께 누르고 있기"}
        handlers={{
          onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
          onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => { if (!e.isPrimary || e.button !== 0) return; e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId); buzz(15); begin(`pointer:${e.pointerId}`); },
          onPointerUp: (e: ReactPointerEvent) => { if (input.current === `pointer:${e.pointerId}`) release(); },
          onPointerCancel: (e: ReactPointerEvent) => { if (input.current === `pointer:${e.pointerId}`) release(); },
          onLostPointerCapture: (e: ReactPointerEvent) => { if (input.current === `pointer:${e.pointerId}`) release(); },
          onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => { const b = e.currentTarget.getBoundingClientRect();
            if (input.current === `pointer:${e.pointerId}` && (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom)) release(); },
          onKeyDown: (e: ReactKeyboardEvent) => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) begin(`key:${e.key}`); } },
          onKeyUp: (e: ReactKeyboardEvent) => { if (input.current === `key:${e.key}`) { e.preventDefault(); release(); } },
          onBlur: release,
        }} />}
      <div className={open ? styles.moment : undefined}>
        {open && !compact && <HoldIncense key={startedAt} remaining={Math.max(0, tribute!.ends_at! - now)} />}
        <p className={styles.after} role="status" aria-live="polite">{status}</p>
      </div>
      {solo && !done && <p className={styles.note}>혼자 체험에서는 내가 누르는 동안 시연 동료 셋도 함께 누른다.</p>}
    </section>
  );
}
