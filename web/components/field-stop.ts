import * as THREE from "three";
import { chamferBox } from "./field-props-kit";

// 거점 표석: 낮은 화강석 받침 위 남색 기둥 끝에 붉은 육각 메달(노란 얼굴, 남색 테)이 선다.
// 도착 반경에 들어서면 기둥이 받침 안으로 내려가고, 받침 위에 '기록 액자'(크림 바탕·남색 틀의
// 4:3 둥근 사각 액자, 오른쪽 아래 붉은 記 도장)가 서서 거점 그림을 보여 준다. 액자는 늘 카메라
// 쪽으로 돌아서되 땅에 선 채(기울지 않고 뒤로 10°만 젖힌다) 건물 처마보다 낮게 둔다.
// 다녀온 거점은 돌빛 메달에 크림 확인 도장을 찍고 멈춘다.
// 조용한 구역(5·18 사적지)에서는 돌지도, 떠오르지도, 흔들리지도 않고 조용히 열린다.
const NAVY = "#1f2a44",
  RED = "#e8452c",
  YELLOW = "#ffc53d",
  CREAM = "#fff6e2",
  GRANITE = "#d9d0c0",
  VISITED = "#9aa3b5"; // 다녀온 거점: 돌빛

export const STOP = {
  pole: 10, // 기둥 높이(m)
  poleCalm: 6.5, // 조용한 구역의 기둥 높이(m)
  plinth: { w: 8.0, h: 0.8, d: 1.8, closed: 3.0 }, // 받침(닫혔을 때는 가로 3.0m)
  frame: { w: 7.2, h: 5.4, r: 0.6, border: 0.3, legs: 1.2, lean: 0.17 }, // 기록 액자(m, 젖힘 rad)
  scale: { now: 1.35, nowCalm: 1.1, other: 0.95 },
  spin: 0.9, // 메달이 도는 빠르기(rad/s, 조용한 구역은 0)
};

// 표석을 세우는 자리: 도착을 재는 거점 자리(원)에서 이만큼(m, x 동쪽·z 남쪽) 비켜 선다.
// 표석이 거점의 랜드마크(정문 가운데 분리대, 용봉관 가운데 칸·시계탑)를 가리지 않게 한다.
// world.sites 차례: 정문(동쪽 채 바깥 기둥 옆 잔디, 문 줄보다 2m 앞), 용봉관(가운데 길 서쪽,
// 서쪽 날개 앞 잔디). 정문 모형은 -0.355rad 돌고 1.65배라 [12, 0]은 경비실 바로 뒤(안쪽)에
// 숨는다. [21, 10]은 문 틀로 (23, 2), 바깥 기둥(18.6)에서 3.5m 비켜 있고 보행로와 5m 넘게 떨어진다.
export const STOP_OFFSET: readonly (readonly [number, number])[] = [
  [21, 10],
  [-14, 4],
];
export const markerAt = (i: number, site: { x: number; z: number }) => {
  const o = STOP_OFFSET[i] ?? [0, 0];
  return { x: site.x + o[0], z: site.z + o[1] };
};

export type StopState = "now" | "next" | "done";
// 메달이 도는 빠르기: 다녀온 거점과 조용한 구역은 멈춘다
export const stopSpinRate = (state: StopState, calm: boolean) =>
  state === "done" || calm ? 0 : STOP.spin;
// 기둥 높이와 '지금' 거점 배율
export const stopPole = (calm: boolean) => (calm ? STOP.poleCalm : STOP.pole);
export const stopScale = (state: StopState, calm: boolean) =>
  state === "now" ? (calm ? STOP.scale.nowCalm : STOP.scale.now) : STOP.scale.other;
// 펼친 액자 꼭대기 높이(m, 땅에서). 처마선 아래인지 시험에서 본다.
export const frameTop = (calm: boolean) =>
  (STOP.plinth.h + STOP.frame.legs + STOP.frame.h * Math.cos(STOP.frame.lean)) *
  stopScale("now", calm);

export type StopMarker = {
  group: THREE.Group;
  // 눌렀는지 가릴 때 쓰는 물체(보이지 않는다)
  hit: THREE.Mesh;
  update(o: {
    t: number;
    dt: number;
    camera: THREE.Camera;
    open: boolean;
    state: StopState;
    calm: boolean;
  }): void;
  // 멀리서 눌렀을 때 아직 닫혀 있다고 살짝 흔든다(조용한 구역은 흔들지 않는다)
  nudge(): void;
};

