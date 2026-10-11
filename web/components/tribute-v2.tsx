"use client";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import { ROLE_NAMES, ROLES, type Command } from "@/supabase/functions/_shared/types";
import styles from "./tribute-v2.module.css";

type Props = { snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null> };

// 하얀 국화 한 송이. 꽃잎은 가운데를 중심으로 돌려 겹친다.
function Chrysanthemum({ className }: { className?: string }) {
  const petals = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg className={className} viewBox="0 0 64 120" aria-hidden="true">
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

/** 추모의 벽: 문제 없이 소개를 읽고 각자 국화 한 송이를 올린다. 점수·숫자·카운트다운은 두지 않는다. */
export function TributePanel({ snapshot, busy, send }: Props) {
  const { self, game, stage } = snapshot;
  const step = self.mission?.steps[0];
  if (!self.role || !step || stage.completion.type !== "tribute") return null;
  const offered = game.report_mask;
  const mine = offered[ROLES.indexOf(self.role)];
  const count = offered.filter(Boolean).length;
  const closed = game.site_phase === "cleared" || game.status === "done";
  const nickname = (role: (typeof ROLES)[number]) =>
    game.members.find((m) => m.role === role)?.nickname ?? ROLE_NAMES[role];
  return (
    <section className={styles.root} data-testid="tribute">
      <div className={styles.wall} aria-hidden="true">
        <span className={styles.lines} />
      </div>
      <h2 className={styles.title}>{stage.name}</h2>
      <p className={styles.intro}>{self.mission!.intro.text}</p>
      <ul className={styles.altar} aria-label="올린 국화">
        {ROLES.map((role, i) => (
          <li key={role} className={offered[i] ? styles.laid : styles.empty}>
            {offered[i] ? <Chrysanthemum className={styles.flower} /> : <span className={styles.slot} />}
            <span className={styles.name}>{nickname(role)}</span>
          </li>
        ))}
      </ul>
      <p className={styles.count} role="status" aria-live="polite">
        {count === 4 ? "네 사람 모두 국화를 올렸다." : `국화 ${count}송이`}
      </p>
      {!mine && !closed ? (
        <button
          type="button"
          className="button primary full"
          disabled={busy}
          onClick={() => void send({ action: "submit-step", stage_id: stage.id, step_id: step.id, answer: "confirmed", method: "field" })}
        >
          {stage.completion.label}
        </button>
      ) : (
        <p className={styles.after}>
          {count === 4 ? "잠시 머물며 그날을 기억하자." : "국화를 올렸다. 동료들이 마음을 전하는 동안 조용히 기다리자."}
        </p>
      )}
    </section>
  );
}
