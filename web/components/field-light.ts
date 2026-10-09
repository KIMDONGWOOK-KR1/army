import * as THREE from "three";

// 필드의 빛: 10월 초 맑은 오후로 고정한 해와 하늘빛(스타일 시트 5장).
// 그림자는 캐릭터 둘레(카메라가 보는 앞쪽으로 조금 밀어)에만 부드럽게 드리우고,
// 그림자 상자는 그림자 지도 한 칸(텍셀) 단위로 옮겨 걸을 때 가장자리가 떨리지 않게 한다.
// 그림자 지도는 매 프레임 다시 그리지 않고, 필요할 때만(캐릭터가 움직였을 때, 상자가
// 옮겨졌을 때, 걷는 동안 2프레임마다, 서 있을 때 6프레임마다) 다시 그린다.
// 그림자 상자 가장자리 12%에서는 그림자가 서서히 옅어져 경계선이 보이지 않는다.

export const LIGHT = {
  sun: {
    color: "#fff1d8",
    intensity: 2.4,
    // 캐릭터 기준 해 자리: 방위 229°(남서), 고도 52.5°
    offset: [-70, 120, 60] as const,
  },
  hemi: { sky: "#e3f0ff", ground: "#a9d6b4", intensity: 1.3 },
  shadow: {
    intensity: 0.6, // 그늘 진 땅이 햇빛 받은 땅의 60~65% 밝기
    radius: 4,
    bias: -0.0005,
    normalBias: 0.08,
    near: 1,
    far: 420,
    fade: 0.12, // 상자 가장자리에서 그림자가 옅어지는 폭(상자 반쪽 대비)
  },
  // 그림자 상자 반쪽 크기 = 카메라 거리 × perR(10m 단위로 끊어 확대할 때만 바꾼다)
  // 폰은 반쪽 75m까지만(그림자 지도 한 칸이 너무 커져 흐려지지 않게, 그림자 패스 물체도 준다)
  box: { min: 60, max: 120, maxPhone: 75, perR: 0.9, step: 10, ahead: 0.35 },
  // 그림자 지도를 다시 그리는 간격(프레임)과, 이보다 많이 움직이면 바로 다시 그리는 거리(m)
  every: { walk: 2, idle: 6, move: 0.3 },
};

// 그림자 상자 가장자리에서 그림자를 옅게 한다. PCF 그림자 함수 하나만 고친다(three 0.186).
// 다른 재질의 셰이더를 따로 고치지 않아도 되도록 three의 셰이더 조각을 한 번만 바꾼다.
const FADE_MARK = "/* field-shadow-fade */";
export function patchShadowFade(chunk: string, fade = LIGHT.shadow.fade) {
  if (chunk.includes(FADE_MARK)) return chunk;
  const at = chunk.indexOf("float getShadow( sampler2DShadow shadowMap");
  if (at < 0) return chunk;
  const ret = "return mix( 1.0, shadow, shadowIntensity );",
    r = chunk.indexOf(ret, at);
  if (r < 0) return chunk;
  const f = fade.toFixed(3);
  return (
    chunk.slice(0, r) +
    `${FADE_MARK}
			vec2 fadeEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
			shadow = mix( 1.0, shadow, smoothstep( 0.0, ${f}, min( fadeEdge.x, fadeEdge.y ) ) );
			` +
    chunk.slice(r)
  );
}
THREE.ShaderChunk.shadowmap_pars_fragment = patchShadowFade(
  THREE.ShaderChunk.shadowmap_pars_fragment,
);

// 해 방향(빛이 오는 쪽, 단위 벡터)
const SUN_DIR = new THREE.Vector3(...LIGHT.sun.offset).normalize(),
  SUN_DIST = new THREE.Vector3(...LIGHT.sun.offset).length();

// 빛 공간(그림자 카메라의 오른쪽·위) 축. three의 lookAt과 같은 방법으로 정한다.
export function lightBasis(dir: THREE.Vector3) {
  const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(),
    up = dir.clone().cross(right).normalize();
  return { right, up };
}

// 점 p를 빛 공간 오른쪽·위 축 방향으로 텍셀 크기의 정수배 자리로 옮긴다(빛 방향 성분은 그대로).
// 그림자 상자를 이렇게 옮기면 상자가 움직여도 그림자 지도의 칸이 땅에 붙어 있어 떨리지 않는다.
export function snapToTexel(
  p: THREE.Vector3,
  dir: THREE.Vector3,
  texel: number,
  out = new THREE.Vector3(),
  basis = lightBasis(dir),
) {
  const { right, up } = basis,
    u = Math.round(p.dot(right) / texel) * texel,
    v = Math.round(p.dot(up) / texel) * texel,
    w = p.dot(dir);
  return out
    .copy(right)
    .multiplyScalar(u)
    .addScaledVector(up, v)
    .addScaledVector(dir, w);
}

