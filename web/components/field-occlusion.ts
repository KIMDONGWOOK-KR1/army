import * as THREE from "three";

// 캐릭터가 건물·나무·소품·랜드마크에 가려도 늘 보이게 하는 "시야 구멍".
// 카메라에서 캐릭터 가슴까지 선분 둘레(캐릭터 자리에서 반지름 4→6.5m, 카메라 쪽으로
// 갈수록 같은 비율로 좁아지는 원뿔 = 화면에서 늘 같은 크기의 원)의 조각을 4×4 베이어
// 디더로 지워 30%만 남긴다. 불투명 그대로라 정렬이 필요 없고, 그림자 깊이 재질은
// 고치지 않으므로 지운 자리도 그림자는 그대로 드리운다. 땅과 물 재질에는 쓰지 않는다.
//
// 0.05초마다 카메라→캐릭터(가슴·머리·무릎을 차례로) 선분이 시야 구멍 재질의 형상에
// 실제로 막히는지 재고, 막힐 때만 uCut을 0→1로 0.2초 동안 올린다. 아무것도 안 가리면
// 아무것도 지우지 않는다. 지우는 코드는 SEE_CUT 정의가 있을 때만 셰이더에 들어가므로, 가리지 않는
// 동안에는 discard 없는 프로그램을 그려 휴대폰 GPU의 숨은 면 제거를 해치지 않는다.

export const SEE = {
  chest: 4.25, // 발에서 가슴까지(m): 캐릭터 키 8.5m의 절반
  r0: 4.0, // 캐릭터 자리에서 이 반지름 안은 keep만 남긴다
  r1: 6.5, // 이 반지름 밖은 그대로 둔다
  keep: 0.3, // 구멍 가운데에 남기는 조각 비율
  front: 3, // 캐릭터 앞 이만큼(m)까지는 다 지우고
  frontEnd: 1.5, // 이만큼(m) 안쪽(캐릭터 몸 바로 앞·뒤)은 지우지 않는다
  ease: 0.2, // uCut이 0↔1로 바뀌는 시간(초)
  hold: 0.35, // 가림이 풀린 뒤에도 이만큼(초) 더 지워 깜빡이지 않게 한다
  every: 0.05, // 가림 검사 주기(초). 한 번에 몸 높이 하나씩 잰다
  rays: [4.25, 7.4, 1.6], // 검사하는 몸 높이(가슴·머리·무릎, m)
  side: 1.3, // 가슴 높이는 몸 양옆(시선에 수직, m)도 잰다: 나무가 몸 반쪽만 가려도 구멍을 연다
  ghost: [0.42, 0.3], // 역할 색 비침 불투명도(가림 없음, 시야 구멍이 열렸을 때)
};
// 나무·소품의 부드러운 시야 구멍("soft"): 가운데 3m 안은 남김 없이 걷어 내고(keep 0),
// 캐릭터 몸 바로 앞 0.6m까지 지운다. 잎 덩이가 몸에 붙어 서도 캐릭터 둘레가 비어 보인다.
// 건물·랜드마크는 위 SEE(가운데 30% 남김, 몸 앞 1.5m)를 그대로 쓴다.
export const SEE_SOFT = { r0: 3.0, r1: 6.5, keep: 0, frontEnd: 0.6 };
export type SeeKind = "solid" | "soft";

// ── 셰이더 고치기 잇기 ───────────────────────────────────────────────

type Patch = THREE.Material["onBeforeCompile"];
type Entry = { key: string; patch: Patch };
const chains = new WeakMap<THREE.Material, Entry[]>();
const ownBase = (
  m: THREE.Material,
  k: "onBeforeCompile" | "customProgramCacheKey",
) => Object.prototype.hasOwnProperty.call(m, k);

