import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { heroSoldier, type SoldierSocket } from "./field-assets";
import { ROLE_COLORS } from "./role-style";
import { SKIN_BASE, SKIN_TONES, type SoldierVariant } from "./soldier-variants";
import type { Role } from "@/supabase/functions/_shared/types";

// 네 보직 장병의 점토 소품과 사람마다 다른 모습(soldier-variants.ts)을 C02 장병에 입힌다.
// 소품은 받는 파일 없이 기본 도형을 꼭짓점 색으로 한 덩어리씩 구워 뼈에 단다(소품 하나 = 그리기 한 번).
// hh 2026-10-26 참고 그림처럼 보직마다 손에 든 소품과 자세로 한눈에 구분한다.
//   지휘관: 오른손으로 높이 든 파란 깃발, 왼팔 완장, 어깨 견장
//   정찰원: 두 손으로 눈에 댄 초록 쌍안경, 황토색 멜빵·배낭
//   통신원: 왼손으로 귀에 댄 주황 무전기, 등 무전기와 주황 멜빵
//   암호해독관: 두 손으로 든 큰 보라 열쇠, 보라 멜빵
// 같은 군복, 무기·계급장·실제 부대 표지 없음.
//
// 좌표는 쉬는 자세의 몸 좌표: 모형 키 1, 발바닥 y=0, 앞 +z, 장병의 왼쪽 +x.
// (몸통 앞면 z≈0.14@y0.30, 뒷면 z≈-0.16, 머리 y0.42~1.0·폭 ±0.31·뒤통수 z≈-0.37)

// 보직이 정해지기 전(로비) 완장·발밑 고리 색: 군청 회색
export const NEUTRAL_COLOR = "#8a94a8";

type V3 = [number, number, number];
type Part = { g: THREE.BufferGeometry; color: string; m?: THREE.Matrix4 };

const C = {
  navy: "#1f2a44",
  pole: "#6b4a2b",
  brass: "#e2b04a",
  cream: "#fef4da",
  olive: "#4f5b3a",
  oliveDark: "#3a4430",
  webbing: "#3d3426",
  lens: "#cfe9f5",
  charcoal: "#2b302c",
  tan: "#c98c45",
  orange: "#e07a30",
  orangeDark: "#9c4a1a",
  purple: "#8b6fd0",
  purpleDark: "#5f479e",
  lensBlue: "#a9daf0",
  flagBlue: "#2458a8",
  belt: "#6b4a2b",
  buckle: "#f2c230",
};

const mat = (p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...s),
  );
// a에서 b로 가는 막대(원기둥 축 y를 그 방향으로 돌린다)
function stick(a: V3, b: V3, r: number, color: string, seg = 6): Part {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b),
    d = B.clone().sub(A),
    len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    d.normalize(),
  );
  return {
    g: new THREE.CylinderGeometry(r, r, len, seg, 1),
    color,
    m: new THREE.Matrix4().compose(
      A.clone().add(B).multiplyScalar(0.5),
      q,
      new THREE.Vector3(1, 1, 1),
    ),
  };
}
const box = (
  size: V3,
  p: V3,
  color: string,
  r = 0.01,
  rot: V3 = [0, 0, 0],
): Part => ({
  g: new RoundedBoxGeometry(size[0], size[1], size[2], 1, r),
  color,
  m: mat(p, rot),
});

// 여러 도형을 꼭짓점 색 한 형상으로 굽는다. pivot을 원점으로 옮겨 두어(튀어나오는 크기 바꿈의 중심)
// 메시 위치를 pivot에 두면 제자리에서 커진다.
function bake(parts: Part[], pivot: V3) {
  const back = new THREE.Matrix4().makeTranslation(
    -pivot[0],
    -pivot[1],
    -pivot[2],
  );
  const list = parts.map(({ g, color, m }) => {
    let x = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    if (m) x.applyMatrix4(m);
    x.applyMatrix4(back);
    for (const name of Object.keys(x.attributes))
      if (name !== "position" && name !== "normal") x.deleteAttribute(name);
    const c = new THREE.Color(color),
      n = x.attributes.position.count,
      col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    x.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return x;
  });
  const out = mergeGeometries(list, false)!;
  list.forEach((x) => x.dispose());
  return out;
}