// 카메라 거리 r(m)에 맞는 그림자 상자 반쪽 크기(10m 단위, 폰은 maxPhone까지)
export function shadowHalf(r: number, phone = false) {
  const b = LIGHT.box,
    h = Math.round((r * b.perR) / b.step) * b.step;
  return Math.min(phone ? b.maxPhone : b.max, Math.max(b.min, h));
}

// 지금 그림자 상자(필드는 한 화면에 하나뿐이라 모듈에 하나 둔다). 나무·건물·소품 묶음이
// 이 안의 것만 그림자를 드리우게 고를 때 읽는다. half가 0이면 그림자가 꺼져 있다.
export const shadowBox = { x: 0, z: 0, half: 0 };

export type FieldLight = {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  // 매 프레임: 캐릭터 발 자리, 카메라, 걷는 중인지. 그림자 지도를 다시 그리게 했으면 true.
  follow(pos: THREE.Vector3, camera: THREE.Camera, moving: boolean): boolean;
  // 그림자 지도 크기(0이면 그림자를 끈다)
  setShadowSize(size: number): void;
  readonly shadowSize: number;
  // 다음 프레임에 그림자를 꼭 다시 그린다(화면을 다시 열었을 때 등)
  invalidate(): void;
  // 지금 그림자 상자의 땅 위 가운데(x, z)와 빛 공간 반쪽 크기(m). 나무·건물 묶음이
  // 이 안의 것만 그림자를 드리우게 고를 때 쓴다(땅 위 범위는 빛 방향으로 약 1.26배 길다).
  readonly box: { x: number; z: number; half: number };
};

export function makeLight(
  scene: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  shadowSize: number,
  phone = false,
): FieldLight {
  const hemi = new THREE.HemisphereLight(
    LIGHT.hemi.sky,
    LIGHT.hemi.ground,
    LIGHT.hemi.intensity,
  );
  const sun = new THREE.DirectionalLight(LIGHT.sun.color, LIGHT.sun.intensity);
  const s = LIGHT.shadow;
  sun.castShadow = shadowSize > 0;
  sun.shadow.mapSize.setScalar(Math.max(256, shadowSize));
  sun.shadow.radius = s.radius;
  sun.shadow.bias = s.bias;
  sun.shadow.normalBias = s.normalBias;
  sun.shadow.intensity = s.intensity;
  Object.assign(sun.shadow.camera, { near: s.near, far: s.far });
  scene.add(hemi, sun, sun.target);
  // 그림자는 필요할 때만 다시 그린다
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const basis = lightBasis(SUN_DIR),
    center = new THREE.Vector3(),
    snapped = new THREE.Vector3(),
    last = new THREE.Vector3(Infinity, 0, 0),
    lastPos = new THREE.Vector3(Infinity, 0, 0);
  const box = shadowBox;
  let half = 0,
    size = shadowSize,
    since = Infinity,
    force = true;

  const setBox = (h: number) => {
    half = h;
    Object.assign(sun.shadow.camera, {
      left: -h,
      right: h,
      top: h,
      bottom: -h,
    });
    sun.shadow.camera.updateProjectionMatrix();
  };

  return {
    sun,
    hemi,
    box,
    get shadowSize() {
      return size;
    },
    invalidate() {
      force = true;
    },
    setShadowSize(n) {
      if (n === size) return;
      size = n;
      sun.castShadow = n > 0;
      if (n <= 0) box.half = 0;
      if (n > 0) sun.shadow.mapSize.setScalar(n);
      force = true;
    },
    follow(pos, camera, moving) {
      since++;
      if (size <= 0) return false;
      // 카메라가 보는 쪽(수평)으로 상자를 밀어 화면 안 땅을 덮는다
      const dx = pos.x - camera.position.x,
        dz = pos.z - camera.position.z,
        flat = Math.hypot(dx, dz) || 1,
        r = camera.position.distanceTo(pos),
        h = shadowHalf(r, phone);
      if (h !== half) {
        setBox(h);
        force = true;
      }
      const ahead = h * LIGHT.box.ahead;
      center.set(pos.x + (dx / flat) * ahead, 0, pos.z + (dz / flat) * ahead);
      snapToTexel(center, SUN_DIR, (2 * h) / size, snapped, basis);
      const e = LIGHT.every,
        changed = !snapped.equals(last),
        moved = pos.distanceTo(lastPos) > e.move,
        due =
          force ||
          moved ||
          since >= (moving ? e.walk : e.idle) ||
          (changed && since >= e.walk);
      if (!due) return false;
      // 그림자 행렬은 그림자 지도를 다시 그릴 때만 바뀌므로 해도 그때만 옮긴다
      last.copy(snapped);
      lastPos.copy(pos);
      box.x = center.x;
      box.z = center.z;
      box.half = h;
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(SUN_DIR, SUN_DIST);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      since = 0;
      force = false;
      return true;
    },
  };
}
