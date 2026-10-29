import type { Snapshot } from "@/supabase/functions/_shared/types";
import type { SnapshotV2 } from "@/supabase/functions/_shared/engine-v2";

type CompatibleCompletion<T extends { completion_type: unknown }> =
  Omit<T, "completion_type"> & Partial<Pick<T, "completion_type">>;
type ResultV2 = NonNullable<SnapshotV2["self"]["result"]>;

/** Older deployed Edge snapshots can omit additions that the current server always emits. */
export type V2Response = Omit<SnapshotV2, "game" | "self"> & {
  game: Omit<SnapshotV2["game"], "step_total_count" | "completion"> & {
    step_total_count?: SnapshotV2["game"]["step_total_count"];
    completion: CompatibleCompletion<NonNullable<SnapshotV2["game"]["completion"]>> | null;
  };
  self: Omit<SnapshotV2["self"], "journal" | "result"> & {
    journal: CompatibleCompletion<SnapshotV2["self"]["journal"][number]>[];
    result?: (Omit<ResultV2, "stages"> & { stages: CompatibleCompletion<ResultV2["stages"][number]>[] }) | null;
  };
  result?: Record<string, unknown>;
};
export type GameResponse = Snapshot | V2Response;

export function isV2Response(value: GameResponse): value is V2Response {
  return "stage" in value && value.stage.schema_version === 2;
}
