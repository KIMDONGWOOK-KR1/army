import { ROLES } from "./types.ts";
import type { CourseV2Content, CourseV2PrivateInput, Role, SceneText, Stage } from "./types.ts";

export type WallMode = "preserve" | "tribute";
export function parseWallMode(value: unknown): WallMode {
  if (value === undefined || value === "preserve") return "preserve";
  if (value === "tribute") return "tribute";
  throw new Error("wall-mode는 preserve 또는 tribute여야 한다.");
}

/** Author a new in-memory wall definition. Never edit the input files or a stored course revision. */
export function prepareWallTributeV2(contentInput: CourseV2Content, privateInput: CourseV2PrivateInput) {
  if (contentInput?.schemaVersion !== 2 || privateInput?.schemaVersion !== 2 ||
    contentInput.id !== privateInput.courseId || !Array.isArray(contentInput.stages)) {
    throw new Error("헌화 준비에는 같은 ID의 v2 콘텐츠·비공개 입력이 필요하다.");
  }
  const content = structuredClone(contentInput), input = structuredClone(privateInput);
  const index = content.stages.findIndex((stage) => stage.id === "wall");
  const previous = content.stages[index];
  if (!previous || previous.kind !== "memorial" ||
    !["confirm", "tribute"].includes(previous.completion.type) || previous.arrival.require !== "all" || !input.stages?.wall) {
    throw new Error("전원 도착을 사용하는 기존 추모의 벽 정의가 필요하다.");
  }
  const intro = "민주화운동에 헌신하다 세상을 떠난 전남대 열사 스무 분을 기리는 자리다. 5·18 당시 희생된 학생부터 그 뒤 민주화운동에 몸 바친 이들까지 이름이 새겨져 있다. 잠시 걸음을 멈추고, 각자 국화 한 송이를 올려 마음을 전하자.";
  const scene = (id: string, text: string, trigger: SceneText["trigger"] = "enter"): SceneText =>
    ({ id, channel: "screen", text, trigger });
  const stepIds: Record<Role, string> = {
    scout: "W-01.tribute", signal: "W-02.tribute", cipher: "W-03.tribute", commander: "W-04.tribute",
  };
  // Reconstruct the complete wall, including private roles, so no old clues, answers,
  // rewards, assets, dependencies or joint-record text can survive the conversion.
  const wall: Stage = {
    id: previous.id, seq: previous.seq, kind: "memorial", name: "용봉열사 추모의 벽",
    confirmed: previous.confirmed, quiet: true, arrival: structuredClone(previous.arrival),
    scoring: { enabled: false, confirmed: true, hintPenalty: { 1: 0, 2: 0, 3: 0 }, noHintBonus: 0 },
    narration: [scene("W-00.enter", intro),
      scene("W-06.done", "네 송이의 국화를 올렸다. 잠시 머무르거나 이동할 수 있다.", "stage-complete")],
    roles: Object.fromEntries(ROLES.map((role) => [role, {
      intro: scene(`W-${role}.intro`, intro), scenes: [], digit: false,
      steps: [{ id: stepIds[role], type: "confirm", grading: "confirm", confirmed: true,
        prompt: "국화 한 송이를 올려 추모한다.", sourceRequired: false }],
    }])) as unknown as Stage["roles"],
    completion: { type: "tribute", label: "국화 올리기" },
    sacho: { id: previous.sacho?.id ?? "sacho-wall", name: "사초③ · 추모의 기록", sections: ["헌화"],
      char: "念", body: "네 사람이 용봉열사 추모의 벽 앞에 국화 한 송이씩을 올리고 열사들을 기억했다." },
  };
  content.stages[index] = wall;
  input.stages.wall = {
    roles: Object.fromEntries(ROLES.map((role) => [role, {
      hints: ["국화 한 송이를 올려 추모한다.", "동료들이 마음을 전하는 동안 조용히 기다린다.", "각자 국화 한 송이를 올린다."],
    }])) as CourseV2PrivateInput["stages"][string]["roles"],
    steps: Object.fromEntries(ROLES.map((role) => [stepIds[role], { explanation: "국화 한 송이를 올려 추모했다." }])),
  };
  return { content, privateInput: input };
}
