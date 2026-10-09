// 첫 화면(타이틀) 입체 배경의 구도와 카메라 길. three 없이 숫자만 다뤄 단위 시험으로 본다.
//
// 정문 바깥(남쪽)에서 정문 너머 민주대로를 따라 용봉탑·용봉관 쪽(북북동)을 바라본다.
// 네 보직 장병은 정문 바로 앞에 나란히 서서 카메라 쪽을 보고 조용히 서 있다
// (정문은 5·18 사적지 제1호: 경례·무기·행진 없이 서기 동작만).
// 카메라는 천천히 좌우로 흔들리며 다가갔다 물러나는 길을 끊김 없이 되풀이한다.

export type XZ = { x: number; z: number };

export const HOME = {
  soldierM: 5.6, // 장병 키(m). 정문(높이 약 17m, 문 사이 15m)과 어울리는 장난감 축척
  spacing: 3.6, // 장병 사이 간격(m)
  front: 9, // 정문 가운데에서 바깥쪽으로 장병이 선 거리(m)
  arc: 0.9, // 가운데 두 사람보다 양 끝이 이만큼(m) 뒤로 물러서 살짝 둥글게 선다
  fan: 0.12, // 양 끝 장병이 가운데 쪽으로 돌아선 각(rad)
  aim: 0.5, // 장병 키의 이 높이를 화면 띠 가운데에 둔다
  // 카메라: 장병까지 거리는 화면 띠에 장병이 heightShare만큼 차도록 고르고 [min, max]로 묶는다
  heightShare: 0.3,
  dist: { min: 30, max: 90 },
  elevation: 0.2, // 내려다보는 각(rad, 약 11°)
  swing: 0.16, // 좌우로 흔들리는 폭(rad, 약 9°): 민주대로 끝 용봉관이 나무에 가리지 않을 만큼
  dolly: 0.08, // 다가갔다 물러나는 폭(거리 비율)
  period: 44, // 한 바퀴(초)
  intro: { sec: 3.6, lift: 0.22, back: 0.35 }, // 처음 뜰 때 위·뒤에서 내려앉는 정도
  fps: 30, // 배경이라 초당 30장만 그린다
  pixelRatio: 1.25,
  fog: { near: 120, far: 640 }, // 안개 시작(장병 거리 + near)·끝(far, 하늘 공 안쪽)
};

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

// t초에 카메라가 장병을 보는 자리: 정면에서 돈 각(az, 오른쪽 +), 거리 배율, 내려다보는 각
export function homeCamera(t: number, reduced = false) {
  if (reduced) return { az: 0, distK: 1, elevation: HOME.elevation };
  const p = (2 * Math.PI * t) / HOME.period,
    intro = 1 - easeOut(t / HOME.intro.sec);
  return {
    az: HOME.swing * Math.sin(p),
    // 처음(t=0)에 가장 멀고 반 바퀴 동안 다가간다. 첫 등장은 조금 더 뒤에서 내려앉는다.
    distK: (1 + HOME.dolly * Math.cos(p)) * (1 + HOME.intro.back * intro),
    elevation: HOME.elevation + HOME.intro.lift * intro,
  };
}

// 정문에서 용봉탑 쪽(안쪽) 단위 방향
export function roadAxis(gate: XZ, toward: XZ): XZ {
  const dx = toward.x - gate.x,
    dz = toward.z - gate.z,
    l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

// 네 장병이 설 자리와 바라볼 방향(rotation.y, +z가 앞). 정문 바깥에 한 줄로 서서 바깥(카메라)을 본다.
export function soldierSpots(gate: XZ, axis: XZ, count = 4) {
  // 바깥 방향(-axis)과, 바깥을 볼 때 오른쪽(카메라에서 보면 왼쪽)
  const out = { x: -axis.x, z: -axis.z },
    side = { x: axis.z, z: -axis.x },
    face = Math.atan2(out.x, out.z);
  return Array.from({ length: count }, (_, i) => {
    const k = i - (count - 1) / 2, // -1.5, -0.5, 0.5, 1.5
      back = Math.abs(k) > 1 ? HOME.arc : 0,
      along = HOME.front - back;
    return {
      x: gate.x + out.x * along + side.x * k * HOME.spacing,
      z: gate.z + out.z * along + side.z * k * HOME.spacing,
      ry: face + (Math.abs(k) > 1 ? Math.sign(k) * HOME.fan : 0),
    };
  });
}

// 장병 키 h(m)가 화면 띠(px)의 heightShare를 차지하는 카메라 거리(m).
// viewH는 캔버스 높이(px), fov는 세로 시야각(도).
export function heroDistance(viewH: number, bandH: number, fov: number) {
  const want = Math.max(60, bandH * HOME.heightShare),
    d =
      (HOME.soldierM * viewH) /
      (2 * Math.tan(((fov / 2) * Math.PI) / 180) * want);
  return Math.min(HOME.dist.max, Math.max(HOME.dist.min, d));
}

// 화면 띠(캔버스 위에서 top~bottom px) 가운데에 장병을 두는 setViewOffset의 y(px)
export function bandOffset(viewH: number, top: number, bottom: number) {
  const t = Math.max(0, Math.min(viewH, top)),
    b = Math.max(t, Math.min(viewH, bottom));
  // 띠가 너무 좁으면(가로로 누운 낮은 화면) 화면 가운데 근처로 물린다
  // 띠 가운데보다 조금 아래(58%)에 두어 장병 뒤로 정문과 민주대로가 더 보이게 한다
  const center = b - t < 80 ? viewH * 0.55 : t + (b - t) * 0.58;
  return viewH / 2 - center;
}
