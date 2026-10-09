import * as THREE from "three";
import type { LodInstancer as LodContract, Updater } from "./field-geom";

// 같은 모양이 많이 반복되는 것(나무 등)을 거리마다 다른 모형으로 바꿔 그리는 인스턴싱.
// (LOD 단계, 형상)마다 InstancedMesh 하나에 담고, 캐릭터가 4m 넘게 움직이거나 카메라가 돌면
// 보이는 것만 골라 다시 채운다(화면 밖·안개 밖은 빼고, 단계 경계에는 ±hyst m 여유).
// 같은 단계에서 여러 종류가 한 형상을 함께 쓰면 그리기 한 번으로 그린다.

export type LodLevel = {
  max: number; // 캐릭터에서 이 거리(m)까지 이 단계로 그린다. 마지막 단계 밖은 그리지 않는다.
  castShadow?: boolean;
  receiveShadow?: boolean;
};
// 한 종류의 단계별 형상. fit은 형상을 종류의 크기에 맞추는 자리 변환, tint는 색 곱.
export type LodShape = {
  geos: (THREE.BufferGeometry | null)[];
  fit?: (THREE.Matrix4 | null)[];
  tint?: (THREE.Color | null)[];
};
type Options<K> = {
  name: string;
  levels: LodLevel[];
  shape: (kind: K) => LodShape;
  material: THREE.Material | THREE.Material[]; // 단계마다 다르면 배열
  hyst?: number; // 단계 경계 여유(m)
  margin?: number; // 화면 밖 판정 여유(m)
  moveStep?: number; // 이만큼(m) 움직이면 다시 고른다
  turnStep?: number; // 카메라가 이만큼(도) 돌면 다시 고른다
  far?: number; // 카메라에서 이보다 먼 것은 그리지 않는다(m)
};

const _m = new THREE.Matrix4(),
  _v = new THREE.Vector3(),
  _s = new THREE.Sphere(),
  _f = new THREE.Frustum(),
  _pm = new THREE.Matrix4(),
  _dir = new THREE.Vector3();