// 가운데 맞춘 둥근 사각형
function roundRect(w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()) {
  const x = -w / 2,
    y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// 평면 둥근 사각형에 (0~1) 무늬 좌표를 준다. v는 [v0, v1]로 잘라 정사각 그림을 가운데에서 맞춘다.
function plate(w: number, h: number, r: number, v0 = 0, v1 = 1) {
  const g = new THREE.ShapeGeometry(roundRect(w, h, r) as THREE.Shape, 6),
    p = g.attributes.position,
    uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, (p.getX(i) + w / 2) / w, v0 + ((p.getY(i) + h / 2) / h) * (v1 - v0));
  return g;
}

// 크림 記 도장(붉은 바탕). 글자는 그리지 못해도(글꼴 없음) 붉은 도장은 남는다.
let sealTex: THREE.Texture | null = null;
function sealTexture() {
  if (sealTex || typeof document === "undefined") return sealTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  if (!x) return null;
  x.fillStyle = RED;
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = CREAM;
  x.lineWidth = 5;
  x.strokeRect(10, 10, 108, 108);
  x.fillStyle = CREAM;
  x.font = '700 78px "Black Han Sans", "Noto Sans KR", serif';
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("記", 64, 70);
  sealTex = new THREE.CanvasTexture(c);
  sealTex.colorSpace = THREE.SRGBColorSpace;
  sealTex.userData.shared = true;
  return sealTex;
}

