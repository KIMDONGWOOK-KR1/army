// 위도·경도를 지도 원점 기준 미터 좌표로 바꾼다. x는 동쪽, z는 남쪽(+z)이다.
// 캠퍼스 몇 km 안에서는 등장방형 근사의 오차가 0.1% 아래라 거리 감각에 충분하다.
export type LatLng = { lat: number; lng: number };
export type XZ = { x: number; z: number };

const R = 6371000,
  RAD = Math.PI / 180;

export function projector(origin: LatLng) {
  const kz = R * RAD,
    kx = kz * Math.cos(origin.lat * RAD);
  return {
    toLocal: (p: LatLng): XZ => ({
      x: (p.lng - origin.lng) * kx,
      z: -(p.lat - origin.lat) * kz,
    }),
    toLatLng: (p: XZ): LatLng => ({
      lat: origin.lat - p.z / kz,
      lng: origin.lng + p.x / kx,
    }),
  };
}

// 평평한 [x0, z0, x1, z1, …] 꺾은선의 길이와, 시작점에서 s미터 간 지점
export function polylineLength(p: ArrayLike<number>) {
  let len = 0;
  for (let i = 2; i < p.length; i += 2)
    len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return len;
}

export function pointAlong(p: ArrayLike<number>, s: number): XZ {
  if (p.length < 4 || s <= 0) return { x: p[0], z: p[1] };
  for (let i = 2; i < p.length; i += 2) {
    const dx = p[i] - p[i - 2],
      dz = p[i + 1] - p[i - 1],
      seg = Math.hypot(dx, dz);
    if (s <= seg && seg > 0) {
      const t = s / seg;
      return { x: p[i - 2] + dx * t, z: p[i - 1] + dz * t };
    }
    s -= seg;
  }
  return { x: p[p.length - 2], z: p[p.length - 1] };
}

// 꺾은선 위에서 점(x, z)과 가장 가까운 지점이 시작점에서 몇 미터인지
export function closestAlong(p: ArrayLike<number>, x: number, z: number) {
  let best = Infinity,
    at = 0,
    walked = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2],
      az = p[i - 1],
      dx = p[i] - ax,
      dz = p[i + 1] - az,
      seg2 = dx * dx + dz * dz,
      seg = Math.sqrt(seg2),
      t =
        seg2 > 0
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / seg2))
          : 0,
      d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      at = walked + seg * t;
    }
    walked += seg;
  }
  return at;
}
