// 현장 도구가 쓰는 방향·거리 계산(hh 2026-11-08: 그림 대신 진짜 카메라·나침반으로).
// 장소 좌표는 공개된 위치다(정답 아님). 정문 모이는 자리는 jnu-gps.ts의 정문 도착점, 나머지는 앱 지도
// (components/maps/jnu.json, OSM)의 정문 기준 미터 좌표(anchors)를 위경도로 바꾼 값이다.
export type LatLng = { lat: number; lng: number };

const EARTH = 6371000;
const RAD = Math.PI / 180;

export const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** 목표 방위에서 지금 방위를 뺀 값(-180~180). +면 목표가 오른쪽에 있다. */
export function angleDiff(target: number, heading: number) {
  const d = norm360(target - heading);
  return d > 180 ? d - 360 : d;
}

export function distanceM(a: LatLng, b: LatLng) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a에서 b를 볼 때의 진북 기준 방위(0~360, 시계 방향). */
export function bearingDeg(a: LatLng, b: LatLng) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lng - a.lng) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / RAD);
}

/** 기기 뒷면(뒤 카메라)이 향하는 방위. 안드로이드 deviceorientationabsolute의 alpha·beta·gamma로 구한다
 * (W3C Device Orientation 부록의 나침반 식). 폰을 세워 들어도, 눕혀 들어도 카메라 쪽을 가리킨다. */
export function rearHeading(alpha: number, beta: number, gamma: number) {
  const x = beta * RAD, y = gamma * RAD, z = alpha * RAD;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  return norm360(Math.atan2(vx, vy) / RAD);
}

/** 광주의 자기 편차(서편 약 8.5°). 폰 나침반은 자북을 가리키므로 진북으로 바꿀 때 더한다. */
export const DECLINATION = -8.5;
export const trueHeading = (magnetic: number) => norm360(magnetic + DECLINATION);

export const FIELD = {
  /** 정문 도착점(모이는 자리, jnu-gps.ts) */
  gate: { lat: 35.172851, lng: 126.905149 },
  /** 용봉관 도착점(jnu-gps.ts) */
  hall: { lat: 35.175722, lng: 126.906345 },
  /** 용봉탑(로터리 가운데) */
  tower: { lat: 35.17527, lng: 126.906146 },
  /** 정문 동쪽 5·18 소공원의 사적비 */
  park: { lat: 35.172721, lng: 126.905418 },
  /** 정문 서쪽, 길 건너 '피어나다' */
  bloom: { lat: 35.172751, lng: 126.904676 },
} satisfies Record<string, LatLng>;

/** 모이는 자리에서 본 방위. 현장 오차(나침반 ±20° 안팎)보다 장소 사이 각도가 넉넉해 고정값으로 쓴다. */
export const FIELD_BEARING = {
  hall: bearingDeg(FIELD.gate, FIELD.hall),
  park: bearingDeg(FIELD.gate, FIELD.park),
  bloom: bearingDeg(FIELD.gate, FIELD.bloom),
};

/** 신호 세기(0~1): 목표 쪽을 볼수록 1에 가깝다. 90° 넘게 벗어나면 0. */
export function signalStrength(diff: number) {
  const k = Math.max(0, 1 - Math.abs(diff) / 90);
  return k * k;
}

/** 탁본 만들기: 밝기 값(0~255, 가로 w)에서 새긴 선(밝기가 크게 바뀌는 곳)은 종이(0),
 * 평평한 돌 면은 먹(1)으로 바꾼다. 결과는 칸마다 먹 진하기(0~1). */
export function rubbingInk(lum: Float32Array, w: number, h: number, keep = 0.84) {
  const g = new Float32Array(w * h);
  // 3×3 평균을 두 번 걸어 돌 결의 잡티를 줄인 뒤 소벨 경사 크기를 잰다
  const blur = (src: Float32Array) => {
    const out = new Float32Array(w * h);
    const px = (x: number, y: number) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += px(x + i, y + j);
      out[y * w + x] = s / 9;
    }
    return out;
  };
  const soft = blur(blur(lum));
  const sv = (x: number, y: number) => soft[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = sv(x + 1, y - 1) + 2 * sv(x + 1, y) + sv(x + 1, y + 1) - sv(x - 1, y - 1) - 2 * sv(x - 1, y) - sv(x - 1, y + 1);
    const gy = sv(x - 1, y + 1) + 2 * sv(x, y + 1) + sv(x + 1, y + 1) - sv(x - 1, y - 1) - 2 * sv(x, y - 1) - sv(x + 1, y - 1);
    g[y * w + x] = Math.hypot(gx, gy);
  }
  // 경사가 큰 쪽 (1-keep)만 종이로 남긴다(사진마다 밝기가 달라도 비율은 같게)
  const sorted = Float32Array.from(g).sort();
  const t = Math.max(12, sorted[Math.floor(sorted.length * keep)] ?? 0);
  const ink = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const v = g[i] / t;
    ink[i] = v <= 0.75 ? 1 : v >= 1.15 ? 0 : (1.15 - v) / 0.4;
  }
  return ink;
}