// 보직마다 소품(붙일 뼈, 굽는 도형, 중심). 형상은 한 번 구워 여러 장병이 함께 쓴다.
// grips: 손으로 쥐는 곳(쉬는 자세의 몸 좌표)과 팔꿈치가 향할 쪽. 서기·걷기 동작 위에서 팔을 그곳으로 뻗는다.
type Hand = "left" | "right";
type Grip = { hand: Hand; at: V3; pole: V3 };
type PropSpec = { socket: SoldierSocket; pivot: V3; parts: () => Part[]; grips?: Grip[] };

// 가슴 앞 멜빵 두 줄(어깨에서 내려오는 띠)
const straps = (color: string): Part[] =>
  [-1, 1].map((sx) => box([0.036, 0.11, 0.016], [sx * 0.085, 0.322, 0.116], color, 0.006, [-0.4, 0, 0]));

// 축 u 방향으로 돌린 상자(열쇠 이빨처럼 막대에 붙는 조각)
const along = (size: V3, at: THREE.Vector3, angle: number, color: string): Part =>
  box(size, [at.x, at.y, at.z], color, 0.006, [0, 0, angle]);

const SPECS: Record<Role, PropSpec[]> = {
  commander: [
    // 왼팔 위쪽에 두른 완장(팔 방향을 따라 세운 짧은 원통)
    {
      socket: "arm",
      pivot: [0.163, 0.345, -0.03],
      parts: () => {
        const dir = new THREE.Vector3(0.57, -0.82, -0.05).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir,
        );
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(0.163, 0.345, -0.03),
          q,
          new THREE.Vector3(1, 1, 1),
        );
        return [
          {
            g: new THREE.CylinderGeometry(0.062, 0.06, 0.05, 14, 1, true),
            color: ROLE_COLORS.commander,
            m,
          },
          {
            g: new THREE.CylinderGeometry(0.0635, 0.0635, 0.012, 14, 1, true),
            color: C.cream,
            m: m.clone().multiply(mat([0, 0.012, 0])),
          },
        ];
      },
    },
    // 두 어깨의 파란 견장
    {
      socket: "hips",
      pivot: [0, 0.405, -0.025],
      parts: () => [-1, 1].map((sx) => box([0.075, 0.028, 0.072], [sx * 0.152, 0.405, -0.025], ROLE_COLORS.commander, 0.012)),
    },
    // 오른손으로 높이 든 깃대와 머리 위로 날리는 파란 삼각 깃발
    {
      socket: "hips",
      pivot: [-0.3, 0.5, 0.03],
      grips: [{ hand: "right", at: [-0.3, 0.5, 0.03], pole: [-0.6, -0.5, -0.6] }],
      parts: () => {
        const base: V3 = [-0.285, 0.36, 0.035],
          tip: V3 = [-0.4, 1.2, -0.01];
        const A = new THREE.Vector3(...base),
          d = new THREE.Vector3(...tip).sub(A);
        const top = A.clone().addScaledVector(d, 0.7);
        const h = 0.24;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(0, h);
        shape.lineTo(0.36, h * 0.52);
        shape.closePath();
        const flag = new THREE.ExtrudeGeometry(shape, {
          depth: 0.026,
          bevelEnabled: true,
          bevelThickness: 0.008,
          bevelSize: 0.008,
          bevelSegments: 2,
        });
        const flagAt = new THREE.Matrix4()
          .compose(
            top,
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
            new THREE.Vector3(1, 1, 1),
          )
          .multiply(mat([0.008, 0, -0.013]));
        return [
          stick(base, tip, 0.015, C.pole, 8),
          { g: new THREE.SphereGeometry(0.03, 12, 10), color: C.brass, m: mat(tip) },
          { g: flag, color: C.flagBlue, m: flagAt },
        ];
      },
    },
  ],
  scout: [
    // 두 손으로 눈에 댄 큰 초록 쌍안경(머리를 따라 움직인다)
    {
      socket: "head",
      pivot: [0, 0.6, 0.26],
      grips: [
        { hand: "left", at: [0.2, 0.535, 0.16], pole: [1, -0.2, -0.3] },
        { hand: "right", at: [-0.2, 0.535, 0.16], pole: [-1, -0.2, -0.3] },
      ],
      parts: () => {
        const parts: Part[] = [];
        const tube = (r0: number, r1: number, len: number, x: number, z: number, color: string): Part => ({
          g: new THREE.CylinderGeometry(r0, r1, len, 18),
          color,
          m: mat([x, 0.6, z], [Math.PI / 2, 0, 0]),
        });
        for (const sx of [-1, 1]) {
          const x = sx * 0.088;
          parts.push(
            tube(0.082, 0.078, 0.15, x, 0.27, ROLE_COLORS.scout),
            tube(0.058, 0.058, 0.03, x, 0.183, C.oliveDark),
            { g: new THREE.TorusGeometry(0.07, 0.024, 10, 24), color: ROLE_COLORS.scout, m: mat([x, 0.6, 0.345]) },
            { g: new THREE.CircleGeometry(0.06, 20), color: C.lensBlue, m: mat([x, 0.6, 0.35]) },
            { g: new THREE.CircleGeometry(0.02, 12), color: "#f4fbff", m: mat([x + 0.022, 0.622, 0.352]) },
          );
        }
        parts.push(box([0.07, 0.06, 0.08], [0, 0.6, 0.27], "#1b5e44", 0.02));
        return parts;
      },
    },
    // 가슴 멜빵과 등에 멘 작은 배낭(황토색)
    {
      socket: "hips",
      pivot: [0, 0.31, -0.05],
      parts: () => [...straps(C.tan), box([0.22, 0.16, 0.09], [0, 0.31, -0.2], C.tan, 0.03)],
    },
  ],
  signal: [
    // 등에 멘 무전기 상자와 비스듬한 짧은 안테나, 앞가슴에 보이는 주황 멜빵 두 줄
    {
      socket: "hips",
      pivot: [0, 0.32, -0.19],
      parts: () => [
        box([0.25, 0.17, 0.11], [0, 0.32, -0.19], C.olive, 0.025),
        box([0.17, 0.08, 0.02], [0, 0.34, -0.247], C.oliveDark, 0.008),
        {
          g: new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10),
          color: ROLE_COLORS.signal,
          m: mat([-0.05, 0.345, -0.26], [Math.PI / 2, 0, 0]),
        },
        box([0.03, 0.03, 0.02], [0.05, 0.345, -0.258], C.cream, 0.006),
        ...straps(C.orange),
      ],
    },
    // 왼손으로 귀에 댄 주황 무전기와 안테나
    {
      socket: "head",
      pivot: [0.35, 0.58, 0.1],
      grips: [{ hand: "left", at: [0.35, 0.47, 0.1], pole: [0.8, -0.5, -0.4] }],
      parts: () => [
        box([0.12, 0.22, 0.08], [0.35, 0.58, 0.1], C.orange, 0.03),
        box([0.08, 0.08, 0.012], [0.35, 0.53, 0.142], C.orangeDark, 0.008),
        box([0.07, 0.03, 0.012], [0.35, 0.635, 0.142], C.cream, 0.008),
        stick([0.375, 0.69, 0.09], [0.405, 0.9, 0.06], 0.012, C.charcoal),
        { g: new THREE.SphereGeometry(0.024, 10, 8), color: C.charcoal, m: mat([0.405, 0.9, 0.06]) },
      ],
    },
  ],
  cipher: [
    // 두 손으로 몸 앞에 비스듬히 든 큰 보라 열쇠
    {
      socket: "hips",
      pivot: [0.02, 0.31, 0.19],
      grips: [
        { hand: "left", at: [0.12, 0.37, 0.2], pole: [0.8, -0.4, -0.4] },
        { hand: "right", at: [-0.08, 0.25, 0.2], pole: [-0.8, -0.4, -0.4] },
      ],
      parts: () => {
        const A = new THREE.Vector3(-0.17, 0.18, 0.19),
          B = new THREE.Vector3(0.26, 0.45, 0.19);
        const len = A.distanceTo(B);
        const u = B.clone().sub(A).normalize();
        const v = new THREE.Vector3(u.y, -u.x, 0); // 막대에 수직(아래쪽)
        const angle = Math.atan2(u.y, u.x);
        const at = (t: number, off: number) => A.clone().addScaledVector(u, t * len).addScaledVector(v, off);
        const bow = A.clone().addScaledVector(u, -0.07);
        return [
          stick([A.x, A.y, A.z], [B.x, B.y, B.z], 0.022, C.purple, 10),
          { g: new THREE.TorusGeometry(0.068, 0.022, 10, 22), color: C.purple, m: mat([bow.x, bow.y, bow.z]) },
          { g: new THREE.TorusGeometry(0.03, 0.012, 8, 16), color: C.purpleDark, m: mat([bow.x, bow.y, bow.z + 0.005]) },
          along([0.03, 0.06, 0.05], at(0.12, 0), angle, C.purpleDark),
          along([0.032, 0.085, 0.04], at(0.84, 0.045), angle, C.purple),
          along([0.032, 0.065, 0.04], at(0.95, 0.035), angle, C.purple),
        ];
      },
    },
    // 가슴의 보라 멜빵
    { socket: "hips", pivot: [0, 0.322, 0.116], parts: () => straps(C.purple) },
  ],
};

