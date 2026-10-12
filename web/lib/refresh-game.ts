import { ApiError } from "./client";
import { isV2Response, type GameResponse } from "./game-snapshot";
import type { Command } from "@/supabase/functions/_shared/types";

/** A stage can advance between the room read and its stage read. Recover that
 * read-only race once; never retry mutations or suppress other API errors. */
export async function refreshCurrentGame<S extends GameResponse>(request: (command: Command) => Promise<S>, id?: string): Promise<S> {
  const next = await request({ action: "get-game", game_id: id });
  if (!isV2Response(next) || next.game.status !== "playing" || next.game.site_phase === "travel") return next;
  try {
    return await request({ action: "get-stage", game_id: next.game.id, stage_id: next.game.stage_id });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "STALE_STAGE") throw error;
    return request({ action: "get-game", game_id: next.game.id });
  }
}
