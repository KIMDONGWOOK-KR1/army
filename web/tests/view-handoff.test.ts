import { describe, expect, it } from "vitest";
import {
  HANDOFF_KEY,
  SWITCH_KEY,
  SWITCH_TTL,
  handoffPane,
  markViewSwitch,
  saveHandoff,
  takeHandoff,
  type Handoff,
} from "../components/view-handoff";

// 폰 목업 보기를 켜고 끌 때 넘기는 화면 상태(view-handoff.ts)
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const state: Handoff = {
  game: "g1",
  site: "yongbong",
  role: "commander",
  auto: true,
  rehearsed: "g1",
  rehearsal: { game: "g1", step: "briefing", count: 4 },
  pane: "lock",
  lock: { scope: '["g1"]', digits: ["3", "4", "", ""] },
};

describe("보기를 바꿀 때 넘기는 상태", () => {
  it("보기를 바꾼 직후 한 번만 넘겨받고, 표시는 바로 지운다", () => {
    const store = memory();
    saveHandoff(state, store);
    markViewSwitch(1000, store);
    expect(takeHandoff(1500, store)).toEqual(state);
    expect(store.data.has(SWITCH_KEY)).toBe(false);
    // 같은 탭에서 그냥 새로 고침하면 넘겨받지 않는다
    expect(takeHandoff(1600, store)).toBe(null);
  });

  it("보기를 바꾸지 않았으면 적어 둔 상태가 있어도 읽지 않는다", () => {
    const store = memory();
    saveHandoff(state, store);
    expect(takeHandoff(1000, store)).toBe(null);
  });

  it("오래된 표시(틀이 끝내 뜨지 않은 경우)는 버린다", () => {
    const store = memory();
    saveHandoff(state, store);
    markViewSwitch(1000, store);
    expect(takeHandoff(1000 + SWITCH_TTL + 1, store)).toBe(null);
    expect(store.data.has(SWITCH_KEY)).toBe(false);
  });

  it("모양이 틀린 값은 버리거나 기본값으로 읽는다", () => {
    const store = memory();
    markViewSwitch(1, store);
    store.setItem(HANDOFF_KEY, "{not json");
    expect(takeHandoff(2, store)).toBe(null);
    markViewSwitch(1, store);
    store.setItem(HANDOFF_KEY, JSON.stringify({ auto: "yes" }));
    expect(takeHandoff(2, store)).toBe(null);
    markViewSwitch(1, store);
    store.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        ...state,
        pane: "admin",
        lock: { scope: 1, digits: [] },
        rehearsal: { game: "g1", step: "done", count: 0 },
      }),
    );
    expect(takeHandoff(2, store)).toMatchObject({
      pane: "report",
      lock: null,
      rehearsal: null,
      auto: true,
    });
  });

  it("저장소를 쓸 수 없어도 멈추지 않는다", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => saveHandoff(state, broken)).not.toThrow();
    expect(() => markViewSwitch(1, broken)).not.toThrow();
    expect(takeHandoff(2, broken)).toBe(null);
  });

  it("보고/자물쇠 화면은 같은 작전·거점·보직일 때만 다시 연다", () => {
    const at = { game: "g1", site: "yongbong", role: "commander" };
    expect(handoffPane(state, at)).toBe("lock");
    expect(handoffPane(state, { ...at, site: "gate" })).toBe(null);
    expect(handoffPane(state, { ...at, role: "scout" })).toBe(null);
    expect(handoffPane(state, { ...at, game: "g2" })).toBe(null);
    expect(handoffPane(null, at)).toBe(null);
    expect(handoffPane(state, null)).toBe(null);
  });
});
