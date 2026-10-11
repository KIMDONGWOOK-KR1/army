import { prepareCourse } from "./prepare-course.ts";
import { prepareCourseV2 } from "./prepare-course-v2.ts";
import { parseWallMode, prepareWallTributeV2, type WallMode } from "./prepare-wall-tribute-v2.ts";
import type { CourseV2Content, CourseV2PrivateInput } from "./types.ts";

/** Routing at seed time only; the v1 game engine still accepts v1 Course exclusively. */
export async function prepareSeedCourse(
  input: unknown,
  privateInput: unknown,
  salt: string,
  options: { wallMode?: WallMode; courseId?: string } = {},
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("코스 객체가 필요하다.");
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  const wallMode = parseWallMode(options.wallMode);
  if (wallMode === "tribute") {
    if (version !== 2 || !options.courseId || options.courseId === (input as CourseV2Content).id) {
      throw new Error("헌화 전환은 v2 코스의 새 course-id로만 등록한다.");
    }
    const converted = prepareWallTributeV2(input as CourseV2Content, privateInput as CourseV2PrivateInput);
    // Change the revision ID before preparing answer hashes for all retained stages.
    converted.content.id = options.courseId;
    converted.privateInput.courseId = options.courseId;
    return prepareCourseV2(converted.content, converted.privateInput, salt);
  }
  if (options.courseId !== undefined) throw new Error("course-id 옵션은 wall-mode tribute와 함께 사용한다.");
  if (version === 2) return prepareCourseV2(input, privateInput, salt);
  if (version !== undefined && version !== 1) {
    throw new Error("지원하지 않는 코스 버전이다.");
  }
  return prepareCourse(input, privateInput, salt);
}
