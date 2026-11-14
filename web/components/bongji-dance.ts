import * as THREE from "three";
type Rotation = [number, number, number];
/** Eight-count step-touch, with counter-moving shoulders and a small final flourish. */
export function dancePose(beat: number, variant = 0) {
 const b=beat+(variant%3)*.065, step=Math.sin(b*Math.PI), accent=Math.sin(b*Math.PI*2), sway=Math.sin(b*Math.PI/2);
 const l=Math.max(0,step), r=Math.max(0,-step), count=((b%8)+8)%8, flourish=count>=6?Math.sin((count-6)*Math.PI/2):0;
 const bones:Record<string,Rotation>={
  Hips:[0,-.055*sway,-.045*step],Spine01:[.025*accent,.07*sway,.07*step],Spine02:[.025*Math.cos(b*Math.PI*2),.035*step,-.035*step],
  LeftUpLeg:[-.19*l,0,.055*step],RightUpLeg:[-.19*r,0,.055*step],LeftLeg:[.3*l,0,0],RightLeg:[.3*r,0,0],LeftFoot:[-.12*l,.06*step,0],RightFoot:[-.12*r,.06*step,0],
  LeftArm:[.12+.19*step,-.08*sway,-.18-.1*accent],RightArm:[.12-.19*step-.2*flourish,.08*sway,.18+.1*accent+.18*flourish],
  LeftForeArm:[.35+.13*sway,0,-.08],RightForeArm:[.35-.13*sway+.25*flourish,0,.08],Head:[.025*accent,-.045*sway,-.035*step],
 }; return {bones,offset:.28*step};
}
export function danceBubble(beat:number,slot:number){const cycle=((beat-slot*2)%32+32)%32;return cycle>3?"":["좋다, 이 박자 ♪","한 곡 더 ♪","왼발, 오른발!","충성도 리듬 있게 ♪"][slot%4];}
export function createDance(root:THREE.Object3D){
 const bones=Object.keys(dancePose(0).bones).flatMap(name=>{const bone=root.getObjectByName(name);return bone?[{name,bone,base:bone.quaternion.clone()}]:[];});
 let applied=false;const delta=new THREE.Quaternion(),angles=new THREE.Euler();
 return {
  restore(){if(!applied)return;for(const b of bones)b.bone.quaternion.copy(b.base);applied=false;},
  apply(beat:number,weight:number,variant:number){const pose=dancePose(beat,variant),w=THREE.MathUtils.clamp(weight,0,1);for(const b of bones){b.base.copy(b.bone.quaternion);const [x,y,z]=pose.bones[b.name];angles.set(x*w,y*w,z*w);delta.setFromEuler(angles);b.bone.quaternion.multiply(delta);}applied=true;return pose.offset*w;},
 };
}
export type DanceRig=ReturnType<typeof createDance>;
