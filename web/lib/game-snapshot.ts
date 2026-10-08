import type { Snapshot } from "@/supabase/functions/_shared/types";
import type { SnapshotV2 } from "@/supabase/functions/_shared/engine-v2";

export type V2Response = SnapshotV2 & { result?: Record<string, unknown> };
export type GameResponse = Snapshot | V2Response;

export function isV2Response(value: GameResponse): value is V2Response {
  return "stage" in value && value.stage.schema_version === 2;
}