export class LodInstancer<K> implements LodContract<K> {
  private kinds = new Map<K, number>();
  private shapes: LodShape[] = [];
  private items: { k: number; m: THREE.Matrix4; c: THREE.Color }[] = [];
  constructor(private o: Options<K>) {}
  add(kind: K, m: THREE.Matrix4, color: THREE.Color) {
    let k = this.kinds.get(kind);
    if (k === undefined) {
      k = this.shapes.length;
      this.kinds.set(kind, k);
      this.shapes.push(this.o.shape(kind));
    }
    this.items.push({ k, m: m.clone(), c: color.clone() });
  }
  get count() {
    return this.items.length;
  }
  // 장면에 넣고 매 프레임 부를 함수를 돌려준다. 만든 메시는 meshes에 남는다.
  meshes: THREE.InstancedMesh[] = [];
  build(parent: THREE.Object3D): Updater {
    const { levels, name } = this.o,
      NL = levels.length,
      n = this.items.length,
      hyst = this.o.hyst ?? 8,
      margin = this.o.margin ?? 12,
      moveStep = this.o.moveStep ?? 4,
      turnCos = Math.cos(((this.o.turnStep ?? 3) * Math.PI) / 180),
      camFar = this.o.far ?? 620,
      mats = Array.isArray(this.o.material)
        ? this.o.material
        : levels.map(() => this.o.material as THREE.Material);

    // 단계마다 형상 → 메시 번호
    const slot: Map<THREE.BufferGeometry, number>[] = levels.map(
      () => new Map(),
    );
    const cap: number[] = [],
      geoOf: THREE.BufferGeometry[] = [],
      levelOf: number[] = [];
    const where = new Int16Array(n * NL).fill(-1);
    const X = new Float32Array(n),
      Y = new Float32Array(n),
      Z = new Float32Array(n),
      R = new Float32Array(n),
      M = new Float32Array(n * NL * 16),
      Ccol = new Float32Array(n * NL * 3);
    this.items.forEach((it, i) => {
      const sh = this.shapes[it.k];
      // 경계 구: 가장 자세한 형상 기준
      const ref = sh.geos.find((g) => g) ?? null;
      if (ref && !ref.boundingSphere) ref.computeBoundingSphere();
      const bs = ref?.boundingSphere ?? new THREE.Sphere(undefined, 1);
      _v.copy(bs.center).applyMatrix4(it.m);
      X[i] = it.m.elements[12];
      Z[i] = it.m.elements[14];
      Y[i] = _v.y;
      R[i] = bs.radius * it.m.getMaxScaleOnAxis();
      for (let L = 0; L < NL; L++) {
        const g = sh.geos[L];
        if (!g) continue;
        let s = slot[L].get(g);
        if (s === undefined) {
          s = cap.length;
          slot[L].set(g, s);
          cap.push(0);
          geoOf.push(g);
          levelOf.push(L);
        }
        cap[s]++;
        where[i * NL + L] = s;
        const fit = sh.fit?.[L];
        (fit ? _m.multiplyMatrices(it.m, fit) : _m.copy(it.m)).toArray(
          M,
          (i * NL + L) * 16,
        );
        const t = sh.tint?.[L];
        Ccol[(i * NL + L) * 3] = it.c.r * (t?.r ?? 1);
        Ccol[(i * NL + L) * 3 + 1] = it.c.g * (t?.g ?? 1);
        Ccol[(i * NL + L) * 3 + 2] = it.c.b * (t?.b ?? 1);
      }
    });
    this.items = [];
    const meshes = cap.map((c, s) => {
      const L = levelOf[s],
        mesh = new THREE.InstancedMesh(geoOf[s], mats[L], c);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(c * 3),
        3,
      );
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      // 인스턴스마다 직접 골라 담으므로 메시 단위 화면 밖 판정은 끈다
      mesh.frustumCulled = false;
      mesh.castShadow = !!levels[L].castShadow;
      mesh.receiveShadow = levels[L].receiveShadow ?? true;
      mesh.name = `${name}:${L}:${s}`;
      mesh.userData.lodLevel = L;
      parent.add(mesh);
      return mesh;
    });
    this.meshes = meshes;
    const counts = new Int32Array(meshes.length),
      state = new Int8Array(n).fill(-1);
    let lx = NaN,
      lz = NaN,
      hadCam = false;
    const lastPos = new THREE.Vector3(),
      lastDir = new THREE.Vector3(),
      lastProj = new Float32Array(4);

