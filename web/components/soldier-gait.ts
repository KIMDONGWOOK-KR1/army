import * as THREE from "three";

// 걸음걸이 다듬기. 블렌더 장병(C02)의 걷기 동작은 2등신 몸에 보폭이 키의 0.2배, 발이 키의
// 3.5%만 들리는 '종종걸음'이라, 필드에서 시연 속도(키 8.5m 장병이 7m/s)로 걸으면 동작을
// 3배 넘게 빨리 돌려도 발이 땅에서 미끄러지고 다리만 바쁘게 떨렸다. 동작 위에 세 가지를 얹는다.
//  1) 다리 뼈를 걷기 평균 자세에서 더 크게 흔들어 보폭과 발 들림을 키운다(같은 빠르기를
//     덜 재촉한 발걸음으로 간다).
//  2) 한 걸음마다 몸통이 살짝 통통 뜨고(디딘 발 위에서 가장 높다), 걷는 동안 앞으로 조금 기운다.
//  3) 걷기 무게(w)만큼만 얹어서 서기 ↔ 걷기가 부드럽게 넘어간다.
// 값은 tests/soldier-gait.test.ts가 모형 파일로 발 미끄러짐을 재어 맞춘다.

export const GAIT = {
  // 다리 흔들기 배율(1이면 원래 동작): 허벅지, 무릎, 발목
  stride: 1.5,
  knee: 2.0,
  ankle: 1.2,
  // 한 걸음 통통 높이(키 대비)
  bob: 0.018,
  // 걷는 동안 앞으로 기울기(rad)
  lean: 0.06,
  // 걷기 동작 한 바퀴(4.17초)에 든 걸음 수
  steps: 6,
  // 원래 동작에서 몸 엉덩이가 가장 높은 때(초): 이때 디딘 발 위에 몸이 올라선다
  peak: 0.5,
} as const;

// 다리 흔들기를 키운 뒤, 디딘 발이 뒤로 밀리는 속도(모형 키 1m, 동작 빠르기 1 기준).
// tests/soldier-gait.test.ts가 모형으로 잰 값과 맞춰 본다.
export const STRIDE_M_PER_S = 0.31;

export const LEG_BONES = [
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
] as const;

// 동작 안 뼈마다 한 바퀴 평균 자세(같은 동작은 여러 장병이 함께 쓰므로 한 번만 잰다)
const means = new WeakMap<THREE.AnimationClip, Map<string, THREE.Quaternion>>();
export function meanPose(clip: THREE.AnimationClip) {
  let m = means.get(clip);
  if (m) return m;
  m = new Map();
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf(".");
    if (tr.name.slice(dot + 1) !== "quaternion") continue;
    const v = tr.values,
      sum = new THREE.Vector4();
    for (let i = 0; i < v.length; i += 4) {
      // 반대 부호 사원수는 같은 자세라 첫 값 쪽으로 맞춰 더한다
      const s = v[i] * v[0] + v[i + 1] * v[1] + v[i + 2] * v[2] + v[i + 3] * v[3] < 0 ? -1 : 1;
      sum.x += v[i] * s;
      sum.y += v[i + 1] * s;
      sum.z += v[i + 2] * s;
      sum.w += v[i + 3] * s;
    }
    m.set(tr.name.slice(0, dot), new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize());
  }
  means.set(clip, m);
  return m;
}

// 걷기 한 걸음 안에서 몸이 뜨는 정도(0~1): 디딘 발 위(엉덩이가 가장 높은 때)에서 1
export function bounce(time: number, clipSeconds: number) {
  const step = clipSeconds / GAIT.steps;
  return 0.5 + 0.5 * Math.cos(((time - GAIT.peak) / step) * Math.PI * 2);
}

export function gaitLayer(
  body: THREE.Object3D,
  walk: THREE.AnimationAction,
) {
  const clip = walk.getClip(),
    mean = meanPose(clip);
  const legs = LEG_BONES.flatMap((name) => {
    const bone = body.getObjectByName(name),
      m = mean.get(name);
    return bone && m
      ? [{
          bone,
          mean: m,
          gain: name.endsWith("UpLeg") ? GAIT.stride : name.endsWith("Leg") ? GAIT.knee : GAIT.ankle,
          clip: bone.quaternion.clone(),
          out: bone.quaternion.clone(),
        }]
      : [];
  });
  // 통통 뜨기는 몸통(Spine)만 올린다: 몸 전체를 올리면 디딘 발까지 땅에서 뜬다.
  // 뼈 좌표 1은 모형 키의 1/100(모형이 0.01배로 줄여 있다)이다.
  const spine = body.getObjectByName("Spine");
  let spineY: number | null = null;
  const baseX = body.rotation.x;
  const q = new THREE.Quaternion();
  return {
    // 믹서를 돌린 뒤에 부른다. w: 걷기 무게(0~1)
    apply(w: number) {
      for (const l of legs) {
        // 믹서는 값이 바뀐 뼈만 다시 쓴다: 그대로면 지난번 원래 값에서 다시 키운다(겹쳐 커지지 않게)
        if (!l.bone.quaternion.equals(l.out)) l.clip.copy(l.bone.quaternion);
        if (w <= 0.001) {
          l.bone.quaternion.copy(l.clip);
        } else {
          q.copy(l.mean).slerp(l.clip, 1 + (l.gain - 1) * w);
          l.bone.quaternion.copy(q);
        }
        l.out.copy(l.bone.quaternion);
      }
      if (spine) {
        spineY ??= spine.position.y;
        spine.position.y = spineY + GAIT.bob * 100 * w * bounce(walk.time, clip.duration);
      }
      body.rotation.x = baseX + GAIT.lean * w;
    },
  };
}