// 한 재질에 셰이더 고치기를 여럿 겹쳐 넣는다(창 띠 + 시야 구멍 등). 이름(key)마다 한 번만
// 넣고, 넣은 차례대로 돌리며, 프로그램 캐시 열쇠는 이름을 모두 이어 붙여 서로 덮어쓰지 않게 한다.
// 이 함수를 쓰기 전에 재질에 직접 넣어 둔 onBeforeCompile·customProgramCacheKey가 있으면
// 맨 앞 고치기로 살려 둔다. 고치기 함수는 다른 고치기가 찾을 #include 줄을 지우지 말고
// 그 앞이나 뒤에 덧붙여야 한다. 재질을 clone()하면 고치기는 따라가지 않는다(다시 넣는다).
export function chainOnBeforeCompile<M extends THREE.Material>(
  material: M,
  key: string,
  patch: Patch,
): M {
  let list = chains.get(material);
  if (!list) {
    list = [];
    if (ownBase(material, "onBeforeCompile")) {
      const prev = material.onBeforeCompile,
        prevKey = ownBase(material, "customProgramCacheKey")
          ? material.customProgramCacheKey.call(material)
          : "base";
      list.push({ key: prevKey, patch: prev });
    }
    chains.set(material, list);
    const run = list;
    material.onBeforeCompile = function (shader, renderer) {
      for (const p of run) p.patch.call(this, shader, renderer);
    };
    material.customProgramCacheKey = () => run.map((p) => p.key).join("|");
  }
  if (list.some((p) => p.key === key)) return material;
  list.push({ key, patch });
  material.needsUpdate = true;
  return material;
}

// 재질에 들어간 고치기 이름들(시험·점검용)
export const shaderPatches = (material: THREE.Material) =>
  (chains.get(material) ?? []).map((p) => p.key);

// ── 시야 구멍 셰이더 ────────────────────────────────────────────────

// 모든 시야 구멍 재질이 같이 쓰는 유니폼(값만 바꾸면 모든 재질에 한꺼번에 먹는다)
const U = {
  uSeeEye: { value: new THREE.Vector3(0, 1e4, 0) },
  uSeeHero: { value: new THREE.Vector3() },
  uSeeCut: { value: 0 },
  // r0, r1, keep, 캐릭터 앞 다 지우는 거리
  uSeeShape: { value: new THREE.Vector4(SEE.r0, SEE.r1, SEE.keep, SEE.front) },
  uSeeFrontEnd: { value: SEE.frontEnd },
  uSeeSoftShape: {
    value: new THREE.Vector4(SEE_SOFT.r0, SEE_SOFT.r1, SEE_SOFT.keep, SEE.front),
  },
  uSeeSoftFrontEnd: { value: SEE_SOFT.frontEnd },
};

const VERT_PARS = /* glsl */ `
varying vec3 vSeeWorld;`;
const VERT_MAIN = /* glsl */ `
{
  vec4 seeW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    seeW = batchingMatrix * seeW;
  #endif
  #ifdef USE_INSTANCING
    seeW = instanceMatrix * seeW;
  #endif
  vSeeWorld = ( modelMatrix * seeW ).xyz;
}`;
const FRAG_PARS = /* glsl */ `
varying vec3 vSeeWorld;
#ifdef SEE_CUT
  uniform vec3 uSeeEye;
  uniform vec3 uSeeHero;
  uniform float uSeeCut;
  uniform vec4 uSeeShape;
  uniform float uSeeFrontEnd;
  uniform vec4 uSeeSoftShape;
  uniform float uSeeSoftFrontEnd;
  float seeBayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
  float seeBayer4( vec2 a ) { return seeBayer2( 0.5 * a ) * 0.25 + seeBayer2( a ); }
#endif`;
const FRAG_MAIN = /* glsl */ `
#ifdef SEE_CUT
if ( uSeeCut > 0.001 ) {
  #ifdef SEE_SOFT
    vec4 seeShape = uSeeSoftShape;
    float seeFrontEnd = uSeeSoftFrontEnd;
  #else
    vec4 seeShape = uSeeShape;
    float seeFrontEnd = uSeeFrontEnd;
  #endif
  vec3 seeRay = uSeeHero - uSeeEye;
  float seeLen = max( length( seeRay ), 0.001 );
  vec3 seeDir = seeRay / seeLen;
  vec3 seeP = vSeeWorld - uSeeEye;
  float seeT = dot( seeP, seeDir );
  float seeS = clamp( seeT / seeLen, 0.0, 1.0 );
  float seeD = length( seeP - seeDir * seeT );
  float seeR0 = seeShape.x * seeS;
  float seeHole = 1.0 - smoothstep( seeR0, max( seeShape.y * seeS, seeR0 + 0.001 ), seeD );
  seeHole *= 1.0 - smoothstep( seeLen - seeShape.w, seeLen - seeFrontEnd, seeT );
  float seeKeep = mix( 1.0, seeShape.z, seeHole * uSeeCut );
  if ( seeBayer4( gl_FragCoord.xy ) >= seeKeep ) discard;
}
#endif`;

