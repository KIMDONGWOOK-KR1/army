import { describe, expect, it } from "vitest";
import { buildCollider, campusCollider, CHAR_R, memorialWallSegments, moveWithin, type Collider } from "../components/field-collide";
import jnu from "../components/maps/jnu.json";
import type { MapData } from "../components/field-geom";

// 벽 통과 재현·수정 시험(hh 2026-10-28): 정면, 대각선, 모서리, 연속 이동, 낮은 프레임, 통로
const MAP = jnu as unknown as MapData;
const square = buildCollider({ polys: [[0, 0, 10, 0, 10, 10, 0, 10]] });
// 몸(반지름 CHAR_R)이 정사각형 건물과 겹치는가: 건물까지 거리가 몸 반지름보다 가까우면 겹친다
const inBox = (x: number, z: number) => Math.hypot(Math.max(0 - x, 0, x - 10), Math.max(0 - z, 0, z - 10)) < CHAR_R - 1e-3;
// 프레임마다 목표 쪽으로 speed*dt만큼 움직이는 Field3D의 이동을 흉내 낸다
function walk(col: Collider, from: { x: number; z: number }, goal: { x: number; z: number }, frames: number, speed = 9, dt = 1 / 30) {
  let p = { ...from };
  const path = [p];
  for (let i = 0; i < frames; i++) {
    const dx = goal.x - p.x, dz = goal.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.01) break;
    const step = Math.min(d, speed * dt);
    const m = moveWithin(col, p, { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step });
    p = { x: m.x, z: m.z };
    path.push(p);
  }
  return path;
}

