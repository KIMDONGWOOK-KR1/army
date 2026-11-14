import { isV2Response, type GameResponse } from "./game-snapshot";
import type { SharedBoat } from "./plaza-protocol";
import type { Command } from "@/supabase/functions/_shared/types";
export const REFLECTION_LIMIT = 600;
export type PlazaReflection = { text: string | null; busy?: boolean; closed?: boolean; prompt?: string; preview?: boolean; boats?: SharedBoat[]; onMessage?: (text: string) => Promise<boolean>; onSend?: (text: string) => Promise<boolean> };
export async function sendReflection(send: (command: Command) => Promise<GameResponse | null>, stageId: string, value: string) {
  const text = value.trim();
  if (!text || text.length > REFLECTION_LIMIT) return false;
  const next = await send({ action: "submit-retro", stage_id: stageId, text });
  return !!next && isV2Response(next) && next.result?.saved === true && !!next.self.retro;
}

export async function sendBoatMessage(send: (command: Command) => Promise<GameResponse | null>, stageId: string, value: string) {
  const text=value.trim(); if(!text || text.length>REFLECTION_LIMIT)return false;
  const next=await send({action:"submit-retro",boat_kind:"message",stage_id:stageId,text});
  return !!next && isV2Response(next) && next.result?.saved===true && typeof next.result.boat_id==="string";
}
