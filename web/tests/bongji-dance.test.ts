import { expect, it } from "vitest";
import * as THREE from "three";
import { dancePose, danceBubble, createDance } from "../components/bongji-dance";
import { phraseOffset } from "../components/bongji-music";
it("양쪽 다리·팔이 서로 다른 박자로 움직이고 이전 자세로 복원한다",()=>{
 const pose=dancePose(.5);expect(pose.bones.LeftLeg[0]).toBeGreaterThan(0);expect(pose.bones.RightLeg[0]).toBe(0);expect(pose.bones.LeftArm).not.toEqual(pose.bones.RightArm);
 const root=new THREE.Group(),arm=new THREE.Bone();arm.name="RightArm";root.add(arm);const original=arm.quaternion.clone(),rig=createDance(root);rig.apply(.5,1,0);expect(arm.quaternion.equals(original)).toBe(false);rig.restore();expect(arm.quaternion.equals(original)).toBe(true);
 rig.apply(.5,0,0);expect(arm.quaternion.equals(original)).toBe(true);
});
it("말풍선은 잠깐 나타난 뒤 충분한 간격을 둔다",()=>{expect(danceBubble(1,0)).not.toBe("");expect(danceBubble(5,0)).toBe("");expect(danceBubble(31,0)).toBe("");});
it("음악 구역을 바꿔도 같은 악절에서 이어가고 반복 경계를 넘는다",()=>{expect(phraseOffset(0,38.4,76.8,64)).toBeCloseTo(32);expect(phraseOffset(32,32,64,76.8)).toBe(0);expect(phraseOffset(0,0,76.8,64)).toBe(0);});