// 다녀온 거점의 확인 도장(✓ 모양 두 막대)
function checkMark() {
  const s = new THREE.Shape();
  s.moveTo(-1.05, 0.15);
  s.lineTo(-0.6, 0.6);
  s.lineTo(-0.25, 0.22);
  s.lineTo(0.75, 1.1);
  s.lineTo(1.15, 0.65);
  s.lineTo(-0.25, -0.75);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

export function stopMarker(image: string | null): StopMarker {
  const g = new THREE.Group();
  const lit = (color: string) =>
    new THREE.MeshLambertMaterial({ color });
  const F = STOP.frame,
    PL = STOP.plinth;

  // 받침: 낮은 화강석 덩어리(액자와 함께 카메라 쪽으로 돈다)
  const stand = new THREE.Group();
  const plinth = new THREE.Mesh(chamferBox(PL.w, PL.h, PL.d, 0.22), lit(GRANITE));
  plinth.position.y = PL.h / 2;
  plinth.castShadow = true;
  stand.add(plinth);
  g.add(stand);

  // 기둥: 밑동이 받침 위에 붙어 있어 아래로 줄어들며 받침 안으로 내려간다
  const poleGeo = new THREE.CylinderGeometry(0.24, 0.34, 1, 10).translate(0, 0.5, 0);
  const pole = new THREE.Mesh(poleGeo, lit(NAVY));
  pole.position.y = PL.h;
  pole.castShadow = true;
  const head = new THREE.Group();
  // 손가락으로 누르기 쉽게 기둥·머리·액자를 감싸는 보이지 않는 원기둥
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, STOP.pole + 9, 12),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.y = (STOP.pole + 9) / 2;
  g.add(pole, head, hit);

  // 닫힌 모양: 육각 메달(앞뒤로 노란 원, 남색 육각 테). 다녀오면 돌빛에 크림 확인 도장.
  const medal = new THREE.Group();
  const body = lit(RED),
    faceMat = lit(YELLOW);
  const hex = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 1, 6).rotateX(Math.PI / 2),
    body,
  );
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(1.45, 1.45, 1.18, 32).rotateX(Math.PI / 2),
    faceMat,
  );
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.22, 8, 6), lit(NAVY));
  rim.rotation.z = Math.PI / 6; // 육각 기둥의 꼭짓점에 맞춘다
  hex.castShadow = true;
  const stampMat = new THREE.MeshBasicMaterial({ color: CREAM }),
    stamps = [1, -1].map((s) => {
      const m = new THREE.Mesh(checkMark(), stampMat);
      m.position.z = 0.6 * s;
      if (s < 0) m.rotation.y = Math.PI;
      m.visible = false;
      return m;
    });
  medal.add(hex, face, rim, ...stamps);
  head.add(medal);

  // 펼친 모양: 받침 위에 선 기록 액자(남색 틀, 크림 바탕, 거점 그림, 記 도장)
  const panel = new THREE.Group();
  const outer = roundRect(F.w, F.h, F.r) as THREE.Shape;
  outer.holes.push(roundRect(F.w - 2 * F.border, F.h - 2 * F.border, F.r * 0.6, new THREE.Path()));
  const frame = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outer, {
      depth: 0.3,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 2,
      curveSegments: 6,
    }).translate(0, 0, -0.15),
    lit(NAVY),
  );
  const back = new THREE.Mesh(
    new THREE.ExtrudeGeometry(roundRect(F.w - 0.2, F.h - 0.2, F.r * 0.8) as THREE.Shape, {
      depth: 0.2,
      bevelEnabled: false,
      curveSegments: 6,
    }).translate(0, 0, -0.17),
    lit(CREAM),
  );
  // 그림 칸: 크림 바탕 안 0.35m 여백. 정사각 그림을 가로에 맞춰 가운데를 자른다.
  const pw = F.w - 2 * F.border - 0.7,
    ph = F.h - 2 * F.border - 0.7,
    crop = ph / pw;
  const front = new THREE.MeshBasicMaterial({ color: "#cfe8f5" });
  const picture = new THREE.Mesh(plate(pw, ph, 0.25, 0.5 - crop / 2, 0.5 + crop / 2), front);
  picture.position.z = 0.05;
  const seal = new THREE.Mesh(
    plate(1.0, 1.0, 0.12),
    new THREE.MeshBasicMaterial({ color: "#ffffff", map: sealTexture() }),
  );
  seal.position.set(F.w / 2 - F.border - 0.75, -F.h / 2 + F.border + 0.75, 0.08);
  seal.rotation.z = -0.06;
  const legs = [-1, 1].map((s) => {
    const m = new THREE.Mesh(chamferBox(0.32, F.legs + 0.4, 0.32, 0.08), lit(NAVY));
    m.position.set(s * (F.w / 2 - 1.1), -F.h / 2 - (F.legs + 0.4) / 2 + 0.4, -0.05);
    return m;
  });
  frame.castShadow = back.castShadow = true;
  panel.add(frame, back, picture, seal, ...legs);
  // 액자 아래 가운데가 받침 위 다리 끝에 오게(뒤로 살짝 젖힌다)
  const tilt = new THREE.Group();
  panel.position.y = F.legs + F.h / 2;
  tilt.add(panel);
  tilt.position.y = PL.h;
  tilt.rotation.x = -F.lean;
  tilt.scale.setScalar(0.001);
  tilt.visible = false;
  stand.add(tilt);
  if (image)
    new THREE.TextureLoader().load(image, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      front.map = tex;
      front.color.set("#ffffff");
      front.needsUpdate = true;
    });

  let open = 0,
    spin = Math.random() * Math.PI * 2,
    wobble = 0,
    calmNow = false;
  const color = new THREE.Color(),
    red = new THREE.Color(RED),
    yellow = new THREE.Color(YELLOW),
    visited = new THREE.Color(VISITED),
    world = new THREE.Vector3();
  const easeBack = (x: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  };
  return {
    group: g,
    hit,
    update({ t, dt, camera, open: want, state, calm }) {
      calmNow = calm;
      const target = want && state === "now" ? 1 : 0;
      open += (target - open) * Math.min(1, dt * (target ? 3.2 : 5));
      if (Math.abs(target - open) < 0.002) open = target;
      const k = calm ? open : easeBack(open);
      // 액자는 받침 위에서 자라고, 기둥과 메달은 받침 안으로 내려간다
      tilt.visible = open > 0.01;
      tilt.scale.setScalar(Math.max(0.001, k));
      const P = stopPole(calm),
        down = 1 - open;
      pole.scale.y = Math.max(0.001, P * down);
      pole.visible = down > 0.01;
      medal.visible = open < 0.98;
      medal.scale.setScalar(Math.max(0.001, down));
      plinth.scale.x = PL.closed / PL.w + (1 - PL.closed / PL.w) * open;
      // 메달은 천천히 돈다(다녀온 거점·조용한 구역은 멈춘다)
      spin += dt * stopSpinRate(state, calm);
      medal.rotation.y = spin;
      // 받침·액자는 카메라 쪽으로 돈다(세로로 선 채)
      g.getWorldPosition(world);
      stand.rotation.y = Math.atan2(
        camera.position.x - world.x,
        camera.position.z - world.z,
      );
      const bob = calm || state === "done" ? 0 : Math.sin(t / 520) * 0.35;
      head.position.y = PL.h + (P + 2.3) * down + bob;
      wobble = Math.max(0, wobble - dt * 2.2);
      head.rotation.z = calm ? 0 : Math.sin(t / 45) * 0.18 * wobble;
      const done = state === "done";
      color.copy(done ? visited : red);
      body.color.lerp(color, Math.min(1, dt * 4));
      faceMat.color.lerp(done ? visited : yellow, Math.min(1, dt * 4));
      stamps.forEach((m) => (m.visible = done));
      g.scale.setScalar(stopScale(state, calm));
    },
    nudge() {
      if (!calmNow) wobble = 1;
    },
  };
}