// 셰이더 문자열에 시야 구멍을 넣는다. 고칠 자리가 하나라도 없으면(직접 쓴 셰이더 등)
// 아무것도 바꾸지 않는다. 시험에서 three 셰이더 원문으로 확인한다.
export function patchSeeThroughShader(shader: {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}): boolean {
  const v = shader.vertexShader,
    f = shader.fragmentShader;
  if (
    !v.includes("#include <common>") ||
    !v.includes("#include <project_vertex>") ||
    !f.includes("#include <common>") ||
    !f.includes("#include <clipping_planes_fragment>")
  )
    return false;
  Object.assign(shader.uniforms, U);
  shader.vertexShader = v
    .replace("#include <common>", "#include <common>" + VERT_PARS)
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>" + VERT_MAIN,
    );
  shader.fragmentShader = f
    .replace("#include <common>", "#include <common>" + FRAG_PARS)
    .replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>" + FRAG_MAIN,
    );
  return true;
}

// 시야 구멍을 넣은 재질들. SEE_CUT 정의를 켜고 끌 때 쓰고, 가림 검사에서 이 재질을 쓰는
// 물체만 본다. 재질을 dispose하면 목록에서 뺀다.
const registered = new Set<THREE.Material>();
const softSet = new WeakSet<THREE.Material>();
let cutDefine = false;
const forget = (e: { target: THREE.Material }) => registered.delete(e.target);

function setCutDefine(m: THREE.Material, on: boolean) {
  const d = (m.defines ??= {}) as Record<string, unknown>;
  if (on === "SEE_CUT" in d) return;
  if (on) d.SEE_CUT = "";
  else delete d.SEE_CUT;
  m.needsUpdate = true;
}

// 재질에 시야 구멍을 넣어 같은 재질을 돌려준다(점토 가장자리 빛도 함께 넣는다).
// kind "soft"는 나무·소품용 모양(SEE_SOFT)이다: SEE_SOFT 정의를 붙여 따로 컴파일한다.
export function seeThrough<M extends THREE.Material>(
  material: M,
  kind: SeeKind = "solid",
): M {
  if (registered.has(material)) return material;
  registered.add(material);
  if (kind === "soft") {
    softSet.add(material);
    ((material.defines ??= {}) as Record<string, unknown>).SEE_SOFT = "";
  }
  material.addEventListener("dispose", forget);
  chainOnBeforeCompile(material, "see-through", (shader) => {
    patchSeeThroughShader(shader);
  });
  chainOnBeforeCompile(material, "clay-rim", (shader) => {
    patchClayRimShader(shader);
  });
  if (cutDefine) setCutDefine(material, true);
  return material;
}

export const isSeeThrough = (m: THREE.Material) => registered.has(m);
export const isSoftSeeThrough = (m: THREE.Material) => softSet.has(m);