describe("character collision", () => {
  it("stops in front of a wall when walking straight into it", () => {
    const path = walk(square, { x: -6, z: 5 }, { x: 5, z: 5 }, 120);
    expect(path.every((p) => !inBox(p.x, p.z))).toBe(true);
    expect(path.at(-1)!.x).toBeCloseTo(-CHAR_R, 1);
  });
  it("slides along the wall on a diagonal and never enters", () => {
    const path = walk(square, { x: -6, z: 2 }, { x: 4, z: 14 }, 200);
    expect(path.every((p) => !inBox(p.x, p.z))).toBe(true);
    expect(path.at(-1)!.z).toBeGreaterThan(2); // 벽을 따라 미끄러져 올라간다
  });
  it("goes around a corner without squeezing through it", () => {
    const path = walk(square, { x: -3, z: -3 }, { x: 13, z: 13 }, 400);
    expect(path.every((p) => !inBox(p.x, p.z))).toBe(true);
  });
  it("does not jitter when the goal is straight behind a wall", () => {
    const path = walk(square, { x: -6, z: 5 }, { x: 15, z: 5 }, 300);
    const tail = path.slice(-30);
    for (let i = 1; i < tail.length; i++) expect(Math.hypot(tail[i].x - tail[i - 1].x, tail[i].z - tail[i - 1].z)).toBeLessThan(0.03);
  });
  it("does not get stuck in an inside corner of an L-shaped building", () => {
    const L = buildCollider({ polys: [[0, 0, 20, 0, 20, 6, 6, 6, 6, 20, 0, 20]] });
    const path = walk(L, { x: 14, z: 14 }, { x: 30, z: 14 }, 200);
    expect(path.at(-1)!.x).toBeGreaterThan(29);
  });
  it("never tunnels through a thin wall with fast movement or a low frame rate", () => {
    const thin = buildCollider({ capsules: [{ ax: 0, az: -10, bx: 0, bz: 10, r: 0.4 }] });
    for (const [speed, dt] of [[9, 1 / 60], [16, 1 / 10], [40, 0.25]]) {
      const path = walk(thin, { x: -5, z: 0 }, { x: 5, z: 0 }, 200, speed, dt);
      expect(path.every((p) => p.x < 0)).toBe(true);
    }
  });
  it("keeps the demo walking routes (through the gate walkway) and the memorial wall opening free", () => {
    const col = campusCollider(MAP);
    for (const leg of MAP.legs)
      for (let i = 0; i + 3 < leg.length; i += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(leg[i + 2] - leg[i], leg[i + 3] - leg[i + 1]) / 0.5));
        for (let k = 0; k <= n; k++) {
          const x = leg[i] + ((leg[i + 2] - leg[i]) * k) / n, z = leg[i + 1] + ((leg[i + 3] - leg[i + 1]) * k) / n;
          const r = col.resolve(x, z);
          if (r) expect(Math.hypot(r.x - x, r.z - z)).toBeLessThan(CHAR_R);
        }
      }
  });
  it("blocks the main gate's pillars, fins, sign wall and median but keeps the walkway, both lanes and the outer ends open", () => {
    const col = campusCollider(MAP), g = MAP.anchors.gate, t = MAP.anchors.tower;
    // 정문 모형 좌표(m) → 지도 좌표(field-map: 1.65배, 바깥이 용봉탑 반대쪽)
    const a = Math.atan2(t[0] - g[0], t[1] - g[1]) + Math.PI, s = 1.65;
    const w = (lx: number, lz: number) => ({ x: g[0] + s * (lx * Math.cos(a) + lz * Math.sin(a)), z: g[1] + s * (-lx * Math.sin(a) + lz * Math.cos(a)) });
    // 바깥(+z)에서 안쪽(-z)으로 곧장 걸어 들어간다
    const through = (lx: number) => walk(col, w(lx, 6), w(lx, -6), 200, 7);
    const crossed = (lx: number) => { const e = through(lx).at(-1)!, end = w(lx, -6); return Math.hypot(e.x - end.x, e.z - end.z) < 0.5; };
    expect(crossed(7.2)).toBe(true); // 동쪽 사람 통로(시연 길이 지나는 보도)
    expect(crossed(2.4)).toBe(true); // 동쪽 차로
    expect(crossed(-2.4)).toBe(true); // 서쪽 차로
    expect(crossed(13.4)).toBe(true); // 동쪽 끝 바깥
    expect(crossed(5)).toBe(false); // 안쪽 돌기둥
    expect(crossed(9.3)).toBe(false); // 세로 살
    expect(crossed(11)).toBe(false); // 글자 벽
    expect(crossed(-7)).toBe(false); // 서쪽 살 담장
    expect(crossed(0)).toBe(false); // 분리대 화분
    // 글자 벽에 막혀 서 있을 때 떨리지 않는다
    const stuck = through(11).slice(-20);
    expect(Math.max(...stuck.map((p) => Math.hypot(p.x - stuck[0].x, p.z - stuck[0].z)))).toBeLessThan(0.01);
  });
  it("blocks the closed side of the memorial wall but lets you walk in through the open side", () => {
    const col = campusCollider(MAP);
    const [wx, wz] = MAP.anchors.wall, [hx, hz] = MAP.anchors.hall;
    const len = Math.hypot(hx - wx, hz - wz), ux = (hx - wx) / len, uz = (hz - wz) / len;
    // 뒤쪽(용봉관 반대편)에서 가운데로 걸어 들어가면 돌벽 앞에서 멈춘다
    const back = walk(col, { x: wx - ux * 25, z: wz - uz * 25 }, { x: wx, z: wz }, 300);
    expect(Math.hypot(back.at(-1)!.x - wx, back.at(-1)!.z - wz)).toBeGreaterThan(13);
    // 열린 쪽(용봉관 쪽)에서는 가운데까지 들어간다
    const front = walk(col, { x: wx + ux * 25, z: wz + uz * 25 }, { x: wx, z: wz }, 300);
    expect(Math.hypot(front.at(-1)!.x - wx, front.at(-1)!.z - wz)).toBeLessThan(0.5);
    expect(memorialWallSegments(MAP.anchors.wall, MAP.anchors.hall)).toHaveLength(15);
  });
  it("pushes a GPS point inside Yongbonggwan out to the nearest wall", () => {
    const col = campusCollider(MAP);
    const [cx, cz] = MAP.boxes.hall.c;
    const r = col.resolve(cx, cz)!;
    expect(r).not.toBeNull();
    expect(col.resolve(r.x, r.z)).toBeNull();
  });
});
