import * as THREE from "three";
import {
  at,
  atE,
  Batch,
  C,
  disc,
  rbox,
  UNIT,
  Windows,
  type V3,
} from "./field-kit";
import { isPhoneView, worldMaterial } from "./field-clay";

// 정문·용봉탑·용봉관 모형. 각 모형은 자기 중심을 원점으로 하는 장난감 단위(1단위 ≈ 2.4m 안팎)로
// 만들고, 지도에 세울 때 실제 크기와 방향에 맞춰 키우고 돌린다. 앞(정면)은 +z 쪽이다.

// 평지붕: 회색 바닥판에 흰 난간 테두리를 두른다(위에서 봐도 지붕 전체가 하얗지 않게).
function flatRoof(
  b: Batch,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  rim = 0.22,
) {
  b.add(rbox(w, 0.1, d, 0.02), C.roofDeck, at([x, y + 0.05, z]));
  for (const s of [-1, 1]) {
    b.add(
      rbox(w + rim, 0.26, rim, 0.02),
      C.white,
      at([x, y + 0.1, z + (s * d) / 2]),
    );
    b.add(
      rbox(rim, 0.26, d + rim, 0.02),
      C.white,
      at([x + (s * w) / 2, y + 0.1, z]),
    );
  }
}

// 용봉관(1957): 짙은 붉은 벽돌 3층 좌우대칭 평지붕. 층마다 흰 창턱 띠와 흰 틀 세로창,
// 칸마다 벽돌 기둥, 흰 난간. 가운데 칸은 흰 세로 기둥 다섯 사이로 긴 유리창이 서고,
// 그 뒤로 지붕보다 두 층쯤 높은 시계탑, 1층에는 가는 흰 기둥의 흰 평지붕 현관이 있다.
function yongbonggwan(b: Batch, win: Windows) {
  const z = 0,
    wd = 6,
    wingFront = z + wd / 2,
    white = C.white,
    sills = [0.62, 2.02, 3.42];
  for (const sx of [-1, 1]) {
    const x = sx * 7.7,
      w = 9.4,
      bays = 6,
      bw = w / bays;
    b.add(rbox(w, 4.8, wd, 0.12), C.brick, at([x, 2.4, z]), 4.8);
    b.add(rbox(w + 0.1, 0.4, wd + 0.1, 0.04), C.brickDark, at([x, 0.2, z]));
    flatRoof(b, x, 4.8, z, w, wd);
    for (const y of sills)
      b.add(rbox(w, 0.08, 0.1, 0.01), white, at([x, y, wingFront + 0.04]));
    for (let i = 0; i <= bays; i++) {
      const px = x - w / 2 + i * bw;
      b.add(
        rbox(0.2, 4.6, 0.12, 0.02),
        C.brickDark,
        at([px, 2.3, wingFront + 0.05]),
      );
      b.add(
        rbox(0.32, 0.24, 0.32, 0.02),
        white,
        at([px, 5.12, wingFront - 0.04]),
      );
    }
    for (let f = 0; f < 3; f++)
      for (let i = 0; i < bays; i++)
        for (const o of [-0.3, 0.3]) {
          const wx = x - w / 2 + (i + 0.5) * bw + o;
          win.add(wx, 1.1 + f * 1.4, wingFront + 0.01, 0, 0.4, 0.8);
          win.add(wx, 1.1 + f * 1.4, z - wd / 2 - 0.01, Math.PI, 0.4, 0.8);
        }
    // 양 끝 칸은 앞뒤로 살짝 나오고 더 높다
    const ex = sx * 13.6,
      ef = z + wd / 2 + 0.4;
    b.add(rbox(2.4, 5.3, wd + 0.8, 0.12), C.brick, at([ex, 2.65, z]), 5.3);
    b.add(rbox(2.5, 0.4, wd + 0.9, 0.04), C.brickDark, at([ex, 0.2, z]));
    flatRoof(b, ex, 5.3, z, 2.4, wd + 0.8);
    for (const y of sills)
      b.add(rbox(2.4, 0.08, 0.1, 0.01), white, at([ex, y, ef + 0.04]));
    for (let f = 0; f < 3; f++) {
      const y = 1.1 + f * 1.4;
      for (const o of [-0.45, 0.45]) win.add(ex + o, y, ef + 0.01, 0, 0.4, 0.8);
      for (const dz of [-2, 0, 2])
        win.add(ex + sx * 1.21, y, z + dz, (sx * Math.PI) / 2, 0.4, 0.8);
    }
  }

  // 가운데 몸체와 흰 세로 기둥 칸
  const cz = z + 0.5,
    cd = 7,
    cf = cz + cd / 2;
  b.add(rbox(6.4, 5, cd, 0.12), C.brick, at([0, 2.5, cz]), 5);
  b.add(rbox(6.5, 0.4, cd + 0.1, 0.04), C.brickDark, at([0, 0.2, cz]));
  flatRoof(b, 0, 5, cz, 6.4, cd);
  b.add(rbox(4.2, 4.5, 0.1, 0.01), C.pane, at([0, 2.65, cf + 0.03]));
  for (const y of [1.7, 3.1])
    b.add(rbox(4.1, 0.06, 0.08, 0.01), white, at([0, y, cf + 0.08]));
  for (const [px, pw] of [
    [-2.05, 0.38],
    [-1.02, 0.24],
    [0, 0.24],
    [1.02, 0.24],
    [2.05, 0.38],
  ])
    b.add(rbox(pw, 4.9, 0.36, 0.03), white, at([px, 2.75, cf + 0.12]));
  b.add(rbox(4.7, 0.34, 0.44, 0.03), white, at([0, 5.3, cf + 0.12]));
  b.add(rbox(2.3, 0.3, 0.44, 0.03), white, at([0, 5.6, cf + 0.12]));
  for (const sx of [-1, 1])
    for (let f = 0; f < 3; f++)
      win.add(sx * 2.75, 1.1 + f * 1.4, cf + 0.01, 0, 0.34, 0.8);

  // 시계탑: 흰 계단식 난간과 모서리 꼭지, 시계 아래 가는 세로창 둘
  const tz = z + 0.2,
    top = 8.8,
    tf = tz + 1.6;
  b.add(rbox(3.2, top - 4.9, 3.2, 0.1), C.brick, at([0, (top + 4.9) / 2, tz]));
  flatRoof(b, 0, top, tz, 3.2, 3.2, 0.26);
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.add(
      rbox(0.36, 0.55, 0.36, 0.03),
      white,
      at([dx * 1.55, top + 0.5, tz + dz * 1.55]),
    );
  b.add(rbox(2.2, 0.85, 2.2, 0.08), C.brick, at([0, top + 0.52, tz]));
  flatRoof(b, 0, top + 0.95, tz, 2.2, 2.2, 0.2);
  for (const dx of [-0.32, 0.32])
    b.add(rbox(0.16, 1.1, 0.05, 0.01), C.pane, at([dx, 6.1, tf + 0.02]));
  // 시계: 정면과 양옆. 흰 판, 어두운 테, 바늘
  const face = (
    ry: number,
    geo: THREE.BufferGeometry,
    color: string,
    s: V3,
    dz: number,
    rz = 0,
    off = 0,
  ) =>
    b.add(
      geo,
      color,
      new THREE.Matrix4()
        .makeTranslation(0, 7.55, tz)
        .multiply(new THREE.Matrix4().makeRotationY(ry))
        .multiply(new THREE.Matrix4().makeTranslation(0, 0, dz))
        .multiply(new THREE.Matrix4().makeRotationZ(rz))
        .multiply(new THREE.Matrix4().makeTranslation(0, off, 0))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeScale(...s)),
    );
  for (const ry of [0, Math.PI / 2, -Math.PI / 2]) {
    face(ry, UNIT.circle, C.beam, [0.78, 0.06, 0.78], 1.61);
    face(ry, UNIT.circle, C.frame, [0.66, 0.06, 0.66], 1.64);
    face(ry, UNIT.cyl, C.boot, [0.045, 0.05, 0.26], 1.68, 0.5, 0.24);
    face(ry, UNIT.cyl, C.boot, [0.055, 0.05, 0.18], 1.69, -1.9, 0.17);
  }

  // 현관: 흰 평지붕 캐노피, 가는 흰 기둥, 돌계단
  const pf = cf + 2.6;
  b.add(rbox(4.8, 0.3, 2.8, 0.06), white, at([0, 2.2, cf + 1.3]));
  b.add(rbox(4.9, 0.1, 2.9, 0.02), C.creamShade, at([0, 2.02, cf + 1.3]));
  for (const sx of [-1, 1])
    b.add(rbox(0.24, 2.05, 0.24, 0.03), white, at([sx * 2.2, 1.03, pf - 0.2]));
  b.add(rbox(4.8, 0.3, 2.7, 0.04), C.stone, at([0, 0.15, cf + 1.3]));
  for (let s = 0; s < 3; s++)
    b.add(
      rbox(5.4 - s * 0.3, 0.1, 1.0, 0.02),
      C.stone,
      at([0, 0.05 + s * 0.1, pf + 0.4 - s * 0.22]),
    );

  // 앞 잔디: 비스듬한 디딤돌과 현관 옆 꽃 화분
  for (const sx of [-1, 1]) {
    b.add(rbox(10, 0.24, 4.4, 0.1), C.lawn, at([sx * 8.6, 0.12, z + 5.4]));
    for (let i = 0; i < 5; i++)
      b.add(
        rbox(1.5, 0.06, 0.34, 0.02),
        C.granite,
        at(
          [sx * (5.4 + i * 1.5), 0.27, z + 4.6 + (i % 2) * 1.3],
          [1, 1, 1],
          sx * 0.45,
        ),
      );
    for (const px of [3.6, 5.0]) {
      b.add(
        rbox(0.9, 0.42, 0.9, 0.06),
        C.granite,
        at([sx * px, 0.45, z + 3.9]),
      );
      for (let k = 0; k < 3; k++)
        b.add(
          UNIT.bush,
          C.flower[(k + (px > 4 ? 1 : 0)) % 3],
          at(
            [sx * px + (k - 1) * 0.24, 0.78, z + 3.9 + (k % 2) * 0.12],
            [0.22, 0.17, 0.22],
          ),
        );
    }
  }
  b.add(rbox(7.2, 0.12, 4.6, 0.04), C.pave, at([0, 0.06, z + 5.4]));
}