// ── 점토 가장자리 빛(스타일 시트 5장, 선택) ─────────────────────────────
// 면이 카메라를 비스듬히 볼수록 크림색을 조금 더해 둥근 점토 모서리를 살린다.
export const CLAY_RIM = { color: "#fff6e2", strength: 0.06, power: 3 };
const RIM = {
  uClayRim: { value: CLAY_RIM.strength },
  uClayRimColor: { value: new THREE.Color(CLAY_RIM.color) },
};
export const setClayRim = (strength: number) => {
  RIM.uClayRim.value = strength;
};
export function patchClayRimShader(shader: {
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}): boolean {
  const f = shader.fragmentShader;
  if (
    !f.includes("vViewPosition") ||
    !f.includes("#include <opaque_fragment>") ||
    !f.includes("#include <common>")
  )
    return false;
  Object.assign(shader.uniforms, RIM);
  shader.fragmentShader = f
    .replace(
      "#include <common>",
      "#include <common>\nuniform float uClayRim;\nuniform vec3 uClayRimColor;",
    )
    .replace(
      "#include <opaque_fragment>",
      `{
  float rimNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  outgoingLight += uClayRimColor * ( pow( 1.0 - rimNV, ${CLAY_RIM.power.toFixed(1)} ) * uClayRim );
}
#include <opaque_fragment>`,
    );
  return true;
}

// 시작할 때 지우는(SEE_CUT) 프로그램도 미리 컴파일해 둔다. three는 링크 결과를 처음
// 쓸 때까지 묻지 않으므로 이 호출은 멈추지 않고, 처음 가려질 때 프레임이 튀지 않는다.
export function prewarmSeeThrough(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
) {
  if (cutDefine) return;
  for (const m of registered) setCutDefine(m, true);
  try {
    renderer.compile(scene, camera);
  } catch {
    // 미리 못 만들어도 처음 가려질 때 만든다
  }
  for (const m of registered) setCutDefine(m, false);
}

// ── 가림 검사(CPU) ─────────────────────────────────────────────────

// 형상의 삼각형을 xz 격자에 나눠 담은 것(큰 합친 형상만). 위치 배열은 담지 않고
// 검사할 때 형상에서 읽는다(올린 뒤 CPU 사본을 지운 형상은 검사에서 빠진다).
type Grid = {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  cells: (Uint32Array | null)[];
  stamp: Uint32Array;
  query: number;
};
const grids = new WeakMap<THREE.BufferGeometry, Grid | null>();
const GRID_MIN_TRIS = 1500;

function triCount(g: THREE.BufferGeometry) {
  const p = g.attributes.position;
  if (!p || !p.array || p.array.length === 0) return 0;
  return Math.floor((g.index ? g.index.count : p.count) / 3);
}

function vtx(g: THREE.BufferGeometry, i: number) {
  return g.index ? g.index.getX(i) : i;
}

function buildGrid(g: THREE.BufferGeometry): Grid | null {
  const n = triCount(g);
  if (n === 0) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!,
    p = g.attributes.position,
    sx = bb.max.x - bb.min.x,
    sz = bb.max.z - bb.min.z,
    cell = Math.max(4, Math.max(sx, sz) / 48),
    nx = Math.max(1, Math.ceil(sx / cell)),
    nz = Math.max(1, Math.ceil(sz / cell));
  const lists: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let t = 0; t < n; t++) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = vtx(g, t * 3 + k),
        x = p.getX(v),
        z = p.getZ(v);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const i0 = Math.max(0, Math.floor((minX - bb.min.x) / cell)),
      i1 = Math.min(nx - 1, Math.floor((maxX - bb.min.x) / cell)),
      j0 = Math.max(0, Math.floor((minZ - bb.min.z) / cell)),
      j1 = Math.min(nz - 1, Math.floor((maxZ - bb.min.z) / cell));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) lists[j * nx + i].push(t);
  }
  return {
    x0: bb.min.x,
    z0: bb.min.z,
    cell,
    nx,
    nz,
    cells: lists.map((l) => (l.length ? Uint32Array.from(l) : null)),
    stamp: new Uint32Array(n),
    query: 0,
  };
}

