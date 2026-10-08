import { describe, expect, it } from "vitest";
import {
  GATHER,
  gatherFlags,
  slotSpot,
  softwareRenderer,
  spawnPoint,
  turnToward,
  viewDistance,
  walkAt,
} from "../components/gather-view";
import { roadAxis, soldierSpots } from "../components/home-view";

// 모이기·보직 공개·장비 장면의 입체 배경 구도(gather-view.ts)를 본다.
const gate = { x: 10, z: -20 },
  axis = roadAxis(gate, { x: 10, z: -120 }),
  spots = soldierSpots(gate, axis, 4);

describe("모이기 자리와 걸어 들어오기", () => {
  it("들어온 차례대로 화면 왼쪽부터 자리를 채운다", () => {
    expect(slotSpot(spots, 0)).toBe(spots[3]);
    expect(slotSpot(spots, 3)).toBe(spots[0]);
    expect(new Set([0, 1, 2, 3].map((i) => slotSpot(spots, i))).size).toBe(4);
  });

  it("정문 안쪽 길에서 나와 자기 자리로 걷는다", () => {
    for (let i = 0; i < 4; i++) {
      const spot = slotSpot(spots, i),
        from = spawnPoint(gate, axis, spot);
      // 출발점은 정문보다 안쪽(axis 쪽), 자리는 바깥쪽
      const inward = (p: { x: number; z: number }) =>
        (p.x - gate.x) * axis.x + (p.z - gate.z) * axis.z;
      expect(inward(from)).toBeGreaterThan(0);
      expect(inward(spot)).toBeLessThan(0);
    }
  });

  it("걷기는 흐른 시간으로 자리를 정한다(띄엄띄엄 그려도 제때 닿는다)", () => {
    const w = {
      from: { x: 0, z: 0 },
      to: { x: 0, z: 12 },
      startAt: 1000,
      speed: 4,
    };
    expect(walkAt(w, 500)).toMatchObject({ started: false, x: 0, z: 0 });
    const mid = walkAt(w, 2500);
    expect(mid.started).toBe(true);
    expect(mid.arrived).toBe(false);
    expect(mid.z).toBeCloseTo(6, 9);
    // 3초(12m ÷ 4m/s) 뒤에는 한 번에 크게 건너뛰어도 정확히 자리에 선다
    expect(walkAt(w, 4000)).toMatchObject({ arrived: true, x: 0, z: 12 });
    expect(walkAt(w, 60000)).toMatchObject({ arrived: true, x: 0, z: 12 });
    expect(walkAt({ ...w, to: w.from }, 1000).arrived).toBe(true);
  });

  it("돌아서기는 짧은 쪽으로 돈다", () => {
    expect(turnToward(0, Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 9);
    expect(turnToward(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 9);
    // 350도 → 10도는 -340도가 아니라 +20도 쪽으로
    const a = (350 * Math.PI) / 180,
      b = (10 * Math.PI) / 180;
    expect(turnToward(a, b, 1) - a).toBeCloseTo((20 * Math.PI) / 180, 9);
    expect(turnToward(1, 2, -1)).toBe(1);
  });
});

describe("모이기 카메라 거리", () => {
  const base = { viewW: 390, viewH: 844, bandH: 300, fov: 46 };
  it("네 사람 줄이 화면 너비 안에 들어온다", () => {
    const d = viewDistance({
        ...base,
        share: GATHER.share.line,
        span: GATHER.span,
      }),
      t = Math.tan(((base.fov / 2) * Math.PI) / 180),
      visibleW = 2 * d * t * (base.viewW / base.viewH);
    expect(visibleW * GATHER.fill).toBeGreaterThanOrEqual(GATHER.span - 1e-6);
  });

  it("내 장병만 비추는 구도가 줄 구도보다 가깝고, 범위 밖으로 나가지 않는다", () => {
    const line = viewDistance({
        ...base,
        share: GATHER.share.line,
        span: GATHER.span,
      }),
      self = viewDistance({ ...base, share: GATHER.share.self });
    expect(self).toBeLessThan(line);
    for (const bandH of [0, 40, 200, 600, 2000]) {
      const d = viewDistance({ ...base, bandH, share: GATHER.share.self });
      expect(d).toBeGreaterThanOrEqual(GATHER.dist.min);
      expect(d).toBeLessThanOrEqual(GATHER.dist.max);
    }
  });
});

describe("소프트웨어 WebGL 판별", () => {
  it("CPU로 그리는 렌더러만 고른다", () => {
    for (const name of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Microsoft Basic Render Driver",
    ])
      expect(softwareRenderer(name)).toBe(true);
    for (const name of [
      "Adreno (TM) 650",
      "Apple GPU",
      "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Mali-G78",
      "WebKit WebGL",
      "",
    ])
      expect(softwareRenderer(name)).toBe(false);
  });

  it("?3d=1이면 소프트웨어 WebGL에서도 입체로 띄운다", () => {
    expect(gatherFlags("?dev=1&3d=1").force3d).toBe(true);
    expect(gatherFlags("?dev=1").force3d).toBe(false);
    expect(gatherFlags("").force3d).toBe(false);
  });
});
