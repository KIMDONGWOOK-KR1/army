import { describe, expect, it } from "vitest";
import { FOOT_STEPS, footY, GroundBuilder, LAYER } from "../components/field-ground";

// 바닥 층이 겹쳐 지지직거리지 않게: 보행로 재질 층이 서로, 그리고 위아래 층과 겹치지 않는다.
describe("보행로 바닥 높이", () => {
  const all = (f: "sand" | "pave" | "brick") =>
    Array.from({ length: FOOT_STEPS }, (_, i) => footY(f, i));
  it("마사토 < 보도블록 < 벽돌 < 서비스 길 순서로 띄운다", () => {
    expect(Math.min(...all("sand"))).toBeGreaterThan(LAYER.edge);
    expect(Math.max(...all("sand"))).toBeLessThan(Math.min(...all("pave")));
    expect(Math.max(...all("pave"))).toBeLessThan(Math.min(...all("brick")));
    expect(Math.max(...all("brick"))).toBeLessThan(LAYER.service);
  });
  it("길마다 1mm 넘게 다른 높이를 받는다", () => {
    const ys = all("brick");
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(0.001);
  });
});

describe("보행로 꺾임·끝 부채꼴", () => {
  it("부채꼴은 벽돌 칸 가운데 무늬 좌표만 써서 줄눈(흰 삼각형)이 생기지 않는다", () => {
    const gb = new GroundBuilder();
    // 시작점(길 따라 거리 0 = 줄눈 위)과 꺾인 곳이 있는 길
    gb.ribbon([0, 0, 10, 0, 10, 10], 3, LAYER.foot, true);
    const gp = gb.gp;
    // 앞 두 구간(삼각형 4개 = 꼭짓점 12개) 뒤는 모두 부채꼴
    for (let v = 12; v < gp.length / 2; v++) {
      const x = gp[v * 2], y = gp[v * 2 + 1];
      expect(Math.abs(((x / 0.9) % 1) - 0.5)).toBeLessThan(1e-6);
      expect(y).toBeCloseTo(0.225);
    }
  });
});
