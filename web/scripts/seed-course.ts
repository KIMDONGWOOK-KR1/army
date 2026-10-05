import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prepareCourse } from "../supabase/functions/_shared/prepare-course";
async function main() {
  const [coursePath, answersPath] = process.argv.slice(2);
  if (!coursePath || !answersPath)
    throw new Error(
      "사용법: npm run seed:course -- 공개코스.json 비공개.answers.local.json",
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    salt = process.env.ANSWER_SALT;
  if (!url || !key || !salt)
    throw new Error(
      "Supabase URL·service role key·ANSWER_SALT 환경변수가 필요하다.",
    );
  const course = await prepareCourse(
    JSON.parse(await readFile(resolve(coursePath), "utf8")),
    JSON.parse(await readFile(resolve(answersPath), "utf8")),
    salt,
  );
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Updating a live course could invalidate private answers midway through a game. Insert immutable revisions.
  const { error } = await supabase
    .from("courses_private")
    .insert({ id: course.id, state: course });
  if (error)
    throw new Error(
      `코스 등록 실패 (${error.code}). 기존 코스 변경은 새 courseId로 등록하라.`,
    );
  console.log(
    `확정 코스 등록 완료: ${course.id}, 거점 ${course.sites.length}개. 정답은 출력하지 않음.`,
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "코스 등록 실패");
  process.exitCode = 1;
});
