import type { Role } from "@/supabase/functions/_shared/types";

// C02의 정규화된 원본 좌표에서 얼굴만 부드럽게 변형한다.
// UV·뼈대·원본 geometry는 유지하고, 경계가 없는 가우시안 가중치로 이음새를 막는다.
// 보직이 정해지기 전(로비)에는 참가자 식별자에 고정된 표정을, 보직이 정해지면 아래 보직 얼굴을 쓴다.
export const FACE_SHAPES = [
  { eyes: 1.04, brow: .010, smile: .004, cheeks: .00 },
  { eyes: 1.4, brow: .016, smile: .007, cheeks: .016 },
  { eyes: .92, brow: .012, smile: .022, cheeks: .025 },
  { eyes: .78, brow: .004, smile: .009, cheeks: -.012 },
] as const;
const bell = (value: number, center: number, radius: number) => Math.exp(-(((value-center)/radius)**2));
export function facePoint(x: number, y: number, z: number, face: number): [number,number,number] {
  const f = FACE_SHAPES[face] ?? FACE_SHAPES[0];
  const front = bell(z,.15,.07);
  const eyes = bell(Math.abs(x),.087,.045) * bell(y,.612,.035) * front;
  const brows = bell(Math.abs(x),.087,.06) * bell(y,.66,.024) * front;
  const mouth = bell(x,.04,.07) * bell(y,.535,.028) * front;
  const cheek = bell(Math.abs(x),.16,.07) * bell(y,.55,.07) * front;
  return [
    x + Math.sign(x) * f.cheeks * cheek,
    y + (y-.612)*(f.eyes-1)*eyes + f.brow*(1-Math.abs(x)/.13)*brows + f.smile*(Math.min(1, ((x-.04)/.045)**2)-.4)*mouth,
    z + Math.abs(f.cheeks)*.2*cheek,
  ];
}

// 보직별 얼굴(hh 2026-10-29, pm-design/brand-v1/character-lab 시안): 머리 윤곽·귀·코·몸·뼈대는 그대로,
// 눈·눈썹·입만 바꾼다. 같은 보직이면 어느 기기에서나 같은 얼굴이다.
// 지휘관 안정된 눈매·작은 미소 / 정찰원 둥근 눈·올라간 눈썹 / 통신원 밝은 눈썹·큰 미소 / 암호해독관 차분한 눈매·작은 입
export const ROLE_FACES: Record<Role, { eyeH: number; eyeW: number; browTilt: number; browLift: number; browArch: number; smile: number; mouthW: number }> = {
  commander: { eyeH: .90, eyeW: 1.04, browTilt: .004, browLift: .001, browArch: .002, smile: .008, mouthW: .88 },
  scout: { eyeH: 1.32, eyeW: .95, browTilt: -.012, browLift: .012, browArch: .005, smile: .012, mouthW: .90 },
  signal: { eyeH: 1.05, eyeW: 1.06, browTilt: -.004, browLift: .005, browArch: .010, smile: .025, mouthW: 1.15 },
  cipher: { eyeH: .84, eyeW: .91, browTilt: 0, browLift: .004, browArch: .003, smile: .004, mouthW: .72 },
};
export function roleFacePoint(x: number, y: number, z: number, role: Role): [number,number,number] {
  const f = ROLE_FACES[role];
  const front = bell(z,.145,.055);
  let dx = 0, dy = 0;
  for (const side of [-1, 1]) {
    const cx = side < 0 ? -.087 : .123, cy = .614;
    const eye = bell(x,cx,.044) * bell(y,cy,.036) * front;
    dx += ((x-cx)*(f.eyeW-1) + (side*.103-cx)*.38) * eye;
    dy += (y-cy)*(f.eyeH-1) * eye;
    const brow = bell(x,cx,.052) * bell(y,.681,.019) * front;
    dy += (f.browLift + side*(x-cx)*f.browTilt/.05 + f.browArch*(1-Math.min(1, ((x-cx)/.045)**2))) * brow;
  }
  const mouth = bell(x,.026,.052) * bell(y,.533,.022) * bell(z,.166,.035);
  dx += (x-.026)*(f.mouthW-1) * mouth;
  dy += f.smile*(Math.min(1, ((x-.026)/.038)**2)-.45) * mouth;
  return [x+dx, y+dy, z];
}
