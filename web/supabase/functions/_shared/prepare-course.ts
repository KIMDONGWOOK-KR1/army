import { answerHash, normalizeAnswer } from "./engine.ts";
import { ROLES, type Course, type Clue, type Role } from "./types.ts";
type RawClue = {
  type: Clue["type"];
  question?: string;
  title?: string;
  target?: string;
  hint?: string;
  choices?: string[];
  confirmed?: boolean;
  min?: number;
  max?: number;
  normalize?: Clue["normalize"];
};
type RawCourse = {
  courseId: string;
  name: string;
  confirmed: boolean;
  sites: {
    id: string;
    seq: number;
    name: string;
    lat: number | null;
    lng: number | null;
    radiusM: number;
    reverent: boolean;
    walkMin?: number;
    lockOrder: string[];
    sacho: { char: string; name: string; body?: string };
    clues: Record<string, RawClue>;
  }[];
};
type RawAnswers = Record<string, unknown>;
const required = (v: unknown, label: string): string => {
  if (typeof v !== "string" || !v.trim() || /TODO|확인필요|TBD/.test(v))
    throw new Error(`${label}: 확정된 내용이 필요하다.`);
  return v;
};
export async function prepareCourse(
  input: unknown,
  answersInput: unknown,
  salt: string,
): Promise<Course> {
  if (salt.length < 32) throw new Error("ANSWER_SALT는 32자 이상이어야 한다.");
  const raw = input as RawCourse,
    answers = answersInput as RawAnswers;
  if (!raw || raw.confirmed !== true)
    throw new Error("코스 confirmed=true와 현장 확정이 필요하다.");
  if (
    !/^[a-z0-9_-]{1,40}$/.test(raw.courseId) ||
    !Array.isArray(raw.sites) ||
    raw.sites.length < 1 ||
    raw.sites.length > 30
  )
    throw new Error("코스 ID 또는 거점 목록이 유효하지 않다.");
  const course: Course = {
    id: raw.courseId,
    name: required(raw.name, "코스 이름"),
    confirmed: true,
    demo: false,
    sites: [],
  };
  const ids = new Set<string>();
  for (const [i, s] of [...raw.sites].sort((a, b) => a.seq - b.seq).entries()) {
    if (!/^[a-z0-9_-]{1,40}$/.test(s.id) || ids.has(s.id) || s.seq !== i + 1)
      throw new Error("거점 ID는 유일하고 seq는 1부터 연속이어야 한다.");
    ids.add(s.id);
    if (
      typeof s.lat !== "number" ||
      typeof s.lng !== "number" ||
      !Number.isFinite(s.lat) ||
      !Number.isFinite(s.lng) ||
      Math.abs(s.lat) > 90 ||
      Math.abs(s.lng) > 180
    )
      throw new Error("거점 좌표를 현장에서 확정하라.");
    if (!Number.isFinite(s.radiusM) || s.radiusM < 5 || s.radiusM > 200)
      throw new Error("도착 반경은 5~200m여야 한다.");
    if (
      !Array.isArray(s.lockOrder) ||
      s.lockOrder.length !== 4 ||
      new Set(s.lockOrder).size !== 4 ||
      !s.lockOrder.every((r) => ROLES.includes(r as Role))
    )
      throw new Error("잠금 순서는 네 보직을 한 번씩 포함해야 한다.");
    const site: Course["sites"][number] = {
      id: s.id,
      seq: s.seq,
      name: required(s.name, "거점 이름"),
      lat: s.lat,
      lng: s.lng,
      radiusM: s.radiusM,
      reverent: !!s.reverent,
      walkMin: s.walkMin,
      lockOrder: s.lockOrder as Role[],
      sacho: {
        char: required(s.sacho?.char, "사초 글자"),
        name: required(s.sacho?.name, "사초 이름"),
        body: required(s.sacho?.body, "사초 본문"),
      },
      clues: {} as Record<Role, Clue>,
      answers: {} as Course["sites"][number]["answers"],
    };
    for (const role of ROLES) {
      const c = s.clues?.[role];
      if (
        !c ||
        c.confirmed !== true ||
        !["quiz", "find", "frequency", "calendar", "hanja"].includes(c.type)
      )
        throw new Error(`${s.id}/${role}: 문항 확정이 필요하다.`);
      const question = required(c.question ?? c.target ?? c.hint, "문항");
      const hint = required(c.hint ?? c.target ?? c.question, "단서");
      const clue: Clue = {
        type: c.type,
        title: c.title ?? "현장의 단서",
        question,
        hint,
        ...(c.choices ? { choices: c.choices } : {}),
        ...(c.normalize ? { normalize: c.normalize } : {}),
        ...(c.type === "frequency"
          ? { min: c.min ?? 10, max: c.max ?? 100 }
          : {}),
      };
      if (
        ["quiz", "hanja"].includes(c.type) &&
        (!c.choices || c.choices.length < 2 || c.choices.some((x) => !x.trim()))
      )
        throw new Error("선택형 문항은 확정된 선택지가 필요하다.");
      const a = (
        answers[s.id] as
          Record<string, { answer: string; digit: number }> | undefined
      )?.[role];
      if (!a || !Number.isInteger(a.digit) || a.digit < 0 || a.digit > 9)
        throw new Error(`${s.id}/${role}: 비공개 숫자는 0~9여야 한다.`);
      required(a.answer, "비공개 정답");
      const normalized = normalizeAnswer(c.type, a.answer, c.normalize);
      if (!normalized) throw new Error("비공개 정답 형식이 유효하지 않다.");
      if (
        ["quiz", "hanja"].includes(c.type) &&
        (!/^\d+$/.test(normalized) ||
          Number(normalized) < 1 ||
          Number(normalized) > (c.choices?.length ?? 0))
      )
        throw new Error("선택 번호가 범위를 벗어났다.");
      if (
        c.type === "calendar" &&
        ![
          "월요일",
          "화요일",
          "수요일",
          "목요일",
          "금요일",
          "토요일",
          "일요일",
        ].includes(normalized)
      )
        throw new Error("달력 답은 요일 이름이어야 한다.");
      if (
        c.type === "frequency" &&
        (Number(normalized) < clue.min! || Number(normalized) > clue.max!)
      )
        throw new Error("주파수 정답이 조절 범위를 벗어났다.");
      site.clues[role] = clue;
      site.answers[role] = {
        answerHash: await answerHash(salt, s.id, role, clue, a.answer),
        digit: a.digit,
      };
    }
    course.sites.push(site);
  }
  return course;
}
