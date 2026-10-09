import type { Stage } from "./types.ts";

// User-selected targets and 10m trial radius (2026-10-09).
// Configuration approval is not a claim of four-device field validation.
export const JNU_GPS_POINTS = {
  gate: { lat: 35.172851, lng: 126.905149 },
  yongbong: { lat: 35.175722, lng: 126.906345 },
  bongji: { lat: 35.177269, lng: 126.906604 },
} as const;

export function jnuGpsArrival(site: keyof typeof JNU_GPS_POINTS): Stage["arrival"] {
  return {
    mode: "gps", confirmed: true, require: "all",
    ...JNU_GPS_POINTS[site], radiusM: 10, noticeM: 20, dwellSec: 5,
    note: "2026-10-09 사용자 지정 좌표·시험 반경 10m. 휴대폰 4대 현장 검증은 별도.",
  };
}
