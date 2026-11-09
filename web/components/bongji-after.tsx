"use client";
import { useState } from "react";
import { sendBoatMessage } from "@/lib/bongji-reflection";
import type { Command } from "@/supabase/functions/_shared/types";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import dynamic from "next/dynamic";
const BongjiPlaza = dynamic(() => import("./bongji-plaza").then(m => m.BongjiPlaza), { ssr: false, loading: () => <p role="status">봉지 마당을 준비하고 있어요…</p> });
import { ROLES } from "@/supabase/functions/_shared/types";
import { ResultV2 } from "./closing-v2";

/** 완주한 기록을 읽은 뒤에도 같은 팀으로 마당을 오갈 수 있다. */
export function BongjiAfter({ snapshot, onNewGame, send }: { snapshot: V2Response; onNewGame: () => void; send: (command:Command)=>Promise<GameResponse|null> }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <BongjiPlaza room={{gameId:snapshot.game.id,selfId:snapshot.self.id,memberIds:snapshot.game.members.map(m=>m.id),serverNow:snapshot.server_now}}
    members={snapshot.game.members.map(m => ({ id: m.id, nickname: m.nickname, role: m.role, self: m.id === snapshot.self.id, reflected: !!m.role && !!snapshot.game.retro_mask?.[ROLES.indexOf(m.role)] }))}
    reflection={{ text: snapshot.self.retro ?? null, closed: true, boats:snapshot.game.plaza_boats, onMessage:text=>sendBoatMessage(send,snapshot.stage.id,text) }}
    onRecord={() => setPlaying(false)} recordLabel="오늘의 실록 보기" />;
  return <>
    <ResultV2 snapshot={snapshot} />
    <section className="game-console summary-console">
      <button className="button primary" data-sound="none" onClick={() => setPlaying(true)}>봉지에서 더 놀기</button>
      <button className="button secondary" onClick={onNewGame}>새 작전 준비하기</button>
    </section>
  </>;
}
