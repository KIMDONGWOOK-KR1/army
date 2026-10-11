import { closestAlong, pointAlong } from "./geo";

// The avatar is deliberately larger than life. Reserve room for its body as well
// as the tree crown, including around turns and the ends of each walking leg.
export const WALKING_BODY_RADIUS = 2;
export function clearsWalkingRoute(
  legs: readonly number[][], x: number, z: number, crownRadius: number,
) {
  return legs.every((leg) => {
    if (leg.length < 4) return true;
    const p = pointAlong(leg, closestAlong(leg, x, z));
    return Math.hypot(x - p.x, z - p.z) >= crownRadius + WALKING_BODY_RADIUS;
  });
}
