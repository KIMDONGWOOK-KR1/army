import { DomainError } from "./engine.ts";
import type { Course } from "./types.ts";

export function isDevCourseId(id: string) {
  return /^jnu-demo-dev-[a-z0-9_-]+$/.test(id) && id.length <= 40;
}

// Explicit dev-only opt-in, default off. Never configure this in a prod project.
// This permits four-person synthetic courses, not solo demo actions or rule bypasses.
export function assertEdgeCourseAllowed(course: Course, devOptIn: string) {
  if (course.confirmed === true && course.demo === false) return;
  if (
    devOptIn === "true" &&
    course.demo === true &&
    course.confirmed === false &&
    isDevCourseId(course.id)
  ) return;
  throw new DomainError(
    "UNCONFIRMED_COURSE",
    "이 환경에서 사용할 수 없는 코스다.",
  );
}

export function corsForRequest(
  origin: string | null,
  allowedOrigin: string,
  allowedOrigins: string,
) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store, private",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  const values = [allowedOrigin, ...allowedOrigins.split(",")]
    .map((value) => value.trim()).filter(Boolean);
  try {
    if (!values.length) throw new Error("Missing origins");
    for (const value of values) {
      const url = new URL(value);
      if (
        !["https:", "http:"].includes(url.protocol) || url.origin !== value ||
        url.hostname.includes("*")
      ) {
        throw new Error("Expected an exact origin");
      }
    }
  } catch {
    return { headers, status: 503 };
  }
  // Authenticated non-browser clients keep working without an Origin header.
  if (origin === null) return { headers, status: 200 };
  if (!values.includes(origin)) return { headers, status: 403 };
  headers["Access-Control-Allow-Origin"] = origin;
  return { headers, status: 200 };
}
