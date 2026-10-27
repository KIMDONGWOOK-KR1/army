// C02의 정규화된 원본 좌표에서 얼굴만 부드럽게 변형한다.
// UV·뼈대·원본 geometry는 유지하고, 경계가 없는 가우시안 가중치로 이음새를 막는다.
// 표정은 보직·피부색과 무관하게 참가자 식별자에 고정된다.
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
