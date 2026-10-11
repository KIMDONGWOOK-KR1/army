import "server-only";
import { dispatch } from "@/supabase/functions/_shared/engine";
import { DomainError, sha256 } from "@/supabase/functions/_shared/game-core";
import { ROLES, type Command, type CourseV2, type Game, type GameEvent } from "@/supabase/functions/_shared/types";

// Local rehearsal only. The four-player engine still rejects client-selected roles.
// All mission, memorial and closing commands use the same engine as a team room.
export async function dispatchSoloV2(
  game: Game, course: CourseV2, userId: string, cmd: Command,
  now: number, salt: string, events: GameEvent[],
) {
  if (!course.demo || game.demoOwner !== userId || !game.v2)
    throw new DomainError("FORBIDDEN", "혼자 체험하는 작전에서만 사용할 수 있어요.");
  if (cmd.action !== "demo-role" && (cmd.action !== "report-arrival" || cmd.method !== "simulated" || cmd.manual))
    return dispatch(game, course, userId, cmd, now, salt, events);
  if (!cmd.request_id || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.request_id))
    throw new DomainError("BAD_REQUEST", "요청 식별자가 필요해요.");
  const key = `${userId}:${cmd.request_id}`, hash = await sha256(JSON.stringify(cmd));
  const receipt = game.receipts[key];
  if (receipt) {
    if (receipt.hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", "같은 요청 번호의 내용이 달라요.");
    return structuredClone(receipt.result);
  }
  if (game.expiresAt <= now) throw new DomainError("EXPIRED", "작전이 만료되었어요.");
  if (Object.keys(game.receipts).length >= 1995)
    throw new DomainError("RATE_LIMITED", "요청 수를 초과했어요.");
  if (game.status !== "playing") throw new DomainError("WRONG_PHASE", "진행 중인 체험에서 사용할 수 있어요.");
  const copy = structuredClone(game), pending: GameEvent[] = [];
  const member = copy.members.find((m) => m.userId === userId)!;
  let result: Record<string, unknown>;
  if (cmd.action === "demo-role") {
    if (!ROLES.includes(cmd.demo_role!) || cmd.role !== undefined)
      throw new DomainError("BAD_REQUEST", "체험할 보직을 선택해주세요.");
    const other = copy.members.find((m) => m.role === cmd.demo_role)!;
    [member.role, other.role] = [other.role, member.role];
    member.lastSeen = now;
    copy.version++;
    result = { switched: true };
  } else {
    // Validate the caller's command first, then arrive the three rehearsal companions.
    // No forced arrival in GPS-only courses and no phase/role bypass.
    result = await dispatch(copy, course, userId, cmd, now, salt, pending);
    for (const companion of copy.members.filter((m) => m.userId !== userId)) {
      if (copy.phase !== "travel") break;
      await dispatch(copy, course, companion.userId, {
        ...cmd, request_id: crypto.randomUUID(),
      }, now, salt, pending);
    }
  }
  copy.receipts[key] = { hash, result: structuredClone(result) };
  Object.assign(game, copy);
  events.push(...pending);
  return result;
}