// 내 캐릭터 발밑에서 천천히 한 겹 퍼지는 크림 발자국 물결. 조용한 구역에서는 그리지 않는다.
export const RIPPLE = { period: 3200, from: 5, to: 14, opacity: 0.25 };
export function rippleState(t: number, calm: boolean) {
  const p = (t / RIPPLE.period) % 1;
  return {
    visible: !calm,
    scale: RIPPLE.from + p * (RIPPLE.to - RIPPLE.from),
    opacity: calm ? 0 : RIPPLE.opacity * (1 - p),
  };
}
export function footRipple() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 72),
    new THREE.MeshBasicMaterial({
      color: CREAM,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 3;
  return {
    group: m,
    update(t: number, x: number, z: number, calm: boolean) {
      const s = rippleState(t, calm);
      m.visible = s.visible;
      if (!s.visible) return;
      m.position.set(x, 0.62, z);
      m.scale.setScalar(s.scale);
      (m.material as THREE.MeshBasicMaterial).opacity = s.opacity;
    },
  };
}

// 다음 거점까지 남은 길을 흰 점선으로 보여 준다. 점이 걷는 쪽으로 천천히 흐른다.
const GAP = 7,
  MAX_DOTS = 160;
// 흰 점 둘레에 남색 테(0.12m)를 둘러 마사토·밝은 길 위에서도 점이 또렷하게 한다(스타일 시트 2.2).
function dotGeometry() {
  const paint = (g: THREE.BufferGeometry, hex: string, a: number) => {
    const c = new THREE.Color(hex),
      n = g.attributes.position.count,
      rgba = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) rgba.set([c.r, c.g, c.b, a], i * 4);
    g.setAttribute("color", new THREE.BufferAttribute(rgba, 4));
    return g;
  };
  const rim = paint(new THREE.RingGeometry(0.8, 0.92, 16), NAVY, 0.65),
    dot = paint(new THREE.CircleGeometry(0.8, 16), "#ffffff", 1);
  // 테를 먼저, 흰 점을 나중에 그린다(깊이를 쓰지 않으므로 겹쳐 깜빡이지 않는다)
  const geo = new THREE.BufferGeometry(),
    parts = [rim, dot].map((g) => g.toNonIndexed());
  for (const name of ["position", "color"]) {
    const arrays = parts.map((g) => g.attributes[name].array as Float32Array),
      out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      out.set(a, o);
      o += a.length;
    }
    geo.setAttribute(
      name,
      new THREE.BufferAttribute(out, parts[0].attributes[name].itemSize),
    );
  }
  [rim, dot, ...parts].forEach((g) => g.dispose());
  return geo.rotateX(-Math.PI / 2);
}

export function routeDots() {
  const geo = dotGeometry();
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
    MAX_DOTS,
  );
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.count = 0;
  const m = new THREE.Matrix4();
  return {
    mesh,
    // along(s): 길 위 s미터 지점, from~to 사이에 점을 찍는다
    update(
      t: number,
      along: (s: number) => { x: number; z: number },
      from: number,
      to: number,
    ) {
      // 점 자리는 길 위에 고정된 간격(GAP)이고 시간이 갈수록 앞으로 민다.
      // 캐릭터 발밑(9m 안)과 거점 바로 앞(4m)은 비운다.
      const shift = ((t / 1000) * 2.5) % GAP,
        lo = from + 9;
      let n = 0;
      for (
        let s = lo + ((((shift - lo) % GAP) + GAP) % GAP);
        s < to - 4 && n < MAX_DOTS;
        s += GAP
      ) {
        const p = along(s);
        m.makeTranslation(p.x, 0.58, p.z);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
