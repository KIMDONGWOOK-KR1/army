import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { bounce, gaitLayer, GAIT, STRIDE_M_PER_S } from "../components/soldier-gait";
import { loadSoldier } from "./helpers/soldier-glb";

// 걷기 동작을 빠르기 1로 돌리며 두 발끝을 잰다(모형 키 1). gait면 걸음걸이 다듬기를 얹는다.
function measure(gltf: GLTF, gait: boolean) {
  const root = gltf.scene.clone(true);
  const mixer = new THREE.AnimationMixer(root),
    walk = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, "Walk")!);
  walk.play();
  const layer = gaitLayer(root, walk);
  const toes = ["LeftToeBase", "RightToeBase"].map((n) => root.getObjectByName(n)!);
  const dt = 1 / 60,
    rows: THREE.Vector3[][] = [];
  for (let i = 0; i < 250; i++) {
    mixer.update(dt);
    layer.apply(gait ? 1 : 0);
    root.updateMatrixWorld(true);
    rows.push(toes.map((t) => t.getWorldPosition(new THREE.Vector3())));
  }
  const ys = rows.flat().map((p) => p.y),
    lo = Math.min(...ys),
    hi = Math.max(...ys);
  // 디딘 발(가장 낮은 15% 높이)이 뒤로 밀리는 빠르기의 가운데값
  const v: number[] = [];
  for (let i = 1; i < rows.length; i++)
    for (let k = 0; k < 2; k++)
      if (rows[i][k].y < lo + (hi - lo) * 0.15) v.push(-(rows[i][k].z - rows[i - 1][k].z) / dt);
  v.sort((a, b) => a - b);
  return { lift: hi - lo, push: v[v.length >> 1] };
}

describe("장병 걸음걸이", () => {
  let gltf: GLTF;
  beforeAll(async () => {
    gltf = await loadSoldier();
  });

  it("다듬은 걸음은 보폭과 발 들림이 원래보다 크다", () => {
    const before = measure(gltf, false),
      after = measure(gltf, true);
    expect(after.push).toBeGreaterThan(before.push * 1.3);
    expect(after.lift).toBeGreaterThan(before.lift * 1.3);
  });

  it("동작을 돌리는 빠르기가 디딘 발 속도와 맞아 발이 미끄러지지 않는다", () => {
    const { push } = measure(gltf, true);
    expect(Math.abs(push - STRIDE_M_PER_S) / push).toBeLessThan(0.1);
    // 필드 시연(키 8.5m, 7m/s)은 동작 재촉 한계(4배) 안에서 미끄러짐 없이 걷는다
    expect(7 / (STRIDE_M_PER_S * 8.5)).toBeLessThan(4);
  });

  it("몸은 한 걸음에 한 번 뜨고 서 있을 때는 그대로다", () => {
    const d = 4.1667,
      step = d / GAIT.steps;
    expect(bounce(GAIT.peak, d)).toBeCloseTo(1);
    expect(bounce(GAIT.peak + step / 2, d)).toBeCloseTo(0);
    expect(bounce(GAIT.peak + step, d)).toBeCloseTo(1);
    const root = gltf.scene.clone(true),
      mixer = new THREE.AnimationMixer(root),
      walk = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, "Walk")!);
    walk.play();
    const spine = root.getObjectByName("Spine")!,
      layer = gaitLayer(root, walk);
    mixer.update(0.3);
    const y = spine.position.y;
    layer.apply(0);
    expect(spine.position.y).toBe(y);
    expect(root.rotation.x).toBe(0);
    // 걸을 때는 몸통만 뜨고 몸 전체(발)는 그대로다
    layer.apply(1);
    expect(spine.position.y).toBeGreaterThan(y);
    expect(root.position.y).toBe(0);
  });
});
