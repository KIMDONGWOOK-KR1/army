import { describe, expect, it } from "vitest";
import {
  hash32,
  HOME_VARIANTS,
  SKIN_TONES,
  soldierVariant,
  VARIANT_RANGE,
} from "../components/soldier-variants";

// 같은 장병 모형 넷을 사람마다 조금씩 다르게 보이게 하는 값(soldier-variants.ts)을 본다.
describe("장병 모습 차이", () => {
  it("같은 식별자는 늘 같은 모습이다(네 사람의 폰이 같은 동료를 같게 본다)", () => {
    for (const id of ["a1b2", "동욱", "3f6c0e1d-9a1e-4c55-8f0a-0d6e1c2b9f11"])
      expect(soldierVariant(id)).toEqual(soldierVariant(id));
    expect(hash32("hoguk")).toBe(hash32("hoguk"));
    expect(hash32("a")).not.toBe(hash32("b"));
    // FNV-1a 알려진 값: 빈 문자열은 오프셋 기준값 그대로다
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
  });

  it("값은 정한 범위 안에 있다: 키·너비 ±4%, 피부색 넷, 서기 동작 시점·빠르기", () => {
    const r = VARIANT_RANGE;
    for (let i = 0; i < 2000; i++) {
      const v = soldierVariant(`member-${i}`);
      expect(Number.isInteger(v.skin)).toBe(true);
      expect(v.skin).toBeGreaterThanOrEqual(0);
      expect(v.skin).toBeLessThan(SKIN_TONES.length);
      for (const k of [v.height, v.width]) {
        expect(k).toBeGreaterThanOrEqual(1 - r.scale);
        expect(k).toBeLessThanOrEqual(1 + r.scale);
      }
      expect(v.phase).toBeGreaterThanOrEqual(0);
      expect(v.phase).toBeLessThanOrEqual(r.phase);
      expect(v.pace).toBeGreaterThanOrEqual(r.pace[0]);
      expect(v.pace).toBeLessThanOrEqual(r.pace[1]);
    }
  });

  it("여러 사람에게 고르게 퍼진다(피부색은 넷 다 나오고, 안경은 일부만 쓴다)", () => {
    const n = 4000,
      skins = new Array(SKIN_TONES.length).fill(0);
    let glasses = 0,
      tall = 0;
    for (let i = 0; i < n; i++) {
      const v = soldierVariant(`p${i}`);
      skins[v.skin]++;
      if (v.glasses) glasses++;
      if (v.height > 1) tall++;
    }
    for (const c of skins) expect(c / n).toBeGreaterThan(0.18);
    expect(glasses / n).toBeGreaterThan(VARIANT_RANGE.glasses - 0.05);
    expect(glasses / n).toBeLessThan(VARIANT_RANGE.glasses + 0.05);
    expect(tall / n).toBeGreaterThan(0.4);
    expect(tall / n).toBeLessThan(0.6);
  });

  it("비슷한 식별자도 서로 다른 모습이 나온다", () => {
    const seen = new Set(
      ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"].map((id) =>
        JSON.stringify(soldierVariant(id)),
      ),
    );
    expect(seen.size).toBe(8);
  });

  it("첫 화면 네 장병은 피부색이 모두 다르고 범위 안에 있다", () => {
    const list = Object.values(HOME_VARIANTS);
    expect(new Set(list.map((v) => v.skin)).size).toBe(4);
    expect(list.filter((v) => v.glasses).length).toBe(1);
    for (const v of list) {
      expect(Math.abs(v.height - 1)).toBeLessThanOrEqual(
        VARIANT_RANGE.scale + 1e-9,
      );
      expect(Math.abs(v.width - 1)).toBeLessThanOrEqual(
        VARIANT_RANGE.scale + 1e-9,
      );
    }
  });
});