// 둥근 안경(머리 뼈): 얼굴 앞 눈 높이에 두 테와 코다리, 귀까지 가는 다리
const GLASSES: PropSpec = {
  socket: "head",
  pivot: [0, 0.612, 0.168],
  parts: () => {
    const parts: Part[] = [];
    for (const sx of [-1, 1]) {
      parts.push(
        {
          g: new THREE.TorusGeometry(0.046, 0.0075, 6, 20),
          color: C.navy,
          m: mat([sx * 0.088, 0.612, 0.168], [0, sx * 0.18, 0]),
        },
        stick(
          [sx * 0.132, 0.616, 0.152],
          [sx * 0.21, 0.626, 0.02],
          0.006,
          C.navy,
        ),
      );
    }
    parts.push(
      stick([-0.043, 0.622, 0.178], [0.043, 0.622, 0.178], 0.006, C.navy),
    );
    return parts;
  },
};

// 모든 장병의 갈색 허리띠와 노란 버클(참고 그림의 공통 복장)
const BELT: PropSpec = {
  socket: "hips",
  pivot: [0, 0.222, 0],
  parts: () => [
    { g: new THREE.CylinderGeometry(0.166, 0.17, 0.036, 28, 1, true), color: C.belt, m: mat([0, 0.222, -0.008], [0, 0, 0], [1, 1, 0.86]) },
    box([0.056, 0.04, 0.022], [0, 0.222, 0.142], C.buckle, 0.008),
  ],
};

