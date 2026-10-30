import type { Stage } from "./types.ts";

export function isGpsReviewCourse(course: { id: string; demo: boolean }) {
  return course.demo && course.id.startsWith("jnu-demo-dev-review-gps-");
}

// No server-only imports: the UI and engine must expose the same dev-only action.
export function allowsSimulatedArrival(
  course: { id: string; demo: boolean },
  arrival: Pick<Stage["arrival"], "confirmed">,
) {
  return course.demo && /^jnu-demo-dev-[a-z0-9_-]+$/.test(course.id) &&
    course.id.length <= 40 && !arrival.confirmed && !isGpsReviewCourse(course);
}

export function hasGpsArrival(arrival: Stage["arrival"]) {
  return arrival.mode === "gps" && arrival.confirmed &&
    arrival.require === "all" &&
    typeof arrival.lat === "number" && Number.isFinite(arrival.lat) && Math.abs(arrival.lat) <= 90 &&
    typeof arrival.lng === "number" && Number.isFinite(arrival.lng) && Math.abs(arrival.lng) <= 180 &&
    typeof arrival.radiusM === "number" && Number.isFinite(arrival.radiusM) && arrival.radiusM > 0 &&
    arrival.dwellSec === 5;
}

export function gpsArrivalPending(
  course: { id: string; demo: boolean },
  stage: Pick<Stage, "kind" | "arrival">,
) {
  return isGpsReviewCourse(course) && stage.kind !== "prologue" &&
    !hasGpsArrival(stage.arrival);
}
