"use client";
import type { GameResponse, V2Response } from "@/lib/game-snapshot";
import { sendReflection, sendBoatMessage } from "@/lib/bongji-reflection";
import { plain } from "@/lib/practice-text";
import { ROLES, type Command } from "@/supabase/functions/_shared/types";
import dynamic from "next/dynamic";
const BongjiPlaza = dynamic(() => import("./bongji-plaza").then(m => m.BongjiPlaza), { ssr: false, loading: () => <p role="status">봉지 마당을 준비하고 있어요…</p> });
import { SharedDraftPanel } from "./closing-v2";
type Props = { snapshot: V2Response; busy: boolean; send: (command: Command) => Promise<GameResponse | null> };
export function BongjiStop(props: Props) {
  const { snapshot: s, busy, send } = props;
  return <BongjiPlaza room={{gameId:s.game.id,selfId:s.self.id,memberIds:s.game.members.map(m=>m.id),serverNow:s.server_now}} members={s.game.members.map(m => ({ id: m.id, nickname: m.nickname, role: m.role, self: m.id === s.self.id, reflected: !!m.role && !!s.game.retro_mask?.[ROLES.indexOf(m.role)] }))}
    reflection={{ boats:s.game.plaza_boats, onMessage:text=>sendBoatMessage(send,s.stage.id,text), text: s.self.retro ?? null, busy, closed: s.game.status === "done" || s.game.site_phase === "cleared", prompt: plain(s.self.mission?.steps[0]?.prompt), onSend: text => sendReflection(send, s.stage.id, text) }}
    recordContent={<SharedDraftPanel {...props} embedded />} />;
}