    return (x, z, camera) => {
      let cam = false;
      if (camera) {
        camera.updateMatrixWorld();
        _dir.setFromMatrixColumn(camera.matrixWorld, 2);
        const pe = camera.projectionMatrix.elements;
        cam =
          !hadCam ||
          lastPos.distanceToSquared(camera.position) > 4 ||
          _dir.dot(lastDir) < turnCos ||
          Math.abs(pe[0] - lastProj[0]) > 1e-3 ||
          Math.abs(pe[5] - lastProj[1]) > 1e-3 ||
          Math.abs(pe[8] - lastProj[2]) > 1e-3 ||
          Math.abs(pe[9] - lastProj[3]) > 1e-3;
      }
      const moved = !(Math.hypot(x - lx, z - lz) < moveStep);
      if (!moved && !cam) return;
      lx = x;
      lz = z;
      if (camera) {
        hadCam = true;
        lastPos.copy(camera.position);
        lastDir.copy(_dir);
        const pe = camera.projectionMatrix.elements;
        lastProj[0] = pe[0];
        lastProj[1] = pe[5];
        lastProj[2] = pe[8];
        lastProj[3] = pe[9];
        _pm.multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        );
        _f.setFromProjectionMatrix(_pm);
      }
      counts.fill(0);
      const cx = camera?.position.x ?? 0,
        cz = camera?.position.z ?? 0,
        far2 = camFar * camFar;
      for (let i = 0; i < n; i++) {
        const dx = X[i] - x,
          dz = Z[i] - z,
          d = Math.sqrt(dx * dx + dz * dz);
        let L = state[i];
        if (
          L < 0 ||
          d > levels[L].max + hyst ||
          (L > 0 && d < levels[L - 1].max - hyst)
        ) {
          L = -1;
          for (let l = 0; l < NL; l++)
            if (d < levels[l].max) {
              L = l;
              break;
            }
          state[i] = L;
        }
        if (L < 0) continue;
        const s = where[i * NL + L];
        if (s < 0) continue;
        if (camera) {
          const ex = X[i] - cx,
            ez = Z[i] - cz;
          if (ex * ex + ez * ez > far2) continue;
          _s.center.set(X[i], Y[i], Z[i]);
          _s.radius = R[i] + margin;
          if (!_f.intersectsSphere(_s)) continue;
        }
        const mesh = meshes[s],
          c = counts[s]++;
        (mesh.instanceMatrix.array as Float32Array).set(
          M.subarray((i * NL + L) * 16, (i * NL + L) * 16 + 16),
          c * 16,
        );
        (mesh.instanceColor!.array as Float32Array).set(
          Ccol.subarray((i * NL + L) * 3, (i * NL + L) * 3 + 3),
          c * 3,
        );
      }
      meshes.forEach((mesh, s) => {
        const c = counts[s];
        mesh.count = c;
        mesh.visible = c > 0;
        // 묶음 경계 공은 한 번 셈하면 그대로 남는다(three). 그루가 바뀌었으니 버려서
        // 시야 구멍 가림 검사(heroBlocked)가 옛 자리 공으로 새 나무를 걸러 내지 않게 한다
        mesh.boundingSphere = null;
        mesh.boundingBox = null;
        if (!c) return;
        for (const a of [mesh.instanceMatrix, mesh.instanceColor!]) {
          a.clearUpdateRanges();
          a.addUpdateRange(0, c * a.itemSize);
          a.needsUpdate = true;
        }
      });
    };
  }
}

// ── 블롭 그늘 ─────────────────────────────────────────────────
// 소품·나무 밑에 까는 남색 둥근 그늘. 진짜 그림자 대신 바닥에 붙여 손으로 만든 모형처럼
// 땅에 앉힌다. 모두 한 InstancedMesh(그리기 1번)이고, 인스턴스 색의 r에 진하기를 담는다.
export const SHADOW_TINT = "#1f2a44";
export class BlobShadows {
  mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(capacity: number, y: number) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y, 0);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(SHADOW_TINT) } },
      vertexShader: `
        varying vec2 vQ;
        varying float vA;
        void main() {
          vQ = uv * 2.0 - 1.0;
          #ifdef USE_INSTANCING_COLOR
          vA = instanceColor.r;
          #else
          vA = 0.22;
          #endif
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          #endif
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec2 vQ;
        varying float vA;
        void main() {
          float a = vA * (1.0 - smoothstep(0.2, 1.0, length(vQ)));
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, Math.max(1, capacity));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(1, capacity) * 3),
      3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = "blob-shadows";
  }
  get capacity() {
    return this.mesh.instanceMatrix.count;
  }
  begin() {
    this.n = 0;
  }
  // 가운데 (x, z), 반지름 rx·rz(m), 회전 ry, 진하기 a(0~1)
  push(x: number, z: number, rx: number, rz: number, ry: number, a: number) {
    if (this.n >= this.capacity) return;
    _m.makeRotationY(ry);
    _m.scale(_v.set(rx, 1, rz));
    _m.setPosition(x, 0, z);
    _m.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[this.n * 3] = a;
    this.n++;
  }
  end() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    for (const a of [m.instanceMatrix, m.instanceColor!]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
      a.needsUpdate = true;
    }
  }
}