// 정문(1996): 4차로 양쪽에 화강암 블록 기둥과 짙은 갈색 평지붕 판으로 된 문이 한 채씩 선다.
// 도로 위는 비어 있다. 서쪽 채에는 꼭대기가 뚫리고 어두운 원판이 걸린 높은 탑과
// 세로 살 벽이, 동쪽 채 지붕 아래에는 세로 루버와 학교 이름 판이 있는 경비실이 있다.
function gate(b: Batch) {
  const z = 0;
  const granite = (x: number, w: number, h: number, d = 1.3) => {
    b.add(rbox(w, h, d, 0.08), C.granite, at([x, h / 2, z]), h);
    for (let y = 0.6; y < h - 0.2; y += 0.6)
      b.add(
        rbox(w + 0.03, 0.04, d + 0.03, 0.01),
        C.graniteJoint,
        at([x, y, z]),
      );
  };
  for (const sx of [-1, 1])
    b.add(rbox(8.2, 0.12, 3.4, 0.04), C.pave, at([sx * 8.15, 0.06, z]));

  // 서쪽 채: 바깥 기둥 + 갈색 판 + 세로 살 + 높은 탑
  granite(-8.8, 1.1, 4.2);
  b.add(rbox(5.1, 0.6, 1.7, 0.08), C.beam, at([-6.8, 3.75, z]));
  for (let i = 0; i < 6; i++)
    b.add(
      rbox(0.14, 3.4, 0.14, 0.02),
      C.beam,
      at([-7.95 + i * 0.36, 1.7, z - 0.3]),
    );
  const tx = -5.2;
  granite(tx, 1.5, 7.4);
  for (const dx of [-0.6, 0.6])
    b.add(rbox(0.3, 2.6, 1.3, 0.05), C.granite, at([tx + dx, 8.7, z]));
  b.add(rbox(1.7, 0.55, 1.45, 0.08), C.granite, at([tx, 10.25, z]));
  b.add(UNIT.circle, C.beam, disc([tx + 0.12, 8.75, z], 0.48, 0.24));

  // 동쪽 채: 안쪽 기둥(둥근 학교 표지) + 긴 갈색 판 + 경비실 + 바깥 기둥
  granite(5.0, 1.1, 3.5);
  b.add(UNIT.circle, C.bronze, disc([5.0, 2.5, z + 0.66], 0.22, 0.04));
  b.add(rbox(7.7, 0.6, 1.9, 0.08), C.beam, at([8.1, 3.8, z]));
  granite(11.3, 1.3, 4.6, 1.5);
  b.add(rbox(4.6, 2.6, 2, 0.12), C.guard, at([8.3, 1.3, z - 0.1]), 2.6);
  b.add(rbox(4.8, 0.18, 2.2, 0.04), C.guardShade, at([8.3, 2.68, z - 0.1]));
  b.add(rbox(0.9, 2.0, 0.1, 0.01), C.beam, at([6.6, 1.0, z + 0.92]));
  for (let i = 0; i < 6; i++)
    b.add(
      rbox(0.12, 2.3, 0.22, 0.02),
      C.guardShade,
      at([7.25 + i * 0.28, 1.2, z + 0.98]),
    );
  b.add(rbox(1.6, 0.26, 0.05, 0.01), C.beam, at([9.6, 1.75, z + 0.93]));
}

