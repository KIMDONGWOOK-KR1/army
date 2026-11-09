import * as THREE from "three";

const smooth = (x: number) => x * x * (3 - 2 * x);
export function saluteEnvelope(seconds: number, reduced = false) {
  if (seconds < 0 || seconds >= 2.1) return 0;
  if (reduced) return seconds < 1.8 ? 1 : 0;
  if (seconds < .4) return smooth(seconds / .4);
  if (seconds < 1.5) return 1;
  return 1 - smooth((seconds - 1.5) / .6);
}
function aim(bone: THREE.Object3D, child: THREE.Object3D, direction: THREE.Vector3) {
  const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
  const correction = new THREE.Quaternion().setFromUnitVectors(from, direction);
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(correction.multiply(world)));
  bone.updateMatrixWorld(true);
}
/** World-space two-bone IK: right fingertips beside the cap, elbow to the right. */
export function createSalute(root: THREE.Object3D, height: number) {
  const upper = root.getObjectByName("RightArm"), fore = root.getObjectByName("RightForeArm"), hand = root.getObjectByName("RightHand");
  const head = root.getObjectByName("Head");
  if (!upper || !fore || !hand || !head) return null;
  let saved: [THREE.Quaternion, THREE.Quaternion] | null = null;
  const restore = () => {
    if (!saved) return;
    upper.quaternion.copy(saved[0]); fore.quaternion.copy(saved[1]); saved = null;
  };
  return { restore, apply(amount: number) {
    if (amount <= 0) return;
    root.updateMatrixWorld(true);
    const baseUpper = upper.quaternion.clone(), baseFore = fore.quaternion.clone();
    saved = [baseUpper, baseFore];
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const elbow = fore.getWorldPosition(new THREE.Vector3());
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const center = root.getWorldPosition(new THREE.Vector3());
    const right = shoulder.clone().sub(center).setY(0).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const target = head.getWorldPosition(new THREE.Vector3()).addScaledVector(right, height * .145).addScaledVector(forward, height * .11);
    target.y += height * .09;
    const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
    const direction = target.clone().sub(shoulder);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a-b)+.001, a+b-.001);
    direction.normalize();
    const along = (a*a-b*b+distance*distance)/(2*distance);
    const across = Math.sqrt(Math.max(0,a*a-along*along));
    const pole = right.clone().addScaledVector(forward,.15);
    pole.addScaledVector(direction,-pole.dot(direction)).normalize();
    const goalElbow = shoulder.clone().addScaledVector(direction,along).addScaledVector(pole,across);
    aim(upper,fore,goalElbow.sub(shoulder).normalize());
    const goalWrist = shoulder.clone().addScaledVector(direction,distance);
    aim(fore,hand,goalWrist.sub(fore.getWorldPosition(new THREE.Vector3())).normalize());
    upper.quaternion.slerpQuaternions(baseUpper,upper.quaternion.clone(),amount);
    fore.quaternion.slerpQuaternions(baseFore,fore.quaternion.clone(),amount);
    root.updateMatrixWorld(true);
  } };
}
export type SaluteRig = NonNullable<ReturnType<typeof createSalute>>;
