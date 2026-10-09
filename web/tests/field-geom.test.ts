import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { frontOf, insidePoly, type MapRoad } from "../components/field-geom";
import {
  chainOnBeforeCompile,
  seeThrough,
} from "../components/field-occlusion";

// 가로 20m 정사각형 건물(가운데 원점). 고리 방향을 바꿔도 같은 답이어야 한다.
const SQUARE = [-10, -10, 10, -10, 10, 10, -10, 10];
const reversed = (p: number[]) => {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
};
const foot = (p: number[]): MapRoad => ({ k: 2, w: 3, p });
const car = (p: number[]): MapRoad => ({ k: 0, w: 14, p });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("frontOf: 건물 정면은 가장 가까운 보행로를 보는 벽", () => {
  it("남쪽 보행로를 보면 남쪽 벽 가운데에서 +z를 본다", () => {
    for (const p of [SQUARE, reversed(SQUARE)]) {
      const f = frontOf({ p }, [foot([-30, 20, 30, 20])]);
      close(f.x, 0);
      close(f.z, 10);
      close(f.ry, 0);
    }
  });

  it("동쪽 보행로를 보면 동쪽 벽에서 +x를 본다", () => {
    for (const p of [SQUARE, reversed(SQUARE)]) {
      const f = frontOf({ p }, [foot([18, -40, 18, 40])]);
      close(f.x, 10);
      close(f.z, 0);
      close(f.ry, Math.PI / 2);
    }
  });

  it("더 가까운 차도보다 보행로 쪽을 정면으로 삼는다", () => {
    const f = frontOf({ p: SQUARE }, [
      car([-30, -14, 30, -14]), // 북쪽 4m
      foot([-40, 0, -25, 0]), // 서쪽 15m
    ]);
    close(f.x, -10);
    close(f.z, 0);
    close(Math.abs(f.ry), Math.PI / 2);
    expect(f.ry).toBeLessThan(0);
  });

  it("가까이 보행로가 없으면 차도를, 길이 없으면 가장 긴 벽을 쓴다", () => {
    const viaCar = frontOf({ p: SQUARE }, [
      car([-30, -14, 30, -14]),
      foot([500, 500, 520, 500]),
    ]);
    close(viaCar.z, -10);
    close(Math.abs(viaCar.ry), Math.PI);

    const long = [-20, -5, 20, -5, 20, 5, -20, 5]; // 동서로 긴 건물
    const f = frontOf({ p: long }, []);
    close(Math.abs(f.z), 5);
    // 정면 쪽으로 조금 나간 점은 건물 밖이다
    expect(insidePoly(long, f.x + Math.sin(f.ry), f.z + Math.cos(f.ry))).toBe(
      false,
    );
  });

  it("오목한 ㄱ자 건물에서도 바깥을 본다", () => {
    // 북동쪽이 파인 ㄱ자: 보행로는 파인 자리 안쪽(동쪽)으로 지난다
    const ell = [0, 0, 30, 0, 30, -10, 10, -10, 10, -30, 0, -30];
    const f = frontOf({ p: ell }, [foot([20, -40, 20, -12])]);
    expect(
      insidePoly(ell, f.x + Math.sin(f.ry) * 0.5, f.z + Math.cos(f.ry) * 0.5),
    ).toBe(false);
    expect(Number.isFinite(f.ry)).toBe(true);
  });
});

describe("시야 구멍 자리와 셰이더 고치기 잇기", () => {
  it("seeThrough는 아직 재질을 그대로 돌려준다", () => {
    const m = new THREE.MeshStandardMaterial();
    expect(seeThrough(m)).toBe(m);
  });

  it("고치기를 이름마다 한 번, 넣은 차례대로 돌리고 캐시 열쇠를 합친다", () => {
    const m = new THREE.MeshStandardMaterial(),
      ran: string[] = [];
    chainOnBeforeCompile(m, "windows", () => ran.push("windows"));
    chainOnBeforeCompile(m, "dither", () => ran.push("dither"));
    chainOnBeforeCompile(m, "windows", () => ran.push("again"));
    m.onBeforeCompile(
      {} as Parameters<THREE.Material["onBeforeCompile"]>[0],
      {} as THREE.WebGLRenderer,
    );
    expect(ran).toEqual(["windows", "dither"]);
    expect(m.customProgramCacheKey()).toBe("windows|dither");
  });
});