// 정문 동쪽 5·18 소공원의 사적비와 청동 횃불, 서쪽 기념 조형물 '피어나다'(꽃잎 셋).
// 각각 지도에 찍힌 자리에 낮고 단정하게 둔다. 원점은 조형물 가운데.
// 사적비는 실제 크기(m, 배율 1): 판석 마당 위 화강석 받침(0.5m)에 곧게 선 비석 2.4 × 0.6 × 3.2.
// 글자는 새기지 않는다. 앞(+z)이 정문을 본다.
export const MEMORIAL_SLAB = { w: 2.4, d: 0.6, h: 3.2, base: 0.5 };
function memorialStone(b: Batch) {
  const S = MEMORIAL_SLAB,
    pad = 0.3;
  b.add(rbox(10.5, pad, 7.5, 0.12), C.pave, at([0, pad / 2, 0]));
  b.add(rbox(S.w + 1.0, S.base, S.d + 0.9, 0.08), C.granite, at([0, pad + S.base / 2, 0]));
  b.add(rbox(S.w, S.h, S.d, 0.1), C.stone, at([0, pad + S.base + S.h / 2, 0]));
  b.add(UNIT.cyl, C.bronze, at([2.6, pad + 0.9, 0.6], [0.18, 1.8, 0.18]));
  b.add(UNIT.sphere, C.bronze, at([2.6, pad + 1.95, 0.6], [0.3, 0.45, 0.3]));
}
function bloomSculpture(b: Batch) {
  b.add(UNIT.circle, C.pave, at([0, 0.1, 0], [3.2, 0.2, 3.2]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * 0.5, 1.4, Math.sin(a) * 0.5)
      .multiply(new THREE.Matrix4().makeRotationY(-a))
      .multiply(new THREE.Matrix4().makeRotationZ(0.35))
      .multiply(new THREE.Matrix4().makeScale(0.32, 1.4, 0.7));
    b.add(UNIT.sphere, C.frame, m);
  }
}

