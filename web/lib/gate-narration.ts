import { ROLE_NAMES, type Role, type RoleMission } from "@/supabase/functions/_shared/types";

export type NarrationFrame = {
  key: string;
  legacyKeys?: string[];
  lines: string[];
  kind: "common" | "personal";
  label?: string;
  closeLabel?: string;
  emphasis?: "first-line" | "last-line";
};

/** Older immutable courses may still include the redundant personal heading. */
export function personalMissionBody(text: string): string {
  return text.replace(/^\s*\[[^\]\r\n]*담당 임무\][ \t]*(?:\r?\n|$)/, "").trim();
}

/** Receives only the caller's projected mission, never the course's role map. */
export function gateNarrationFrames({
  stageId,
  role,
  commonLines,
  mission,
}: {
  stageId: string;
  role: Role | null;
  commonLines: string[];
  mission: Pick<RoleMission, "intro" | "scenes"> | null;
}): NarrationFrame[] {
  const scope = `arrive:${stageId}`;
  const common = commonLines.filter((line) => line.trim());
  const frames: NarrationFrame[] = common.length ? [{
    key: `${scope}:common:${role ?? "unassigned"}`,
    legacyKeys: [scope],
    lines: common,
    kind: "common",
    emphasis: "last-line",
  }] : [];
  if (!role || !mission) return frames;

  // Intro is the author's dedicated role introduction. Other event scenes must
  // stay in their existing event flow instead of revealing later instructions.
  const intro = (mission.intro.trigger === "enter" && mission.intro.text.trim()
    ? [mission.intro.text]
    : mission.scenes.filter((scene) => scene.trigger === "enter" && scene.text.trim())
      .map((scene) => scene.text)).map(personalMissionBody).filter(Boolean);
  if (intro.length) frames.push({
    key: `${scope}:personal:${role}`,
    lines: intro,
    kind: "personal",
    label: `${ROLE_NAMES[role]} 개인 임무`,
    closeLabel: "임무 시작",
  });
  return frames;
}

export function nextNarrationFrame(
  frames: NarrationFrame[],
  seen: (key: string) => boolean,
): NarrationFrame | undefined {
  return frames.find((frame) => !seen(frame.key) && !frame.legacyKeys?.some(seen));
}