// 선분 o + s·d (s 0~sMax)가 삼각형 t를 지나는지(묄러-트럼보어, 양면)
function hitTri(
  g: THREE.BufferGeometry,
  t: number,
  o: THREE.Vector3,
  d: THREE.Vector3,
  sMax: number,
) {
  const p = g.attributes.position,
    a = vtx(g, t * 3),
    b = vtx(g, t * 3 + 1),
    c = vtx(g, t * 3 + 2);
  const ax = p.getX(a),
    ay = p.getY(a),
    az = p.getZ(a);
  const e1x = p.getX(b) - ax,
    e1y = p.getY(b) - ay,
    e1z = p.getZ(b) - az;
  const e2x = p.getX(c) - ax,
    e2y = p.getY(c) - ay,
    e2z = p.getZ(c) - az;
  const px = d.y * e2z - d.z * e2y,
    py = d.z * e2x - d.x * e2z,
    pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-10) return false;
  const inv = 1 / det,
    sx = o.x - ax,
    sy = o.y - ay,
    sz = o.z - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y,
    qy = sz * e1x - sx * e1z,
    qz = sx * e1y - sy * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return s >= 0 && s <= sMax;
}

const _box = new THREE.Box3(),
  _ray = new THREE.Ray(),
  _hit = new THREE.Vector3(),
  _o = new THREE.Vector3(),
  _e = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _inv = new THREE.Matrix4(),
  _m = new THREE.Matrix4(),
  _sphere = new THREE.Sphere();

// 물체 좌표의 선분 o→e(끝 비율 sMax까지)가 형상을 지나는지
function hitGeometry(
  g: THREE.BufferGeometry,
  o: THREE.Vector3,
  e: THREE.Vector3,
  sMax: number,
) {
  if (!g.boundingBox) g.computeBoundingBox();
  _d.subVectors(e, o);
  const len = _d.length();
  if (len < 1e-6) return false;
  if (!g.boundingBox!.containsPoint(o)) {
    _ray.origin.copy(o);
    _ray.direction.copy(_d).divideScalar(len);
    const at = _ray.intersectBox(g.boundingBox!, _hit);
    if (!at || at.distanceTo(o) > len * sMax) return false;
  }
  const n = triCount(g);
  if (n === 0) return false;
  if (n < GRID_MIN_TRIS) {
    for (let t = 0; t < n; t++) if (hitTri(g, t, o, _d, sMax)) return true;
    return false;
  }
  let grid = grids.get(g);
  if (grid === undefined) grids.set(g, (grid = buildGrid(g)));
  if (!grid) return false;
  grid.query = (grid.query + 1) >>> 0 || 1;
  const ex = o.x + _d.x * sMax,
    ez = o.z + _d.z * sMax,
    i0 = Math.max(0, Math.floor((Math.min(o.x, ex) - grid.x0) / grid.cell)),
    i1 = Math.min(
      grid.nx - 1,
      Math.floor((Math.max(o.x, ex) - grid.x0) / grid.cell),
    ),
    j0 = Math.max(0, Math.floor((Math.min(o.z, ez) - grid.z0) / grid.cell)),
    j1 = Math.min(
      grid.nz - 1,
      Math.floor((Math.max(o.z, ez) - grid.z0) / grid.cell),
    );
  // 선분이 지나는 칸만 본다(칸 사각형과 선분 xz의 거리로 거른다)
  const half = grid.cell * 0.5;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const list = grid.cells[j * grid.nx + i];
      if (!list) continue;
      const cx = grid.x0 + (i + 0.5) * grid.cell,
        cz = grid.z0 + (j + 0.5) * grid.cell;
      if (segDist2D(o.x, o.z, ex, ez, cx, cz) > half * 1.4143) continue;
      for (const t of list) {
        if (grid.stamp[t] === grid.query) continue;
        grid.stamp[t] = grid.query;
        if (hitTri(g, t, o, _d, sMax)) return true;
      }
    }
  return false;
}

function segDist2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
) {
  const dx = bx - ax,
    dz = bz - az,
    l2 = dx * dx + dz * dz,
    s =
      l2 > 0
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
        : 0;
  return Math.hypot(ax + dx * s - px, az + dz * s - pz);
}

// 점 c에서 선분 a→b까지 거리
function segDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    l2 = dx * dx + dy * dy + dz * dz,
    s =
      l2 > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2,
            ),
          )
        : 0;
  return Math.hypot(a.x + dx * s - c.x, a.y + dy * s - c.y, a.z + dz * s - c.z);
}

const IDENTITY = new THREE.Matrix4().elements;
const isIdentity = (e: number[]) => {
  for (let i = 0; i < 16; i++) if (e[i] !== IDENTITY[i]) return false;
  return true;
};

