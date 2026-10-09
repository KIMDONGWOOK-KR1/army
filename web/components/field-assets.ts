import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  LandmarkEntry,
  LandmarkManifest,
} from "./field-landmark-slots";
import { chainOnBeforeCompile } from "./field-occlusion";

// 블렌더에서 만든 점토 모형(public/models/*.glb). 나무·건물은 꼭짓점 색에 그늘을 구워 넣었고,
// 장병(C02)은 걷기·서기 동작이 든 뼈대 모형이다. 한 번 받아 두고 다시 쓰며, 받지 못한
// 모형은 null로 두어 필드가 코드로 만든 모형을 대신 쓰게 한다.

export type TreeKind = "round" | "meta" | "pine";
// 같은 나무의 자세한 모형(hi)과 멀리서 쓰는 줄인 모형(lo)
export type TreeLod = { hi: THREE.BufferGeometry; lo: THREE.BufferGeometry };
export type FieldAssets = {
  trees: Record<TreeKind, TreeLod[]> | null;
  gate: THREE.BufferGeometry | null;
  hall: THREE.BufferGeometry | null;
  tower: THREE.BufferGeometry | null;
  soldier: GLTF | null;
};

// kit.glb 안 나무 이름. 줄인 모형은 이름 뒤에 _lo가 붙는다.
export const TREE_NAMES: Record<TreeKind, string[]> = {
  round: ["TREE_round_a", "TREE_round_b", "TREE_round_c"],
  meta: ["TREE_meta"],
  pine: ["TREE_pine_a", "TREE_pine_b"],
};
export const MODEL_FILES = [
  "kit.glb",
  "gate.glb",
  "hall.glb",
  "tower.glb",
  "soldier.glb",
] as const;
const WAIT_MS = 12000;
// 걷기 동작에서 땅을 디딘 발이 뒤로 밀리는 속도(모형 키 1m 기준, 블렌더에서 잰 값)
const WALK_M_PER_S = 0.175;

let pending: Promise<FieldAssets> | null = null;

function fetchModel(file: string): Promise<GLTF | null> {
  return Promise.race([
    new GLTFLoader().loadAsync(`/models/${file}`),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
  ]).catch(() => null);
}

// 이름으로 모형 안 형상을 꺼낸다. 화면을 다시 열 때도 쓰므로 정리할 때 지우지 않게 표시한다.
function shape(gltf: GLTF | null, name: string) {
  const o = gltf?.scene.getObjectByName(name);
  if (!(o instanceof THREE.Mesh)) return null;
  const g = o.geometry as THREE.BufferGeometry;
  g.userData.shared = true;
  return g;
}

function treeKit(kit: GLTF | null) {
  const out = {} as Record<TreeKind, TreeLod[]>;
  for (const kind of Object.keys(TREE_NAMES) as TreeKind[]) {
    const lods: TreeLod[] = [];
    for (const name of TREE_NAMES[kind]) {
      const hi = shape(kit, name),
        lo = shape(kit, `${name}_lo`);
      if (!hi || !lo) return null;
      lods.push({ hi, lo });
    }
    out[kind] = lods;
  }
  return out;
}

function rig(gltf: GLTF | null) {
  if (!gltf) return null;
  const names = gltf.animations.map((a) => a.name);
  let skinned = false;
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    skinned = true;
    o.geometry.userData.shared = true;
    const map = (o.material as THREE.MeshStandardMaterial).map;
    if (!map) return;
    map.userData.shared = true;
    // 무늬가 잘게 나뉜 조각(UV 섬) 1600여 개라, 밉맵으로 줄이면 옆 조각 색이 섞여
    // 모자·얼굴에 점과 줄이 생긴다. 밉맵 없이 그대로 줄여 그린다.
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
  });
  return skinned && names.includes("Walk") && names.includes("Idle")
    ? gltf
    : null;
}

