"use client";
// 넷이 한 그림(안 3을 안 2 마무리에 붙임): 보고하면 각자 폰에 거점 그림 한 조각이 돌아간 채로 뜬다.
// 조각을 눌러 바로 세우면 내 숫자가 보이고(내 폰에만), 네 사람이 자물쇠 순서대로 폰을 나란히 들면 그림 한 장이 된다.
// 지휘관 자물쇠 화면에는 보고한 동료의 조각이 차례로 바로 서고, 다 모이면 틈이 닫힌다. 숫자는 그림에 없다.
import { type CSSProperties, useEffect, useState } from "react";
import { Check, RotateCw } from "lucide-react";
import type { V2Response } from "@/lib/game-snapshot";
import { play } from "@/lib/sound";
import { PIECE_START_TURN, type DogamPage } from "@/lib/dogam";
import { ROLE_NAMES, ROLES, type Role } from "@/supabase/functions/_shared/types";
import { ROLE_COLORS } from "../role-style";
import { PictureShapes } from "./dogam-art";
import s from "./dogam.module.css";

const SLICE = 70;
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 진동이 없는 기기 */ } };
const orderOf = (snapshot: V2Response): Role[] =>
  snapshot.stage.completion.type === "lock" ? snapshot.stage.completion.order : [...ROLES];
const turnKey = (snapshot: V2Response) => `hoguk:dogam-piece:${snapshot.game.id}:${snapshot.stage.id}:${snapshot.self.role}`;

function Slice({ page, index }: { page: DogamPage; index: number }) {
  return <svg viewBox={`${index * SLICE} 0 ${SLICE} 200`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <PictureShapes picture={page.picture} />
  </svg>;
}

/** 보고 뒤 내 화면: 돌아간 조각을 눌러 세우면 숫자가 보인다. */
export function DogamPiece({ snapshot, page }: { snapshot: V2Response; page: DogamPage }) {
  const role = snapshot.self.role!;
  const order = orderOf(snapshot), index = Math.max(0, order.indexOf(role));
  const [turn, setTurn] = useState(PIECE_START_TURN[role]);
  // 한 번 세운 조각은 이 기기에서 다시 돌아가 있지 않게 한다(새로고침·장면 이동)
  useEffect(() => {
    try { if (sessionStorage.getItem(turnKey(snapshot)) === "up") setTurn(360); } catch { /* 저장소를 못 쓰면 다시 세운다 */ }
  }, [snapshot.game.id, snapshot.stage.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const upright = turn % 360 === 0;
  const rotate = () => {
    if (upright) return;
    const next = turn + 90;
    setTurn(next);
    if (next % 360 === 0) {
      play("digit-reveal"); buzz([30, 40, 30]);
      try { sessionStorage.setItem(turnKey(snapshot), "up"); } catch { /* 무시 */ }
    }
  };
  const quarter = (turn / 90) % 2 === 1;
  return <div className={s.pieceStage} style={{ "--rc": ROLE_COLORS[role] } as CSSProperties} data-testid="dogam-piece"
    data-upright={upright || undefined}>
    <span className={s.eyebrow}>넷이 한 그림 · {page.place}</span>
    <h1 data-scene-heading tabIndex={-1} className={s.pieceTitle}>{upright ? "조각을 세웠어요." : "내 그림 조각이 돌아가 있어요."}</h1>
    <button type="button" className={s.piece} onClick={rotate} data-sound="dial-tick" disabled={upright}
      aria-label={upright ? "바로 선 그림 조각" : "그림 조각 돌리기"}>
      <span className={s.pieceFrame} style={{ transform: `rotate(${turn}deg) scale(${quarter ? 0.36 : 1})` }}><Slice page={page} index={index} /></span>
      {upright && <span className={s.pieceDigit} data-testid="mission-v2-private-digit">{snapshot.self.digit}</span>}
      {!upright && <span className={s.pieceTap}><RotateCw size={16} aria-hidden /> 눌러서 돌리기</span>}
    </button>
    <p className={s.say}>{!upright ? "조각을 눌러 바로 세우면 내 숫자가 보여요."
      : role === "commander"
        ? `내 자리는 왼쪽에서 ${index + 1}번째예요. 이 숫자는 내 폰에만 보여요. 동료 숫자를 말로 듣고, 다 같이 폰을 순서대로 나란히 들어 봐요.`
        : `내 자리는 왼쪽에서 ${index + 1}번째예요. 이 숫자는 내 폰에만 보여요. 지휘관에게 말로 전하고, 다 같이 폰을 순서대로 나란히 들어 봐요.`}</p>
    {/* 누가 도감에 올렸는지(공개 정보)도 같이 보여 준다. 지휘관이 아니면 이 화면에서 기다린다. */}
    <ol className={s.order} aria-label="폰을 나란히 드는 순서">
      {order.map((r, i) => {
        const done = snapshot.game.report_mask[ROLES.indexOf(r)];
        return <li key={r} data-me={r === role || undefined} data-ready={done || undefined}
          style={{ "--rc": ROLE_COLORS[r] } as CSSProperties}
          aria-label={`${i + 1}번째 ${ROLE_NAMES[r]}${r === role ? ", 나" : ""}, ${done ? "도감에 올림" : "아직 찾는 중"}`}>
          <b>{i + 1}{done && <Check size={14} strokeWidth={3} aria-hidden />}</b>{ROLE_NAMES[r]}</li>;
      })}
    </ol>
  </div>;
}

/** 자물쇠·기다림 화면: 보고한 보직의 조각이 순서대로 바로 서고, 넷이 다 모이면 그림 한 장이 된다. */
export function DogamLineup({ snapshot, page }: { snapshot: V2Response; page: DogamPage }) {
  const order = orderOf(snapshot);
  const ready = order.map((r) => snapshot.game.report_mask[ROLES.indexOf(r)]);
  const joined = ready.every(Boolean);
  const [wasJoined, setWasJoined] = useState(joined);
  useEffect(() => {
    if (joined && !wasJoined) { play("join"); buzz([30, 50, 30]); }
    setWasJoined(joined);
  }, [joined, wasJoined]);
  return <section className={s.lineup} data-joined={joined || undefined} data-testid="dogam-lineup">
    <div className={s.four}>
      {order.map((r, i) => <div key={r} className={s.mini} data-ready={ready[i] || undefined}
        style={{ "--rc": ROLE_COLORS[r], "--start": `${PIECE_START_TURN[r]}deg` } as CSSProperties}>
        <span className={s.miniPc}><Slice page={page} index={i} /></span>
        <span className={s.tag}>{ROLE_NAMES[r]}</span>
      </div>)}
    </div>
    <p className={s.say}>{joined
      ? <><b>네 보직의 기록이 모였어요.</b> 왼쪽부터 말로 들은 숫자를 넣어요.</>
      : `보고한 보직의 조각이 차례로 바로 서요. ${ready.filter(Boolean).length} / ${order.length}`}</p>
  </section>;
}
