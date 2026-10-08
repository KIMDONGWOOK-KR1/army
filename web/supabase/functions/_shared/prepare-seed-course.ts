import { prepareCourse } from "./prepare-course.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";

/** Routing at seed time only; the v1 game engine still accepts v1 Course exclusively. */
export async function prepareSeedCourse(
  input: unknown,
  privateInput: unknown,
  salt: string,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("코스 객체가 필요하다.");
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version === 2) return prepareCourseV2(input, privateInput, salt);
  if (version !== undefined && version !== 1) {
    throw new Error("지원하지 않는 코스 버전이다.");
  }
  return prepareCourse(input, privateInput, salt);
}
