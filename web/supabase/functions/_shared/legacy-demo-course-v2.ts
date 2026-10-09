// Reuse the established v1 demo, not the private scenario or a confirmed course.
// Server/seed only: raw inputs must never be projected or logged.
import { demoCourseInput } from "./course.ts";
import { isDevCourseId } from "./deployment.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { ROLES } from "./types.ts";
import type {
  CourseV2Content,
  CourseV2PrivateInput,
  Role,
  SceneText,
  Stage,
  Step,
} from "./types.ts";

export function legacyDemoV2Input(id: string) {
  if (!isDevCourseId(id)) throw new Error("dev 시연 코스 ID가 필요하다.");
  const { course, synthetic } = demoCourseInput();
  const oldGate = course.sites.find((site) => site.id === "gate")!;
  const scene = (id: string, text: string): SceneText => ({
    id,
    channel: "screen",
    text,
    trigger: "enter",
  });
  const stepIds: Record<Role, string> = {
    commander: "G-01.legacy",
    scout: "G-02.legacy",
    signal: "G-03.legacy",
    cipher: "G-04.legacy",
  };
  const roles = {} as Stage["roles"];
  const privateRoles = {} as CourseV2PrivateInput["stages"][string]["roles"];
  const privateSteps: CourseV2PrivateInput["stages"][string]["steps"] = {};
  // TODO(확인필요): these additional guidance levels are provisional demo text.
  const guidance: Record<Role, [string, string]> = {
    commander: [
      "참고 기록에서 학생들이 정문에 모인 이유를 찾아 선택지와 비교하라.",
      "해설을 읽고 사건의 이유를 확인한 뒤 보고하라.",
    ],
    scout: [
      "시연 표지석 안내에서 사적지 번호만 찾아 입력하라. 현장 관찰로 기록하지 않는다.",
      "시연 표지석 안내를 다시 읽고 확인한 내용을 보고하라.",
    ],
    signal: [
      "지휘관에게 받은 주파수의 숫자와 소수점 위치를 확인하라.",
      "지휘관과 전달 내용을 확인한 뒤 해설을 읽고 보고하라.",
    ],
    cipher: [
      "문제에 나온 날짜의 달력을 확인한 뒤 요일을 선택하라.",
      "해설을 읽고 날짜와 요일의 관계를 확인한 뒤 보고하라.",
    ],
  };
  for (const role of ROLES) {
    const clue = oldGate.clues[role];
    const [oldAnswer, digit] = synthetic.gate[role];
    const type = role === "signal"
      ? "frequency"
      : role === "scout"
      ? "observation"
      : "choice";
    const step: Step = {
      id: stepIds[role],
      type,
      grading: "hash",
      confirmed: false,
      prompt: clue.question,
      ...(clue.choices ? { choices: [...clue.choices] } : {}),
      sourceRequired: false,
      maxLen: 300,
      note: "기존 v1 시연 문항 재사용. 실제 시나리오·현장 값은 미확정.",
    };
    // The v1 calendar submits a weekday label; v2 choices submit a 1-based ID.
    const answer = role === "cipher"
      ? String((clue.choices ?? []).indexOf(oldAnswer) + 1)
      : oldAnswer;
    if (role === "cipher" && answer === "0") {
      throw new Error("기존 달력 문항의 선택지 대응을 확인하라.");
    }
    const firstHint = role === "signal"
      ? "지휘관의 개인 전달 단서를 말로 전달받아 주파수를 맞추어라."
      : clue.hint;
    // Never copy the old signal hint: it contains the relay frequency.
    const explanation = role === "signal"
      ? "이 시연은 지휘관의 개인 단서를 말로 전달받는 협동 과정이다. 주파수는 소수점 첫째 자리까지만 입력한다."
      : role === "commander"
      ? oldGate.sacho.body
      : role === "scout"
      ? clue.hint
      : "문제의 날짜를 달력에서 찾고 같은 열의 요일을 확인한다.";
    roles[role] = {
      intro: scene(`legacy-${role}-intro`, clue.title),
      scenes: role === "commander"
        ? [scene("legacy-commander-reference", oldGate.sacho.body)]
        : [],
      digit: true,
      steps: [step],
    };
    privateRoles[role] = {
      digit,
      hints: [firstHint, ...guidance[role]],
      ...(role === "commander"
        ? {
          transferClue: {
            kind: "relay-frequency" as const,
            label: "통신원에게 말로 전달할 시연 주파수",
            value: synthetic.gate.signal[0],
            targetStepId: stepIds.signal,
          },
        }
        : {}),
    };
    privateSteps[step.id] = { answer, explanation };
  }
  const gate: Stage = {
    id: "gate",
    seq: 1,
    kind: "mission",
    name: oldGate.name,
    confirmed: false,
    quiet: false,
    arrival: {
      mode: "gps",
      require: "all",
      confirmed: false,
      lat: null,
      lng: null,
      radiusM: oldGate.radiusM,
      noticeM: oldGate.radiusM,
      dwellSec: 5,
    },
    scoring: {
      enabled: true,
      confirmed: false,
      hintPenalty: { 1: 0, 2: 10, 3: 30 },
      noHintBonus: 5,
      note: "기존 v2 시연 수치 유지. 실제 정책 확정 아님.",
    },
    roles,
    narration: [
      scene(
        "legacy-gate-enter",
        "기존 v1 정문 문항을 옮긴 임시 시연이다. 현장 정보는 검증 전이며 정문까지만 진행한다.",
      ),
    ],
    completion: { type: "lock", order: [...oldGate.lockOrder] },
    sacho: {
      id: "legacy-sacho-gate",
      name: oldGate.sacho.name,
      char: oldGate.sacho.char,
      body: oldGate.sacho.body,
      sections: ["관찰 기록", "출처 및 확인 방식"],
    },
  };
  const content: CourseV2Content = {
    schemaVersion: 2,
    id,
    name: `${course.name} · 정문 v2 시연`,
    confirmed: false,
    demo: true,
    sources: [{
      id: "LEGACY-DEMO",
      title: "기존 v1 시연 자료 (임시 참조 주소, 공식 출처 아님)",
      url: "https://example.com/legacy-demo",
    }],
    settings: {
      teamSize: 4,
      roleSwapEnabled: false,
      roleSwapSeconds: 30,
      note: "정문만 이관. 후속 거점과 실제 시나리오는 포함하지 않는다.",
    },
    stages: [gate],
  };
  const privateInput: CourseV2PrivateInput = {
    schemaVersion: 2,
    courseId: id,
    synthetic: true,
    stages: { gate: { roles: privateRoles, steps: privateSteps } },
  };
  return { content, privateInput };
}

export function legacyDemoCourseV2(id: string, salt: string) {
  const { content, privateInput } = legacyDemoV2Input(id);
  return prepareCourseV2(content, privateInput, salt);
}
