import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { isDevCourseId } from "../supabase/functions/_shared/deployment";
import { prepareCourseV2 } from "../supabase/functions/_shared/prepare-course-v2";
import { parseWallMode, prepareWallTributeV2 } from "../supabase/functions/_shared/prepare-wall-tribute-v2";
import type { CourseV2Content, CourseV2PrivateInput } from "../supabase/functions/_shared/types";

// The user explicitly authorized this existing dev project for private-content review.
// This is a non-secret project identifier, not a credential or a production allowlist.
export const REVIEW_DEV_PROJECT_REF = "vmadbgniurfzqygqidzw";
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(resolve(path), "utf8"));

export async function prepareReviewSeed(args: string[], environment: Record<string, string | undefined>,
  loadJson: (path: string) => Promise<unknown> = readJson) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    "dev-project-ref": { type: "string" }, "course-id": { type: "string" },
    "validate-only": { type: "boolean", default: false },
    "wall-mode": { type: "string" },
  } });
  const wallMode = parseWallMode(values["wall-mode"]);
  const id = values["course-id"], projectRef = values["dev-project-ref"];
  if (projectRef !== REVIEW_DEV_PROJECT_REF || positionals.length !== 2 || !id ||
    !id.startsWith("jnu-demo-dev-review-") || !isDevCourseId(id)) {
    throw new Error("지정 dev 프로젝트·새 jnu-demo-dev-review- ID·비공개 입력 파일 2개가 필요하다.");
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL, key = environment.SUPABASE_SERVICE_ROLE_KEY,
    salt = environment.ANSWER_SALT;
  if (url !== `https://${REVIEW_DEV_PROJECT_REF}.supabase.co`) throw new Error("등록 URL이 지정 dev 프로젝트와 일치하지 않는다.");
  if (!salt || salt.length < 32 || (!values["validate-only"] && !key)) {
    throw new Error("기존 Edge와 동일한 32자 이상 salt와 등록용 service role key가 필요하다.");
  }
  // Only in-memory copies change. Real authoring files and their GPS approval remain untouched.
  let content = structuredClone(await loadJson(positionals[0])) as CourseV2Content;
  let input = structuredClone(await loadJson(positionals[1])) as CourseV2PrivateInput;
  if (!content || !input || content.schemaVersion !== 2 || input.schemaVersion !== 2 ||
    content.demo !== false || input.synthetic !== false || content.id !== input.courseId || !Array.isArray(content.stages)) {
    throw new Error("같은 ID의 실제 v2 콘텐츠·비공개 정답 작성 파일이 필요하다.");
  }
  if (id === content.id) throw new Error("원본과 다른 새 검수 리비전 ID가 필요하다.");
  if (wallMode === "tribute") {
    ({ content, privateInput: input } = prepareWallTributeV2(content, input));
  }
  content.id = id; content.demo = true; content.confirmed = false;
  content.name = `${content.name} · 개발 검수`;
  content.note = "사용자 승인 dev 검수용: 실제 원문 콘텐츠, 전원 모의 도착. 운영 확정·현장 검증 완료가 아님.";
  input.courseId = id;
  // Legacy seed discriminator follows the dev envelope; it does not claim the source prose is synthetic.
  input.synthetic = true;
  for (const stage of content.stages) {
    stage.arrival = { ...stage.arrival, mode: "none", confirmed: false, require: "all", lat: null, lng: null,
      note: "개발 검수 코스 전용 모의 도착. 원본 GPS 설정은 변경하지 않음." };
  }
  try {
    const course = await prepareCourseV2(content, input, salt);
    return { url, key, course, validateOnly: values["validate-only"] };
  } catch {
    // Never echo JSON parser/validator errors or private input values into command logs.
    throw new Error("검수용 코스 검증 실패. 비공개 로컬 검증 결과를 확인하라. 원문·정답은 출력하지 않는다.");
  }
}

async function main() {
  const { url, key, course, validateOnly } = await prepareReviewSeed(process.argv.slice(2), process.env);
  if (validateOnly) {
    console.log(`개발 검수 코스 검증 완료: ${course.id}. DB 접속·등록 없음.`);
    return;
  }
  const client = createClient(url, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.from("courses_private").insert({ id: course.id, state: course });
  if (error) throw new Error("검수용 등록 실패");
  console.log(`개발 검수 코스 등록 완료: ${course.id}. 원문·정답·키·salt 출력 없음.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("검수용 코스 등록/검증 실패. dev 프로젝트·입력 파일·기존 salt·키·ID 중복을 확인하라. 비공개 값은 출력하지 않는다.");
    process.exitCode = 1;
  });
}