const usesSeeThrough = (o: THREE.Mesh) =>
  Array.isArray(o.material)
    ? o.material.some((m) => registered.has(m))
    : registered.has(o.material);
// 물체가 부드러운 구멍(나무·소품)만 쓰면 몸 앞 0.6m까지, 아니면 1.5m까지를 가림으로 잰다
const frontEndOf = (o: THREE.Mesh) =>
  (Array.isArray(o.material) ? o.material : [o.material]).every((m) => softSet.has(m))
    ? SEE_SOFT.frontEnd
    : SEE.frontEnd;

// 세계 좌표 선분 a→b(끝 비율 sMax까지)가 물체 하나를 지나는지
function hitMesh(
  o: THREE.Mesh,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sMax: number,
) {
  const g = o.geometry as THREE.BufferGeometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingSphere) return false;
  if (o instanceof THREE.InstancedMesh) {
    // 묶음 전체 경계 공이 있으면 먼저 거른다(먼 구역은 여기서 끝난다)
    if (o.boundingSphere) {
      _sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
      if (segDist(a, b, _sphere.center) > _sphere.radius) return false;
    }
    const arr = o.instanceMatrix.array,
      gs = g.boundingSphere,
      w = o.matrixWorld.elements,
      plain = isIdentity(w),
      cx = gs.center.x,
      cy = gs.center.y,
      cz = gs.center.z;
    for (let i = 0; i < o.count; i++) {
      const k = i * 16;
      if (plain) {
        // 인스턴스 행렬로 경계 공 가운데·반지름만 빨리 옮겨 거른다
        _c.set(
          arr[k] * cx + arr[k + 4] * cy + arr[k + 8] * cz + arr[k + 12],
          arr[k + 1] * cx + arr[k + 5] * cy + arr[k + 9] * cz + arr[k + 13],
          arr[k + 2] * cx + arr[k + 6] * cy + arr[k + 10] * cz + arr[k + 14],
        );
        const s = Math.sqrt(
          Math.max(
            arr[k] * arr[k] + arr[k + 1] * arr[k + 1] + arr[k + 2] * arr[k + 2],
            arr[k + 4] * arr[k + 4] +
              arr[k + 5] * arr[k + 5] +
              arr[k + 6] * arr[k + 6],
            arr[k + 8] * arr[k + 8] +
              arr[k + 9] * arr[k + 9] +
              arr[k + 10] * arr[k + 10],
          ),
        );
        if (segDist(a, b, _c) > gs.radius * s) continue;
        _m.fromArray(arr, k);
      } else {
        _m.fromArray(arr, k).premultiply(o.matrixWorld);
        _c.copy(gs.center).applyMatrix4(_m);
        if (segDist(a, b, _c) > gs.radius * _m.getMaxScaleOnAxis()) continue;
      }
      _inv.copy(_m).invert();
      _o.copy(a).applyMatrix4(_inv);
      _e.copy(b).applyMatrix4(_inv);
      if (hitGeometry(g, _o, _e, sMax)) return true;
    }
    return false;
  }
  _sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
  if (segDist(a, b, _sphere.center) > _sphere.radius) return false;
  _inv.copy(o.matrixWorld).invert();
  _o.copy(a).applyMatrix4(_inv);
  _e.copy(b).applyMatrix4(_inv);
  return hitGeometry(g, _o, _e, sMax);
}

// 장면에서 보이는 시야 구멍 물체 가운데 하나라도 카메라→캐릭터 몸 선분을 막는지
const _from = new THREE.Vector3(),
  _to = new THREE.Vector3(),
  _found: THREE.Mesh[] = [];
