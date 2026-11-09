import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { crewSoldier } from "../components/soldier-props";
import { HOME_VARIANTS } from "../components/soldier-variants";
import { loadSoldier } from "./helpers/soldier-glb";

// 소품을 든 채 서 있는 장병(기념사진·모임 화면)의 두 손을 프레임마다 잰다. 예전에는 다 든 뒤에도
// 한 장면은 내리고 다음 장면은 올려, 쥔 손이 두 자리를 번갈아 오가며 지지직거렸다.
describe("소품 든 장병", () => {
  let gltf: GLTF;
  beforeAll(async () => {
    gltf = await loadSoldier();
  });

  for (const role of ["commander", "scout", "signal", "cipher"] as const) {
    it(`${role}: 소품 쥔 손이 프레임마다 앞뒤로 오가지 않는다`, () => {
      const h = crewSoldier(gltf, { height: 5.6, role, variant: HOME_VARIANTS[role], action: true });
      const hands = ["LeftHand", "RightHand"].map((n) => h.group.getObjectByName(n)!);
      for (let i = 0; i < 100; i++) h.animate(1 / 60, false, 0);
      const rows: THREE.Vector3[][] = [];
      for (let i = 0; i < 60; i++) {
        h.animate(1 / 60, false, 0);
        h.group.updateMatrixWorld(true);
        rows.push(hands.map((o) => o.getWorldPosition(new THREE.Vector3())));
      }
      // 움직이는 방향이 바로 뒤집히는 횟수(0.1mm 넘게 움직일 때만). 숨 쉬기는 1초에 한두 번 뒤집힌다.
      let flips = 0;
      for (let i = 2; i < rows.length; i++)
        for (let k = 0; k < 2; k++)
          for (const c of ["x", "y", "z"] as const) {
            const a = rows[i][k][c] - rows[i - 1][k][c],
              b = rows[i - 1][k][c] - rows[i - 2][k][c];
            if (a * b < 0 && Math.abs(a) > 1e-4) flips++;
          }
      expect(flips).toBeLessThan(6);
    });
  }
});
