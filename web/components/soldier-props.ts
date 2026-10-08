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
//   지휘관: 왼팔 완장과 등에 꽂은 작은 깃발
//   정찰원: 가슴에 건 쌍안경
//   통신원: 등에 멘 무전기와 짧은 안테나
//   암호해독관: 목줄에 건 열쇠
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
type PropSpec = { socket: SoldierSocket; pivot: V3; parts: () => Part[] };
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
    // 등에 비스듬히 꽂은 작은 깃대와 삼각 깃발: 앞에서는 모자 위 오른쪽(장병의 오른쪽)으로 보인다
    {
      socket: "hips",
      pivot: [-0.27, 1.12, -0.45],
      parts: () => {
        const base: V3 = [-0.12, 0.25, -0.15],
          tip: V3 = [-0.36, 1.24, -0.42];
        const A = new THREE.Vector3(...base),
          d = new THREE.Vector3(...tip).sub(A),
          len = d.length();
        const low = A.clone().addScaledVector(d, 0.79);
        // 깃발: 깃대를 따라 선 변에서 바깥(-x)으로 뾰족한 삼각형, 두께 0.02
        const h = 0.17 * len;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(0, h);
        shape.lineTo(-0.3, h * 0.55);
        shape.closePath();
        const flag = new THREE.ExtrudeGeometry(shape, {
          depth: 0.022,
          bevelEnabled: true,
          bevelThickness: 0.006,
          bevelSize: 0.006,
          bevelSegments: 1,
        });
        // 깃발 가운데 크림 띠 한 줄
        const stripe = new THREE.Shape();
        stripe.moveTo(-0.07, h * 0.15);
        stripe.lineTo(-0.07, h * 0.86);
        stripe.lineTo(-0.12, h * 0.8);
        stripe.lineTo(-0.12, h * 0.22);
        stripe.closePath();
        const band = new THREE.ExtrudeGeometry(stripe, {
          depth: 0.036,
          bevelEnabled: false,
        });
        const flagAt = new THREE.Matrix4()
          .compose(
            low,
            new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              d.clone().normalize(),
            ),
            new THREE.Vector3(1, 1, 1),
          )
          .multiply(mat([-0.006, 0, -0.011]));
        return [
          stick(base, tip, 0.011, C.pole),
          // 깃대를 꽂은 작은 꽂이 주머니(등에 붙는다)
          box([0.075, 0.1, 0.07], [-0.125, 0.29, -0.135], C.webbing, 0.02),
          {
            g: new THREE.SphereGeometry(0.026, 10, 8),
            color: C.brass,
            m: mat(tip),
          },
          { g: flag, color: ROLE_COLORS.commander, m: flagAt },
          {
            g: band,
            color: C.cream,
            m: flagAt.clone().multiply(mat([0, 0, -0.007])),
          },
        ];
      },
    },
  ],
  scout: [
    // 가슴에 건 쌍안경: 두 통을 세워 매달고 목줄은 턱 아래로 올라간다
    {
      socket: "hips",
      pivot: [0, 0.315, 0.17],
      parts: () => {
        const parts: Part[] = [];
        for (const sx of [-1, 1]) {
          const x = sx * 0.043;
          parts.push(
            {
              g: new THREE.CylinderGeometry(0.033, 0.036, 0.085, 12),
              color: C.charcoal,
              m: mat([x, 0.312, 0.166]),
            },
            {
              g: new THREE.CylinderGeometry(0.024, 0.026, 0.03, 12),
              color: C.charcoal,
              m: mat([x, 0.368, 0.16]),
            },
            {
              g: new THREE.TorusGeometry(0.031, 0.008, 6, 14),
              color: ROLE_COLORS.scout,
              m: mat([x, 0.27, 0.166], [Math.PI / 2, 0, 0]),
            },
            {
              g: new THREE.CircleGeometry(0.026, 12),
              color: C.lens,
              m: mat([x, 0.268, 0.166], [Math.PI / 2, 0, 0]),
            },
            stick(
              [x * 1.1, 0.38, 0.158],
              [x * 1.3, 0.425, 0.08],
              0.006,
              ROLE_COLORS.scout,
            ),
          );
        }
        parts.push(
          box([0.05, 0.03, 0.03], [0, 0.33, 0.168], C.oliveDark, 0.008),
        );
        return parts;
      },
    },
  ],
  signal: [
    // 등에 멘 무전기 상자와 비스듬한 짧은 안테나, 앞가슴에 보이는 멜빵 두 줄
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
        {
          g: new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10),
          color: ROLE_COLORS.signal,
          m: mat([0.0, 0.345, -0.26], [Math.PI / 2, 0, 0]),
        },
        box([0.03, 0.03, 0.02], [0.05, 0.345, -0.258], C.cream, 0.006),
        stick([0.09, 0.4, -0.21], [0.25, 1.08, -0.47], 0.008, C.charcoal),
        {
          g: new THREE.SphereGeometry(0.028, 10, 8),
          color: ROLE_COLORS.signal,
          m: mat([0.25, 1.08, -0.47]),
        },
        box(
          [0.036, 0.11, 0.016],
          [0.085, 0.322, 0.116],
          C.webbing,
          0.006,
          [-0.4, 0, 0],
        ),
        box(
          [0.036, 0.11, 0.016],
          [-0.085, 0.322, 0.116],
          C.webbing,
          0.006,
          [-0.4, 0, 0],
        ),
      ],
    },
  ],
  cipher: [
    // 목줄에 건 놋쇠 열쇠: 고리·자루·이빨
    {
      socket: "hips",
      pivot: [0, 0.3, 0.165],
      parts: () => [
        {
          g: new THREE.TorusGeometry(0.03, 0.01, 8, 16),
          color: C.brass,
          m: mat([0, 0.338, 0.166]),
        },
        box([0.018, 0.085, 0.014], [0, 0.27, 0.166], C.brass, 0.005),
        box([0.03, 0.014, 0.014], [0.018, 0.242, 0.166], C.brass, 0.004),
        box([0.022, 0.014, 0.014], [0.014, 0.262, 0.166], C.brass, 0.004),
        stick(
          [-0.012, 0.366, 0.164],
          [-0.05, 0.425, 0.085],
          0.006,
          ROLE_COLORS.cipher,
        ),
        stick(
          [0.012, 0.366, 0.164],
          [0.05, 0.425, 0.085],
          0.006,
          ROLE_COLORS.cipher,
        ),
        {
          g: new THREE.SphereGeometry(0.012, 8, 6),
          color: ROLE_COLORS.cipher,
          m: mat([0, 0.366, 0.164]),
        },
      ],
    },
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

export type CrewSoldier = ReturnType<typeof crewSoldier>;

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
      skin: SKIN_TONES[variant.skin] ?? SKIN_BASE,
      skinBase: SKIN_BASE,
      height: variant.height,
      width: variant.width,
    },
  );
  if (variant.glasses) hero.sockets.head.add(propMesh(GLASSES));
  let worn: THREE.Mesh[] = [],
    shown: Role | null = null,
    pop = 1;
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
    worn = SPECS[next].map((spec) => {
      const m = propMesh(spec);
      hero.sockets[spec.socket].add(m);
      return m;
    });
    pop = animate ? 0 : 1;
    if (animate) for (const m of worn) m.scale.setScalar(0.001);
  };
  setRole(role);
  // 서기 동작은 사람마다 다른 시점에서 시작한다
  hero.animate(variant.phase, false, 0);
  return {
    group: hero.group,
    get role() {
      return shown;
    },
    setRole,
    // 움직이지 않을 때만 사람마다 다른 빠르기로 숨 쉰다
    animate(dt: number, moving: boolean, speed: number) {
      hero.animate(moving ? dt : dt * variant.pace, moving, speed);
      if (pop < 1) {
        pop = Math.min(1, pop + dt / 0.45);
        const s = Math.max(0.001, popScale(pop));
        for (const m of worn) m.scale.setScalar(s);
      }
    },
  };
}