// rays: 검사할 몸 높이(발에서 m). 매 프레임 일을 고르게 나누려고 한 번에 하나씩도 잰다.
// side: 몸 가운데에서 시선에 수직으로 비킨 거리(m, 0이면 가운데).
export function heroBlocked(
  root: THREE.Object3D,
  eye: THREE.Vector3,
  foot: THREE.Vector3,
  rays: readonly number[] = SEE.rays,
  side = 0,
): boolean {
  let sx = 0,
    sz = 0;
  if (side) {
    const dx = foot.x - eye.x,
      dz = foot.z - eye.z,
      l = Math.hypot(dx, dz) || 1;
    sx = (-dz / l) * side;
    sz = (dx / l) * side;
  }
  _found.length = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh)
      if (usesSeeThrough(o as THREE.Mesh)) _found.push(o as THREE.Mesh);
  });
  for (const y of rays) {
    _to.set(foot.x + sx, foot.y + y, foot.z + sz);
    _from.copy(eye);
    const len = _from.distanceTo(_to);
    for (const o of _found) {
      const fe = frontEndOf(o);
      if (len < fe + 0.5) continue;
      if (hitMesh(o, _from, _to, (len - fe) / len)) return true;
    }
  }
  return false;
}

// ── 매 프레임 ──────────────────────────────────────────────────────

const state = {
  cut: 0,
  want: 0,
  clock: SEE.every,
  hold: 0,
  probeMs: 0,
  ray: 0,
};
const _one = [0];
// 마지막 가림 검사에 걸린 시간(ms, 개발용 기록)
export const seeThroughProbeMs = () => state.probeMs;
const _eye = new THREE.Vector3();

// 매 프레임 렌더 직전에 카메라·캐릭터 발 자리·지난 프레임 시간(초)을 알린다.
// root를 주면 가림을 재어 시야 구멍을 열고 닫는다(주지 않으면 늘 닫혀 있다).
// 0.05초마다 몸 높이 하나(가슴 → 머리 → 무릎 → 가슴 왼쪽 → 가슴 오른쪽 차례)씩 재어,
// 한 선을 0.25초마다 다시 잰다.
// 돌려주는 값은 지금 구멍이 열린 정도(0~1)로, 역할 색 비침을 낮출 때 쓴다.
export function updateSeeThrough(
  camera: THREE.Camera,
  pos: THREE.Vector3,
  dt: number,
  root?: THREE.Object3D,
): number {
  camera.getWorldPosition(_eye);
  U.uSeeEye.value.copy(_eye);
  U.uSeeHero.value.set(pos.x, pos.y + SEE.chest, pos.z);
  if (root) {
    state.clock += dt;
    if (state.clock >= SEE.every) {
      state.clock = 0;
      const t0 = performance.now();
      // 가슴·머리·무릎 가운데, 그다음 가슴 왼쪽·오른쪽 차례(한 바퀴 0.25초 < hold라 깜빡이지 않는다)
      const k = state.ray++ % (SEE.rays.length + 2),
        side =
          k < SEE.rays.length ? 0 : k === SEE.rays.length ? -SEE.side : SEE.side;
      _one[0] = k < SEE.rays.length ? SEE.rays[k] : SEE.chest;
      if (heroBlocked(root, _eye, pos, _one, side)) state.hold = SEE.hold;
      state.probeMs = performance.now() - t0;
    }
  }
  state.hold = Math.max(0, state.hold - dt);
  state.want = state.hold > 0 ? 1 : 0;
  const step = dt / SEE.ease;
  state.cut =
    state.want > state.cut
      ? Math.min(state.want, state.cut + step)
      : Math.max(state.want, state.cut - step);
  U.uSeeCut.value = state.cut;
  // 지우는 프로그램은 구멍이 열려 있는 동안만 쓴다
  const on = state.cut > 0 || state.want > 0;
  if (on !== cutDefine) {
    cutDefine = on;
    for (const m of registered) setCutDefine(m, on);
  }
  return state.cut;
}

// 화면을 다시 열 때 지난 가림 상태를 지운다
export function resetSeeThrough() {
  state.cut = state.want = state.hold = 0;
  state.clock = SEE.every;
  state.ray = 0;
  U.uSeeCut.value = 0;
}

// 역할 색 비침 불투명도: 구멍이 열리면 조금 낮춰 두 효과가 겹쳐 진해지지 않게 한다
export const ghostOpacity = (cut: number) =>
  SEE.ghost[0] + (SEE.ghost[1] - SEE.ghost[0]) * cut;