// 용봉탑(13.66m): 로터리 잔디섬 위 화강암 받침(가운데 비석 몸체, 양쪽으로 비스듬히 내려와
// 아치를 이루는 날개), 그 위로 셋이 얽혀 오르는 청동 기둥, 꼭대기에 날개 편 봉황.
function yongbongTower(b: Batch) {
  const z = 0,
    y0 = 0.36;
  // 로터리 가운데 잔디섬: 연석, 잔디, 생울타리
  b.add(UNIT.circle, C.curb, at([0, 0.16, z], [3.2, 0.32, 3.2]));
  b.add(UNIT.circle, C.lawn, at([0, 0.2, z], [3.0, 0.36, 3.0]));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) > 0.92) continue;
    b.add(
      UNIT.bush,
      C.hedge,
      at([Math.cos(a) * 2.6, 0.55, z + Math.sin(a) * 2.6], [0.5, 0.32, 0.5]),
      0.9,
    );
  }
  b.add(rbox(4.6, 0.3, 2.0, 0.08), C.granite, at([0, y0 + 0.15, z]));
  b.add(rbox(1.3, 3.0, 1.2, 0.08), C.granite, at([0, y0 + 1.8, z]), 3.3);
  b.add(rbox(0.26, 2.6, 0.05, 0.01), C.white, at([0, y0 + 1.8, z + 0.62]));
  for (const s of [-1, 1]) {
    b.add(rbox(0.55, 1.3, 1.1, 0.06), C.granite, at([s * 1.9, y0 + 0.95, z]));
    b.add(
      rbox(1.95, 0.42, 1.0, 0.06),
      C.granite,
      atE([s * 1.25, y0 + 2.3, z], [1, 1, 1], [0, 0, -s * 0.86]),
    );
  }
  const top = y0 + 3.3;
  b.add(UNIT.cyl, C.patinaDark, at([0, top + 1.5, z], [0.2, 3.0, 0.2]));
  // 용 셋: 나선을 따라 비스듬히 이어지는 마디가 서로 감기며 오른다. 끝마다 머리 하나.
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 8; i++) {
      const a = (k / 3) * Math.PI * 2 + i * 0.8,
        tangent = new THREE.Vector3(
          -Math.sin(a) * 0.3,
          0.4,
          Math.cos(a) * 0.3,
        ).normalize();
      b.add(
        UNIT.capsule,
        (i + k) % 2 ? C.patina : C.patinaDark,
        new THREE.Matrix4().compose(
          new THREE.Vector3(
            Math.cos(a) * 0.36,
            top + 0.3 + i * 0.4,
            z + Math.sin(a) * 0.36,
          ),
          new THREE.Quaternion().setFromUnitVectors(up, tangent),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
    const a = (k / 3) * Math.PI * 2 + 8 * 0.8;
    b.add(
      UNIT.sphere,
      C.patina,
      at(
        [Math.cos(a) * 0.5, top + 3.3, z + Math.sin(a) * 0.5],
        [0.2, 0.16, 0.2],
      ),
    );
  }
  // 봉황: 몸, 머리, 부리, 위로 든 두 날개, 뒤로 퍼진 꼬리 셋
  const py = top + 3.5;
  b.add(
    UNIT.sphere,
    C.patinaDark,
    atE([0, py, z + 0.05], [0.16, 0.16, 0.42], [-0.5, 0, 0]),
  );
  b.add(
    UNIT.sphere,
    C.patinaDark,
    at([0, py + 0.26, z + 0.4], [0.12, 0.12, 0.12]),
  );
  b.add(
    UNIT.cone,
    C.bronze,
    atE([0, py + 0.26, z + 0.58], [0.05, 0.2, 0.05], [Math.PI / 2, 0, 0]),
  );
  for (const s of [-1, 1])
    b.add(
      UNIT.sphere,
      C.patina,
      atE([s * 0.72, py + 0.32, z], [0.9, 0.05, 0.3], [0, 0, s * 0.5]),
    );
  for (const ry of [-0.35, 0, 0.35])
    b.add(
      UNIT.cone,
      C.patina,
      atE(
        [Math.sin(ry) * -0.5, py + 0.15, z - 0.6],
        [0.07, 0.9, 0.07],
        [-Math.PI / 2 + 0.35, ry, 0],
        "YXZ",
      ),
    );
}

function model(build: (b: Batch, win: Windows) => void) {
  const b = new Batch(),
    win = new Windows(),
    g = new THREE.Group();
  build(b, win);
  const land = b.mesh(worldMaterial(isPhoneView(), 0.9));
  land.castShadow = land.receiveShadow = true;
  g.add(land);
  if (win.count) g.add(...win.meshes());
  return g;
}

// 정문: 원점은 도로 가운데 정문 선. 도로는 z축(+z가 바깥 용봉로 쪽), 문 두 채는 x ±4~12.
export const gateModel = () => model((b) => gate(b));
// 5·18 사적지 표지석(동쪽)과 '피어나다'(서쪽)
export const stoneModel = () => model((b) => memorialStone(b));
export const bloomModel = () => model((b) => bloomSculpture(b));
// 용봉탑: 원점은 로터리 잔디섬 가운데(반지름 3.2).
export const towerModel = () => model((b) => yongbongTower(b));
// 용봉관: 원점은 건물 가운데, 정면은 +z. 날개 끝까지 너비 약 29.6, 깊이 약 6.8(현관·앞 잔디 제외).
export const HALL_SIZE = { w: 29.6, d: 6.8 };
export const hallModel = () => model((b, win) => yongbonggwan(b, win));

// 5·18 조용한 구역 안 블렌더 모형의 화단에 칠한 분홍·노랑 꽃을 흰 꽃(#fff6ea)으로 바꾼다.
// 추모 구역은 돌빛과 흰 꽃만 쓴다(결정 사항). 화단 자리(모형 좌표, m) 안의 채도 높은 꽃 색만
// 고르고, 잎(초록)·돌·흙·벽돌(어두운 적갈색, 화단 밖)은 그대로 둔다. 구운 그늘은 밝기로 남긴다.
type Beds = { x: number; y0: number; y1: number; z0: number; z1: number };
// 용봉관 현관 양옆 화단
const HALL_BEDS: Beds = { x: 8, y0: 0.4, y1: 1.1, z0: 9.7, z1: 10.7 };
// 정문 가운데 분리대의 돌 화분(모형 x ±0.33, 높이 0.42~0.87, 길이 방향 −1.86~1.45)
const GATE_BEDS: Beds = { x: 0.5, y0: 0.38, y1: 0.95, z0: -2.2, z1: 1.8 };
const CALM_WHITE = new THREE.Color("#fff6ea");
function calmBeds(geo: THREE.BufferGeometry, beds: Beds, key: string) {
  const p = geo.attributes.position,
    c = geo.attributes.color;
  if (!p || !c || geo.userData[key]) return 0;
  geo.userData[key] = true;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    if (Math.abs(x) > beds.x || y < beds.y0 || y > beds.y1) continue;
    if (z < beds.z0 || z > beds.z1) continue;
    const r = c.getX(i),
      g = c.getY(i),
      b = c.getZ(i),
      hi = Math.max(r, g, b),
      lo = Math.min(r, g, b);
    if (hi < 0.25 || (hi - lo) / hi < 0.45 || (g >= r && g >= b)) continue;
    const k = Math.min(1, Math.max(0.55, hi / 0.9));
    c.setXYZ(i, CALM_WHITE.r * k, CALM_WHITE.g * k, CALM_WHITE.b * k);
    n++;
  }
  if (n) c.needsUpdate = true;
  return n;
}
export const calmHallFlowers = (geo: THREE.BufferGeometry) =>
  calmBeds(geo, HALL_BEDS, "calmFlowers");
