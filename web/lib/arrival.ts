export type Fix = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};
export type Target = { lat: number; lng: number; radiusM: number };
export function haversine(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180,
    x =
      Math.sin(((c - a) * rad) / 2) ** 2 +
      Math.cos(a * rad) *
        Math.cos(c * rad) *
        Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}
/** PRD requires three samples; conservative error/gap reset awaits field validation.
 * The original recorder accepts partial windows and carries dwell across discarded fixes/gaps.
 */
export function judgeArrival(samples: Fix[], target: Target) {
  let window: Fix[] = [],
    since: number | null = null,
    last: number | null = null,
    distance: number | null = null,
    dwell = 0,
    arrived = false;
  for (const f of samples) {
    if (
      ![f.lat, f.lng, f.accuracy, f.timestamp].every(Number.isFinite) ||
      Math.abs(f.lat) > 90 ||
      Math.abs(f.lng) > 180 ||
      f.accuracy < 0 ||
      f.accuracy > 40
    ) {
      window = [];
      since = null;
      dwell = 0;
      arrived = false;
      continue;
    }
    if (last !== null && f.timestamp <= last) continue;
    if (last !== null && f.timestamp - last > 5000) {
      window = [];
      since = null;
      dwell = 0;
      arrived = false;
    }
    last = f.timestamp;
    window.push(f);
    window = window.slice(-3);
    if (window.length < 3) continue;
    distance = haversine(
      window.reduce((s, x) => s + x.lat, 0) / 3,
      window.reduce((s, x) => s + x.lng, 0) / 3,
      target.lat,
      target.lng,
    );
    if (distance <= target.radiusM) {
      since ??= f.timestamp;
      dwell = f.timestamp - since;
      arrived = dwell >= 5000;
    } else {
      since = null;
      dwell = 0;
      arrived = false;
    }
  }
  return { arrived, distance, dwell, validSamples: window.length };
}
