import { expect, it } from "vitest";
import * as THREE from "three";
import fs from "node:fs";
import { createSalute, saluteEnvelope } from "../components/bongji-salute";
it("실제 장병 뼈에서 오른손을 머리 쪽으로 올리고 원래 자세를 복원한다",()=>{
 const bytes=fs.readFileSync(new URL("../public/models/soldier.glb", import.meta.url));
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const nodes:THREE.Object3D[]=json.nodes.map((n:{name?:string;translation?:number[];rotation?:number[];scale?:number[];matrix?:number[]})=>{
   const o=new THREE.Object3D();o.name=n.name??"";
   if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}
   if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;
 });
 json.nodes.forEach((n:{children?:number[]},i:number)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));
 const root=new THREE.Group();json.scenes[json.scene??0].nodes.forEach((i:number)=>root.add(nodes[i]));root.updateMatrixWorld(true);
 const head=root.getObjectByName("Head")!,hand=root.getObjectByName("RightHand")!,upper=root.getObjectByName("RightArm")!;
 const original=upper.quaternion.clone();
 const height=head.getWorldPosition(new THREE.Vector3()).y*1.2;
 const distance=()=>hand.getWorldPosition(new THREE.Vector3()).distanceTo(head.getWorldPosition(new THREE.Vector3()));
 const before=distance();const rig=createSalute(root,height)!;expect(rig).not.toBeNull();rig.apply(1);
 expect(distance()).toBeLessThan(before);expect(upper.quaternion.equals(original)).toBe(false);
 rig.restore();expect(upper.quaternion.equals(original)).toBe(true);
});
it("들기·유지·내리기와 동작 줄이기를 지원한다",()=>{
 expect(saluteEnvelope(-.1)).toBe(0);expect(saluteEnvelope(.2)).toBeCloseTo(.5);expect(saluteEnvelope(1)).toBe(1);expect(saluteEnvelope(1.8)).toBeCloseTo(.5);expect(saluteEnvelope(2.1)).toBe(0);expect(saluteEnvelope(.1,true)).toBe(1);
});
