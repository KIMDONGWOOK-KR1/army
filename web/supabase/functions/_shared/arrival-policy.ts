import type { Stage } from "./types.ts";

// No server-only imports: the UI and engine must expose the same dev-only action.
export function allowsSimulatedArrival(
  course: { id: string; demo: boolean },
  arrival: Pick<Stage["arrival"], "confirmed">,
) {
  return course.demo && /^jnu-demo-dev-[a-z0-9_-]+$/.test(course.id) &&
    course.id.length <= 40 && !arrival.confirmed;
}

export function hasGpsArrival(arrival: Stage["arrival"]) {
  return arrival.mode === "gps" && arrival.confirmed &&
    arrival.require === "all" &&
    typeof arrival.lat === "number" && Number.isFinite(arrival.lat) && Math.abs(arrival.lat) <= 90 &&
    typeof arrival.lng === "number" && Number.isFinite(arrival.lng) && Math.abs(arrival.lng) <= 180 &&
    typeof arrival.radiusM === "number" && Number.isFinite(arrival.radiusM) && arrival.radiusM > 0 &&
    arrival.dwellSec === 5;
}
