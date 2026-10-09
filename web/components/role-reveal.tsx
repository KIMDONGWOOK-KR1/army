"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { ROLE_COLORS, ROLE_ICONS } from "./role-style";
import type { RevealStep } from "./gather-stage";
import { ROLE_NAMES, type Role } from "@/supabase/functions/_shared/types";

// 보직 공개: 엎어 둔 카드 넉 장을 섞고, 한 장이 올라와 뒤집히면 내 보직(색·아이콘·이름)이 보인다.
// 보직은 서버가 이미 정했다(start-game). 이 화면은 받은 보직을 보여 주기만 하고 고르지 않는다.
// 약 3.4초. 누르면 바로 결과로 넘어가고, 움직임 줄이기 설정이면 처음부터 결과만 보인다.
// 위를 덮는 화면(나레이션)이 떠 있는 동안은 시작하지 않고 기다린다.

export type RevealCue = "shuffle" | "flip" | "team";
type Stage = "deal" | "s1" | "s2" | "s3" | "lift" | "flip" | "team" | "done";
const TIMELINE: [Stage, number][] = [
  ["s1", 420],
  ["s2", 780],
  ["s3", 1140],
  ["lift", 1500],
  ["flip", 1950],
  ["team", 2550],
  ["done", 3400],
];
// 섞는 동안 카드 넉 장이 서는 칸(카드 번호 → 칸). 마지막에 올라오는 카드는 1번.
const ORDER: Record<"deal" | "s1" | "s2" | "s3", number[]> = {
  deal: [0, 1, 2, 3],
  s1: [2, 3, 0, 1],
  s2: [1, 0, 3, 2],
  s3: [3, 1, 0, 2],
};
const CHOSEN = 1;
const AFTER = (s: Stage) => TIMELINE.findIndex(([x]) => x === s);
const reached = (now: Stage, s: Stage) =>
  now === "deal" ? false : AFTER(now) >= AFTER(s);

export function RoleReveal({
  role,
  nickname,
  paused,
  skip = false,
  onStep,
  onDone,
  onCue,
}: {
  role: Role;
  nickname: string;
  paused: boolean;
  skip?: boolean; // 바로 결과만(건너뛰기, 이미 본 공개)
  onStep: (step: RevealStep) => void; // 입체 장병 소품을 보이는 범위
  onDone: () => void;
  // 소리 모듈이 붙을 자리: 섞기·뒤집기·팀 공개 순간(play('role-reveal') 등)
  onCue?: (cue: RevealCue) => void;
}) {
  const [stage, setStage] = useState<Stage>(skip ? "done" : "deal");
  const cb = useRef({ onStep, onDone, onCue });
  cb.current = { onStep, onDone, onCue };
  const done = useRef(false),
    timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const finish = () => {
    clear();
    setStage("done");
    if (done.current) return;
    done.current = true;
    cb.current.onStep("all");
    cb.current.onDone();
  };
  useEffect(() => {
    if (skip) finish();
  }, [skip]);
  useEffect(() => {
    if (paused || done.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    // 나레이션이 닫히면(다시 시작할 때) 처음부터 섞는다
    setStage("deal");
    timers.current = TIMELINE.map(([s, ms]) =>
      window.setTimeout(() => {
        if (s === "done") {
          finish();
          return;
        }
        setStage(s);
        if (s === "s1") cb.current.onCue?.("shuffle");
        if (s === "flip") {
          cb.current.onStep("self");
          cb.current.onCue?.("flip");
        }
        if (s === "team") {
          cb.current.onStep("all");
          cb.current.onCue?.("team");
        }
      }, ms),
    );
    return clear;
  }, [paused]);
  const Icon = ROLE_ICONS[role];
  const flipped = reached(stage, "flip");
  const slots =
    stage === "deal" || stage === "s1" || stage === "s2" || stage === "s3"
      ? ORDER[stage]
      : ORDER.s3;
  return (
    <div
      className={`reveal-deck stage-${stage}`}
      data-flipped={flipped}
      onClick={() => {
        if (stage !== "done") finish();
      }}
    >
      {[0, 1, 2, 3].map((card) => {
        const chosen = card === CHOSEN;
        const lifted = chosen && reached(stage, "lift");
        const away = !chosen && reached(stage, "lift");
        return (
          <div
            key={card}
            className={`reveal-card ${lifted ? "lifted" : ""} ${away ? "away" : ""} ${chosen && flipped ? "flipped" : ""}`}
            style={
              {
                "--slot": slots[card] - 1.5,
                "--i": card,
                "--role": ROLE_COLORS[role],
              } as CSSProperties
            }
            aria-hidden={!chosen || !flipped}
          >
            <div className="reveal-card-inner">
              <div className="reveal-face back">
                <span className="reveal-seal">記</span>
              </div>
              {chosen && (
                <div className="reveal-face front">
                  <span className="reveal-role-icon">
                    <Icon size={34} aria-hidden="true" />
                  </span>
                  <b className="reveal-role-name">{ROLE_NAMES[role]}</b>
                  <span className="reveal-owner">{nickname}의 보직</span>
                  <span className="reveal-stamp" aria-hidden="true">
                    記
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <p className="reveal-live" aria-live="polite">
        {flipped ? `${nickname}의 보직은 ${ROLE_NAMES[role]}이다.` : ""}
      </p>
    </div>
  );
}