export function loadFieldAssets(): Promise<FieldAssets> {
  pending ??= Promise.all(MODEL_FILES.map(fetchModel)).then(
    ([kit, gate, hall, tower, soldier]) => {
      // 하나도 못 받았으면 다음에 화면을 열 때 다시 받아 본다
      if (!kit && !gate && !hall && !tower && !soldier) pending = null;
      return {
        trees: treeKit(kit),
        gate: shape(gate, "LM_gate"),
        hall: shape(hall, "LM_hall"),
        tower: shape(tower, "LM_tower"),
        soldier: rig(soldier),
      };
    },
  );
  return pending;
}

// 랜드마크 건물 모형(public/models/landmarks.json에 적힌 것만). MODEL_FILES와 따로, 필드가
// 뜬 뒤에 받는다. 목록에 있어도 파일이 아직 없으면(optional) 조용히 건너뛰고 코드로 만든
// 건물이 그대로 선다.
export type LandmarkModel = {
  entry: LandmarkEntry;
  geometry: THREE.BufferGeometry;
};
let landmarksPending: Promise<LandmarkModel[]> | null = null;

export function loadLandmarks(): Promise<LandmarkModel[]> {
  landmarksPending ??= fetch("/models/landmarks.json")
    .then((r) => (r.ok ? (r.json() as Promise<LandmarkManifest>) : null))
    .catch(() => null)
    .then(async (manifest) => {
      const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
      const got = await Promise.all(
        entries.map(async (entry) => {
          const geometry = shape(await fetchModel(entry.file), entry.node);
          return geometry ? { entry, geometry } : null;
        }),
      );
      return got.filter((m): m is LandmarkModel => m !== null);
    });
  return landmarksPending;
}

// 군복 팔에 두른 파란 띠를 역할 색으로 바꿔 칠한다(파랑이 빨강·초록보다 뚜렷이 큰 곳만).
// 피부 무늬(밝은 살구색: 빨강이 크고 초록·파랑 차례로 낮은 곳)만 skin 배율로 살짝 바꾼다.
// 색은 유니폼 값이라 사람마다 셰이더를 따로 만들지 않는다.
function roleTint(
  material: THREE.MeshStandardMaterial,
  role: THREE.Color,
  skin: THREE.Color,
) {
  const m = material.clone();
  // 다른 셰이더 조각과 섞일 수 있게 patch 잇기 도구(field-occlusion)로 넣는다
  return chainOnBeforeCompile(m, "role-tint", (shader) => {
    shader.uniforms.uRole = { value: role };
    shader.uniforms.uSkin = { value: skin };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uRole;\nuniform vec3 uSkin;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec3 c = sampledDiffuseColor.rgb;
          float k = smoothstep(0.12, 0.25, c.b - max(c.r, c.g));
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, uRole * clamp(l / 0.085, 0.6, 1.3), k);
          float s = smoothstep(0.45, 0.6, c.r) * smoothstep(0.15, 0.28, c.r - c.g)
            * smoothstep(0.08, 0.16, c.g - c.b);
          diffuseColor.rgb *= mix(vec3(1.0), uSkin, s);
        }
        #endif`,
      );
  });
}

// 발밑 고리: 흰 안쪽과 역할 색 테두리(반지름 r m)
function footRing(roleColor: string, r: number) {
  const g = new THREE.Group();
  const disc = (r0: number, r1: number, color: string, opacity: number) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const d = new THREE.Mesh(
      new THREE.RingGeometry(r0 * r, r1 * r, 48),
      material,
    );
    d.rotation.x = -Math.PI / 2;
    g.add(d);
    return material;
  };
  disc(0, 0.79, "#ffffff", 0.35);
  const rim = disc(0.79, 1, roleColor, 0.85);
  return { group: g, rim };
}

// 소품을 붙이는 뼈: 몸통(엉덩이 뼈 — 이 모형의 몸통 무늬는 두 허벅지 뼈가 반씩 끌고 간다),
// 머리, 왼팔 위쪽
export type SoldierSocket = "hips" | "head" | "arm";
const SOCKET_BONES: Record<SoldierSocket, string> = {
  hips: "Hips",
  head: "Head",
  arm: "LeftArm",
};
export type SoldierLook = {
  skin?: string; // 피부 무늬를 바꿀 목표 색(sRGB). 모형 피부색(base)에 대한 배율로 칠한다.
  skinBase?: string;
  height?: number; // 키 배율
  width?: number; // 너비 배율
};

