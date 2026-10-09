// 모이기(로비)·보직 공개·장비 장면의 입체 배경 구도. three 없이 숫자만 다뤄 단위 시험으로 본다.
//
// 첫 화면과 같은 자리(정문 바깥, 민주대로를 등진 네 자리)에 장병이 하나씩 걸어 들어와 선다.
// 정문 안쪽 길에서 나와 문을 지나 자기 자리까지 걷고, 다 서면 카메라 쪽을 본다.
// 정문은 5·18 사적지라 걷기·서기 동작만 쓴다(경례·행진·무기 없음).

import { HOME, type XZ } from "./home-view";

export const GATHER = {
  soldierM: HOME.soldierM,
  // 장병이 화면 띠에서 차지하는 키 비율: 넷이 줄 선 장면, 내 장병만 크게 비추는 장비 장면
  share: { line: 0.4, self: 0.6 },
  fill: 0.96, // 네 사람 줄(양 끝 장병·소품 포함)이 화면 너비에서 차지하는 비율
  span: HOME.spacing * 3 + 4.2, // 네 사람 줄 너비(m): 양 끝 장병 사이 + 몸통·깃발 여유
  elevation: { line: 0.2, self: 0.15 }, // 내려다보는 각(rad)
  azimuth: { line: 0, self: 0.24 }, // 정면에서 돈 각(rad): 장비 장면은 등 소품이 조금 보이게
  dist: { min: 16, max: 110 },
  // 걸어 들어오기: 정문 안쪽 길(정문 가운데에서 안쪽으로 from m)에서 출발해 speed m/s로 걷는다
  walk: { from: 9, speed: 3.6, stagger: 0.7 },
  ease: 2.6, // 카메라가 새 구도로 옮겨 가는 빠르기(1/초)
  // 움직이는 것(걸어 들어오기·카메라 옮기기·소품 튀어나오기)이 있으면 초당 30장, 다 서면 15장
  fps: { active: 30, settled: 15 },
  pixelRatio: 1.25,
  ring: 0.62, // 발밑 고리 크기 배율(첫 화면과 같다)
  dots: 18, // 빈 자리 점선 고리의 점 수
};

// 들어온 차례(0부터)로 선 자리: 화면 왼쪽부터 채운다(soldierSpots는 화면 오른쪽부터 늘어선다)
export const slotSpot = <T>(spots: readonly T[], index: number) =>
  spots[spots.length - 1 - index];

// 장병이 걸어 나오기 시작하는 자리: 정문 안쪽 길 위, 자기 자리 쪽으로 조금 비켜
export function spawnPoint(gate: XZ, axis: XZ, spot: XZ): XZ {
  const k = 0.25;
  return {
    x: gate.x + axis.x * GATHER.walk.from + (spot.x - gate.x) * k,
    z: gate.z + axis.z * GATHER.walk.from + (spot.z - gate.z) * k,
  };
}

// 걷기 한 번: startAt(ms)에 from을 떠나 speed m/s로 to까지 곧게 걷는다. 프레임 간격이 아니라
// 흐른 시간으로 자리를 정해, 느린 기기에서 장면이 띄엄띄엄 그려져도 제때 자리에 닿는다.
export type Walk = { from: XZ; to: XZ; startAt: number; speed: number };
export function walkAt(w: Walk, now: number) {
  const dx = w.to.x - w.from.x,
    dz = w.to.z - w.from.z,
    d = Math.hypot(dx, dz),
    dur = d / Math.max(1e-6, w.speed),
    t = (now - w.startAt) / 1000;
  if (t < 0)
    return { x: w.from.x, z: w.from.z, started: false, arrived: false };
  if (t >= dur || d < 1e-6)
    return { x: w.to.x, z: w.to.z, started: true, arrived: true };
  const k = t / dur;
  return {
    x: w.from.x + dx * k,
    z: w.from.z + dz * k,
    started: true,
    arrived: false,
  };
}

// 카메라 거리(m): 장병 키가 화면 띠(bandH px)의 share만큼 차고, span(m)을 주면 그 너비가
// 화면 너비의 fill 안에 들어오도록 둘 중 먼 쪽을 고른다. fov는 세로 시야각(도).
export function viewDistance(o: {
  viewW: number;
  viewH: number;
  bandH: number;
  fov: number;
  share: number;
  span?: number;
}) {
  const t = Math.tan(((o.fov / 2) * Math.PI) / 180),
    want = Math.max(60, o.bandH * o.share),
    byHeight = (GATHER.soldierM * o.viewH) / (2 * t * want),
    aspect = o.viewW / Math.max(1, o.viewH),
    byWidth = o.span ? o.span / 2 / (t * aspect * GATHER.fill) : 0;
  return Math.min(
    GATHER.dist.max,
    Math.max(GATHER.dist.min, byHeight, byWidth),
  );
}

// 두 각 사이를 짧은 쪽으로 t만큼
export function turnToward(from: number, to: number, t: number) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * Math.min(1, Math.max(0, t));
}

// GPU 없이 CPU로 그리는 WebGL(SwiftShader·llvmpipe 등, GPU가 막힌 기기)인지 렌더러 이름으로 본다.
// 이런 기기에서는 지도를 굽고 셰이더를 엮는 동안 화면이 수십 초 멈춰 합류·보직 공개 갱신을
// 놓치므로, 모이기 화면은 입체 대신 평면 그림을 쓴다(이동 화면의 입체는 그대로 둔다).
export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver/i.test(
    name,
  );
}

// 주소의 ?3d=1: 소프트웨어 WebGL에서도 모이기 화면을 입체로 띄운다(개발·화면 찍기용)
export const gatherFlags = (search: string) => ({
  force3d: new URLSearchParams(search).get("3d") === "1",
});
