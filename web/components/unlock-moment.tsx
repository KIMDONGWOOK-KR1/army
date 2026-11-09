"use client";
import type { CSSProperties } from "react";
import { ROLE_NAMES, ROLES, type Role } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import styles from "./unlock-moment.module.css";

// 기억의 자물쇠가 열리는 순간(네 사람이 말로 모은 숫자가 맞았을 때, 네 폰 모두에서 한 번).
// 네 보직 칸에 차례로 불이 들어오고 → 고리가 튀어 오르고 → 그 자리에 사초 도장이 찍힌다.
// 도장이 닿는 때(약 1.1초)는 사초 효과음(use-sound-cues의 'sacho', 1.1초 뒤)과 맞춘다.
// 사초 나레이션은 이 장면이 끝난 뒤에 연다(game-app). 움직임 줄이기에서는 바로 끝 모습만 보인다.
export const UNLOCK_MS = 2600;

export const unlockRevealClass = styles.reveal;

// 해설로 복원한 때(숫자 대신 네 사람이 해설을 읽음)는 그 말로 바꾼다
export function UnlockSeal({ char, order = ROLES, explained = false }: {
  char: string; order?: readonly Role[]; explained?: boolean;
}) {
  const caption = explained ? "네 사람이 해설을 함께 읽었어요" : "네 사람의 숫자가 맞았어요";
  return (
    <div className={styles.seal}>
      <p className={styles.srOnly} role="status">{caption}. 기억의 자물쇠가 열렸어요.</p>
      <div className={styles.lock} aria-hidden="true">
        <svg viewBox="0 0 120 140" className={styles.lockArt}>
          <path className={styles.shackle} d="M34 70 V44 a26 26 0 0 1 52 0 V70" />
          <rect className={styles.body} x="16" y="64" width="88" height="70" rx="16" />
          <circle className={styles.hole} cx="60" cy="93" r="9" />
          <path className={styles.hole} d="M55 98 h10 l-2 18 h-6 z" />
        </svg>
        <ol className={styles.pips}>
          {order.map((role, i) => {
            const Icon = ROLE_ICONS[role];
            return (
              <li key={role} title={ROLE_NAMES[role]}
                style={{ "--c": ROLE_COLORS[role], "--i": i } as CSSProperties}>
                <Icon size={17} strokeWidth={2.4} />
              </li>
            );
          })}
        </ol>
        <p className={styles.caption} aria-hidden="true">{caption}</p>
      </div>
      <span className={styles.ink} aria-hidden="true" />
      <div className={`sacho-character ${styles.char}`}>{char}</div>
    </div>
  );
}