// C02 장병: 키 height(m), 앞은 +z. 움직이면 걷기, 멈추면 서기 동작으로 부드럽게 넘어가고
// 걷는 빠르기에 맞춰 발걸음을 재촉한다.
// sockets는 쉬는 자세의 몸 좌표(모형 키 1, 앞 +z)를 그대로 쓰는 뼈 붙이개다: 여기에 넣은
// 소품은 몸 좌표로 놓으면 그 뼈를 따라 움직인다(soldier-props.ts).
export function heroSoldier(
  gltf: GLTF,
  roleColor: string,
  height: number,
  look: SoldierLook = {},
) {
  const body = cloneRig(gltf.scene);
  const skins: THREE.SkinnedMesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skins.push(o);
  });
  const role = new THREE.Color(roleColor);
  const skin = new THREE.Color(1, 1, 1);
  if (look.skin) {
    const want = new THREE.Color(look.skin),
      base = new THREE.Color(look.skinBase ?? look.skin);
    skin.setRGB(want.r / base.r, want.g / base.g, want.b / base.b);
  }
  const box = new THREE.Box3();
  for (const s of skins) {
    s.geometry.computeBoundingBox();
    box.union(s.geometry.boundingBox!);
    s.material = roleTint(s.material as THREE.MeshStandardMaterial, role, skin);
    s.castShadow = true;
    // 동작 중 팔다리가 처음 잰 경계 밖으로 나가도 잘리지 않게 한다
    s.frustumCulled = false;
  }
  const k = height / Math.max(0.01, box.max.y - box.min.y);
  body.scale.setScalar(k);
  // 뼈 붙이개는 쉬는 자세(동작을 틀기 전)에서 몸 좌표 원점에 두고 뼈에 옮겨 단다
  body.updateMatrixWorld(true);
  const sockets = {} as Record<SoldierSocket, THREE.Object3D>;
  for (const [slot, name] of Object.entries(SOCKET_BONES) as [
    SoldierSocket,
    string,
  ][]) {
    const bone = body.getObjectByName(name) ?? body;
    const socket = new THREE.Object3D();
    socket.name = `socket-${slot}`;
    body.add(socket);
    socket.updateMatrixWorld(true);
    bone.attach(socket);
    sockets[slot] = socket;
  }
  // 키·너비 배율은 붙이개를 단 뒤에 준다(뼈에 옮겨 달 때 기울어진 늘림이 섞이지 않게)
  const ky = k * (look.height ?? 1),
    kxz = k * (look.width ?? 1);
  body.scale.set(kxz, ky, kxz);
  body.position.y = -box.min.y * ky;
  const group = new THREE.Group();
  const ring = footRing(roleColor, height * 0.55);
  ring.group.position.y = 0.04;
  group.add(body, ring.group);

  const mixer = new THREE.AnimationMixer(body);
  const clip = (name: string) =>
    mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, name)!);
  const walk = clip("Walk"),
    idle = clip("Idle");
  walk.play();
  idle.play();
  let w = 0;
  return {
    group,
    body,
    sockets,
    // 팔 띠와 발밑 고리 테두리 색을 바꾼다(보직 공개 때)
    setColor(color: string) {
      role.set(color);
      ring.rim.color.set(color);
    },
    animate(dt: number, moving: boolean, speed: number) {
      w += ((moving ? 1 : 0) - w) * Math.min(1, dt * 6);
      walk.setEffectiveWeight(w);
      idle.setEffectiveWeight(1 - w);
      walk.timeScale = THREE.MathUtils.clamp(
        speed / (WALK_M_PER_S * ky),
        0.7,
        3.2,
      );
      mixer.update(dt);
    },
  };
}
export type HeroSoldier = ReturnType<typeof heroSoldier>;