const baked = new Map<PropSpec, THREE.BufferGeometry>();
function geometryOf(spec: PropSpec) {
  let g = baked.get(spec);
  if (!g) {
    g = bake(spec.parts(), spec.pivot);
    // 화면을 닫을 때(disposeTree) 지우지 않고 다음 화면에서 다시 쓴다
    g.userData.shared = true;
    baked.set(spec, g);
  }
  return g;
}

function propMesh(spec: PropSpec) {
  const m = new THREE.Mesh(
    geometryOf(spec),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0,
    }),
  );
  m.position.set(...spec.pivot);
  m.castShadow = true;
  m.name = "soldier-prop";
  return m;
}

// 보이지 않는 소품 하나. 장면에 미리 넣어 두면 첫 화면 준비(compileAsync) 때 소품 셰이더가
// 함께 만들어져, 보직 공개 순간 소품이 튀어나올 때 화면이 멈칫하지 않는다.
export function warmProp() {
  const m = propMesh(GLASSES);
  m.visible = false;
  m.castShadow = false;
  m.name = "soldier-prop-warm";
  return m;
}

// 튀어나오기: 0에서 조금 넘쳤다가 1로(약 0.45초)
const popScale = (t: number) => {
  if (t >= 1) return 1;
  const c = 2.2;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

// 팔 뻗기(두 마디): 어깨에서 손목까지 길이를 지키며 손목을 목표로, 팔꿈치는 pole 쪽으로 굽힌다.
// 모두 월드 좌표에서 계산하고, 뼈의 지역 회전으로 되돌려 넣는다.
const ARM_SCALE = 1.32;
const ARM_BONES: Record<Hand, [string, string, string]> = {
  left: ["LeftArm", "LeftForeArm", "LeftHand"],
  right: ["RightArm", "RightForeArm", "RightHand"],
};
const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3(),
  _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function aim(bone: THREE.Object3D, child: THREE.Object3D, want: THREE.Vector3) {
  bone.getWorldPosition(_s);
  child.getWorldPosition(_c).sub(_s).normalize();
  _q.setFromUnitVectors(_c, want);
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}
function reach(arm: THREE.Object3D[], target: THREE.Vector3, pole: THREE.Vector3, handLength: number) {
  const [upper, fore, hand] = arm;
  upper.getWorldPosition(_s);
  fore.getWorldPosition(_e);
  hand.getWorldPosition(_h);
  const a = _e.distanceTo(_s), b = _h.distanceTo(_e);
  // 주먹 가운데가 쥐는 곳에 오도록 손목은 조금 앞에서 멈춘다
  const goal = target.clone().addScaledVector(_n.copy(target).sub(_s).normalize(), -handLength);
  _n.copy(goal).sub(_s);
  const d = THREE.MathUtils.clamp(_n.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  _n.normalize();
  const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  const elbow = _s.clone().addScaledVector(_n, along).addScaledVector(_p, h);
  const wrist = _s.clone().addScaledVector(_n, d);
  aim(upper, fore, elbow.clone().sub(_s).normalize());
  fore.getWorldPosition(_e);
  aim(fore, hand, wrist.sub(_e).normalize());
}

export type CrewSoldier = ReturnType<typeof crewSoldier>;

function capBadge(role: Role): PropSpec {
  return { socket: "head", pivot: [0, 0.87, 0.255], parts: () => {
    const color = ROLE_COLORS[role];
    const parts: Part[] = [{ g: new THREE.CylinderGeometry(0.061, 0.061, 0.012, 20), color: C.cream, m: mat([0, 0.87, 0.255], [Math.PI / 2, 0, 0]) }];
    const z = 0.266;
    if (role === "commander") {
      parts.push(stick([-0.019,0.837,z], [-0.019,0.904,z], 0.006,color));
      parts.push(box([0.039,0.028,0.008],[0,0.889,z],color,0.003));
    } else if (role === "scout") {
      parts.push(box([0.037,0.037,0.008],[0,0.87,z],color,0.003,[0,0,Math.PI/4]));
      parts.push(stick([0,0.84,z+0.005],[0,0.9,z+0.005],0.004,C.cream));
    } else if (role === "signal") {
      for (const [x,h] of [[-0.024,0.025],[0,0.044],[0.024,0.065]]) parts.push(box([0.011,h,0.008],[x,0.84+h/2,z],color,0.003));
    } else {
      parts.push({g:new THREE.TorusGeometry(0.016,0.005,6,12),color,m:mat([-0.013,0.884,z])});
      parts.push(stick([0,0.872,z],[0.026,0.846,z],0.005,color));
      parts.push(stick([0.016,0.856,z],[0.028,0.868,z],0.005,color));
    }
    return parts;
  }};
}
const BADGES = Object.fromEntries((Object.keys(SPECS) as Role[]).map(role => [role, capBadge(role)])) as Record<Role, PropSpec>;

// 보직 소품과 사람마다 다른 모습을 입힌 장병. role이 null이면(로비) 완장·고리를 중립색으로 둔다.
// setRole(role, pop)으로 보직을 공개하면 소품이 제자리에서 튀어나오고 색이 바뀐다.
export function crewSoldier(
  gltf: GLTF,
  {
    height,
    role,
    variant,
  }: { height: number; role: Role | null; variant: SoldierVariant },
) {
  const hero = heroSoldier(
    gltf,
    role ? ROLE_COLORS[role] : NEUTRAL_COLOR,
    height,
    {
      face: variant.face,
      skin: SKIN_TONES[variant.skin] ?? SKIN_BASE,
      skinBase: SKIN_BASE,
      height: variant.height,
      width: variant.width,
    },
  );
  if (variant.glasses) hero.sockets.head.add(propMesh(GLASSES));
  hero.sockets.hips.add(propMesh(BELT));
  let worn: THREE.Mesh[] = [],
    shown: Role | null = null,
    pop = 1,
    // 추모 장면과 조용한 구역에서는 손에 든 소품(깃발·쌍안경·무전기·열쇠)을 내려놓고 팔을 편히 둔다
    calm = false;
  const setRole = (next: Role | null, animate = false) => {
    if (next === shown) return;
    for (const m of worn) {
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
    }
    worn = [];
    shown = next;
    hero.setColor(next ? ROLE_COLORS[next] : NEUTRAL_COLOR);
    if (!next) return;
    worn = [...SPECS[next], BADGES[next]].map((spec) => {
      const m = propMesh(spec);
      m.userData.held = !!spec.grips;
      m.visible = !(calm && m.userData.held);
      hero.sockets[spec.socket].add(m);
      return m;
    });
    pop = animate ? 0 : 1;
    if (animate) for (const m of worn) m.scale.setScalar(0.001);
  };
  setRole(role);
  const arms = {
    left: ARM_BONES.left.map((n) => hero.body.getObjectByName(n)),
    right: ARM_BONES.right.map((n) => hero.body.getObjectByName(n)),
  } as Record<Hand, (THREE.Object3D | undefined)[]>;
  const target = new THREE.Vector3(), pole = new THREE.Vector3(), bodyQ = new THREE.Quaternion(), bodyS = new THREE.Vector3();
  // 보직이 바뀔 때만 손잡이 목록을 새로 만든다(매 장면 만들지 않게)
  let gripRole: Role | null = null,
    grips: (Grip & { socket: THREE.Object3D })[] = [],
    holding = new Set<Hand>();
  // 동작을 튼 뒤에 손을 소품의 손잡이로 뻗는다. 소품이 튀어나오는 동안에는 팔도 그만큼 천천히 따라간다.
  const hold = () => {
    if (shown !== gripRole) {
      gripRole = shown;
      grips = shown ? SPECS[shown].flatMap((spec) => (spec.grips ?? []).map((g) => ({ ...g, socket: hero.sockets[spec.socket] }))) : [];
      holding = new Set(grips.map((g) => g.hand));
    }
    if (!grips.length || calm) {
      for (const hand of ["left", "right"] as const) arms[hand][0]?.scale.copy(armScale[hand]);
      return;
    }
    hero.group.updateMatrixWorld(true);
    hero.body.getWorldQuaternion(bodyQ);
    hero.body.getWorldScale(bodyS);
    const weight = Math.min(1, pop * 1.4);
    // 이 모형은 팔이 짧아 소품까지 닿지 않는다: 소품을 쥔 팔만 위팔 뼈를 고르게 키워 손이 닿게 한다.
    // 동작 믹서는 값이 바뀔 때만 다시 써서 크기를 되돌려 주지 않으므로, 처음 크기에서 매번 새로 정한다.
    for (const hand of ["left", "right"] as const) {
      const upper = arms[hand][0];
      if (upper) upper.scale.copy(armScale[hand]).multiplyScalar(holding.has(hand) ? 1 + (ARM_SCALE - 1) * weight : 1);
    }
    hero.group.updateMatrixWorld(true);
    for (const g of grips) {
      const arm = arms[g.hand];
      if (arm.some((b) => !b)) continue;
      const bones = arm as THREE.Object3D[];
      const before = bones.slice(0, 2).map((b) => b.quaternion.clone());
      g.socket.localToWorld(target.set(...g.at));
      pole.set(...g.pole).applyQuaternion(bodyQ);
      reach(bones, target, pole, 0.035 * bodyS.y);
      if (weight < 1) bones.slice(0, 2).forEach((b, i) => { b.quaternion.copy(before[i].slerp(b.quaternion, weight)); b.updateMatrixWorld(true); });
    }
  };
  // 서기 동작은 사람마다 다른 시점에서 시작한다
  hero.animate(variant.phase, false, 0);
  const armScale = {
    left: arms.left[0]?.scale.clone() ?? new THREE.Vector3(1, 1, 1),
    right: arms.right[0]?.scale.clone() ?? new THREE.Vector3(1, 1, 1),
  };
  hold();
  return {
    group: hero.group,
    get role() {
      return shown;
    },
    setRole,
    setCalm(next: boolean) {
      if (next === calm) return;
      calm = next;
      for (const m of worn) if (m.userData.held) m.visible = !calm;
    },
    // 움직이지 않을 때만 사람마다 다른 빠르기로 숨 쉰다
    animate(dt: number, moving: boolean, speed: number) {
      hero.animate(moving ? dt : dt * variant.pace, moving, speed);
      if (pop < 1) {
        pop = Math.min(1, pop + dt / 0.45);
        const s = Math.max(0.001, popScale(pop));
        for (const m of worn) m.scale.setScalar(s);
      }
      hold();
    },
  };
}
