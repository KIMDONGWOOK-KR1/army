import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { prepareSeedCourse } from "../supabase/functions/_shared/prepare-seed-course";
async function readJson(path: string): Promise<unknown> {
  const text = await readFile(resolve(path), "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("코스 JSON 형식이 유효하지 않다. 원문은 출력하지 않는다.");
  }
}
async function main() {
  const { values, positionals } = parseArgs({
    options: { "validate-only": { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const [coursePath, answersPath] = positionals;
  if (!coursePath || !answersPath || positionals.length !== 2) {
    throw new Error(
      "사용법: npm run seed:course -- [--validate-only] 공개코스.json 비공개.local.json",
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    salt = process.env.ANSWER_SALT;
  if (!salt || (!values["validate-only"] && (!url || !key))) {
    throw new Error(
      "Supabase URL·service role key·ANSWER_SALT 환경변수가 필요하다.",
    );
  }
  const course = await prepareSeedCourse(
    await readJson(coursePath),
    await readJson(answersPath),
    salt,
  );
  if (values["validate-only"]) {
    console.log("코스 검증 완료. DB 접속·등록 및 정답 출력 없음.");
    return;
  }
  // Cloud demo seeding stays exclusively on the existing PR-0 dev-only path.
  if (course.demo) {
    throw new Error(
      "이 명령은 합성 코스를 등록하지 않는다. dev 전용 seed:demo를 사용하라.",
    );
  }
  const supabase = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Updating a live course could invalidate private answers midway through a game. Insert immutable revisions.
  const { error } = await supabase
    .from("courses_private")
    .insert({ id: course.id, state: course });
  if (error) {
    throw new Error(
      `코스 등록 실패 (${error.code}). 기존 코스 변경은 새 courseId로 등록하라.`,
    );
  }
  console.log(
    `확정 코스 등록 완료: ${course.id}, 단계 ${
      "stages" in course ? course.stages.length : course.sites.length
    }개. 정답은 출력하지 않음.`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "코스 등록 실패");
  process.exitCode = 1;
});
