import type { Command, Snapshot } from "../supabase/functions/_shared/types";
import type { SoundName } from "./sound-synth";

// 서버 판정이 돌아온 순간의 소리: 단서 보고 맞음/틀림, 자물쇠 열림/실패.
// 추모 거점(정문)에서는 맞음·열림도 오르는 가락 없이 차분한 한 음으로 낸다.
// 자물쇠가 열린 뒤에도 서버는 방금 연 거점을 current_site로 둔다.
export function judgeCue(
  c: Pick<Command, "action">,
  next: Pick<Snapshot, "result" | "current_site"> | null,
): { name: SoundName; calm: boolean } | null {
  if (!next?.result) return null;
  const result = next.result, calm = !!next.current_site?.reverent;
  if (c.action === "submit-step" && typeof result.accepted === "boolean")
    return { name: result.accepted ? "clue-correct" : "clue-wrong", calm };
  if (c.action === "open-after-explanation" && result.opened === true)
    return { name: "lock-open", calm };
  if (!("ok" in result)) return null;
  const ok = result.ok === true;
  if (c.action === "submit-report")
    return { name: ok ? "clue-correct" : "clue-wrong", calm };
  if (c.action === "open-lock")
    return { name: ok ? "lock-open" : "lock-fail", calm };
  return null;
}