export const calmGateFlowers = (geo: THREE.BufferGeometry) =>
  calmBeds(geo, GATE_BEDS, "calmGateFlowers");

// 용봉관 블렌더 모형의 평지붕 바닥을 항공 사진(2026-10-07)처럼 밝은 회색(#d4d4d0)으로 칠한다.
// 위를 보는(법선 y > 0.9) 11m 넘는 면 가운데 채도 낮은 회갈색만 고르고, 흰 난간 갓돌·벽돌·
// 시계 같은 어두운 부분은 그대로 둔다. 구운 그늘은 밝기 비율로 남긴다.
const HALL_ROOF = new THREE.Color("#d4d4d0");
export function lightHallRoof(geo: THREE.BufferGeometry, minY = 11) {
  const p = geo.attributes.position,
    nrm = geo.attributes.normal,
    c = geo.attributes.color;
  if (!p || !nrm || !c || geo.userData.lightRoof) return 0;
  geo.userData.lightRoof = true;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < minY || nrm.getY(i) < 0.9) continue;
    const r = c.getX(i),
      g = c.getY(i),
      b = c.getZ(i),
      hi = Math.max(r, g, b),
      lo = Math.min(r, g, b);
    // 흰 난간(밝기 0.85 넘음), 검은 시계·틈(0.1 아래), 벽돌(채도 높음)은 뺀다
    if (hi >= 0.85 || hi < 0.1 || (hi - lo) / hi > 0.35) continue;
    const k = Math.min(1.05, Math.max(0.6, hi / 0.5));
    c.setXYZ(i, HALL_ROOF.r * k, HALL_ROOF.g * k, HALL_ROOF.b * k);
    n++;
  }
  if (n) c.needsUpdate = true;
  return n;
}
