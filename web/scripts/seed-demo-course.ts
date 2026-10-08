import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { demoCourse } from "../supabase/functions/_shared/course";
import { isDevCourseId } from "../supabase/functions/_shared/deployment";
import { demoCourseV2 } from "../supabase/functions/_shared/demo-course-v2";

// Deliberately does not load .env.local or accept real course/answer file paths.
export async function prepareDemoSeed(
  args: string[],
  environment: Record<string, string | undefined>,
) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      "dev-project-ref": { type: "string" },
      "course-id": { type: "string" },
      "schema-version": { type: "string", default: "1" },
    },
  });
  const projectRef = values["dev-project-ref"], id = values["course-id"];
  if (
    !projectRef || !/^[a-z0-9]{20}$/.test(projectRef) || !id ||
    !isDevCourseId(id)
  ) {
    throw new Error(
      "사용법: npm run seed:demo -- --dev-project-ref <dev 프로젝트 ref> --course-id jnu-demo-dev-<리비전> (ID 최대 40자)",
    );
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (url !== `https://${projectRef}.supabase.co`) {
    throw new Error("Supabase URL이 명시한 dev 프로젝트 ref와 일치해야 한다.");
  }
  const key = environment.SUPABASE_SERVICE_ROLE_KEY,
    salt = environment.ANSWER_SALT;
  if (!key || !salt || salt.length < 32) {
    throw new Error(
      "dev service role key와 Edge와 동일한 32자 이상 ANSWER_SALT가 필요하다.",
    );
  }
  if (!["1", "2"].includes(values["schema-version"]!)) {
    throw new Error("schema-version은 1 또는 2여야 한다.");
  }
  const course = values["schema-version"] === "2"
    ? await demoCourseV2(id, salt)
    : await demoCourse(salt);
  course.id = id;
  return { url, key, course };
}

async function main() {
  const { url, key, course } = await prepareDemoSeed(
    process.argv.slice(2),
    process.env,
  );
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Immutable revisions: a duplicate ID fails instead of changing an active game.
  const { error } = await supabase.from("courses_private").insert({
    id: course.id,
    state: course,
  });
  if (error) {
    throw new Error(
      "dev 합성 코스 등록 실패. 대상 프로젝트·권한·ID 중복을 확인하라. 재등록은 새 리비전 ID를 사용한다.",
    );
  }
  console.log(
    `dev 합성 코스 등록 완료: ${course.id}. 정답·키·salt는 출력하지 않음.`,
  );
}

if (
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "dev 합성 코스 등록 실패",
    );
    process.exitCode = 1;
  });
}
