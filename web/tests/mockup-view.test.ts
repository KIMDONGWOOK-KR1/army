import { describe, expect, it } from "vitest";
import {
  CORNER,
  MOCKUP_ATTR,
  MOCKUP_GLOBAL,
  MOCKUP_KEY,
  MOCKUP_MESSAGE,
  MIN_H,
  MIN_W,
  PHONE,
  PHONE_FILL,
  PHONE_H,
  PHONE_W,
  fitsMockup,
  mockupBootScript,
  phoneScale,
  readMockupMessage,
  shellMode,
  withoutMockup,
} from "../components/mockup-view";

// 폰 목업 보기(mockup-view.ts)의 보기 결정·틀 주소·배율을 본다.
describe("보기 결정", () => {
  const base = { inFrame: false, param: null, stored: null, fits: true };

  it("아무 것도 없으면 지금 화면 그대로다", () => {
    expect(shellMode(base)).toBe("app");
  });

  it("저장된 선택은 창이 충분히 클 때만 목업으로 연다(저장값은 그대로 둔다)", () => {
    expect(shellMode({ ...base, stored: "on" })).toBe("mockup");
    expect(shellMode({ ...base, stored: "on", fits: false })).toBe("app");
    expect(shellMode({ ...base, stored: "off" })).toBe("app");
  });

  it("주소의 mockup=1/0이 저장값보다 앞서고, mockup=1은 창 크기와 상관없이 켠다", () => {
    expect(shellMode({ ...base, param: "1" })).toBe("mockup");
    expect(shellMode({ ...base, param: "1", fits: false })).toBe("mockup");
    expect(shellMode({ ...base, param: "0", stored: "on" })).toBe("app");
    expect(shellMode({ ...base, param: "yes", stored: "on" })).toBe("mockup");
  });

  it("목업 틀 안의 앱은 저장값·주소와 상관없이 그냥 앱이다(틀 안에 또 틀을 열지 않는다)", () => {
    expect(shellMode({ ...base, inFrame: true, stored: "on" })).toBe("frame");
    expect(shellMode({ ...base, inFrame: true, param: "1" })).toBe("frame");
  });
});

// layout의 인라인 스크립트를 가짜 창에서 돌려 본다
function boot({
  frame,
  param,
  stored,
  w,
  h,
  storageThrows = false,
}: {
  frame: "none" | "phone" | "other";
  param: string | null;
  stored: string | null;
  w: number;
  h: number;
  storageThrows?: boolean;
}) {
  const attrs = new Set<string>();
  const win: Record<string, unknown> = {
    frameElement:
      frame === "none"
        ? null
        : {
            hasAttribute: (n: string) =>
              frame === "phone" && n === "data-phone-screen",
          },
    location: { search: param === null ? "" : `?mockup=${param}&auto=1` },
    localStorage: {
      getItem: (k: string) => {
        if (storageThrows) throw new Error("blocked");
        return k === MOCKUP_KEY ? stored : null;
      },
    },
    innerWidth: w,
    innerHeight: h,
    document: {
      documentElement: { setAttribute: (n: string) => attrs.add(n) },
    },
  };
  new Function("window", "URLSearchParams", mockupBootScript())(
    win,
    URLSearchParams,
  );
  return { global: win[MOCKUP_GLOBAL] === 1, attr: attrs.has(MOCKUP_ATTR) };
}

describe("첫 그림 전 인라인 스크립트", () => {
  it("보기 결정(shellMode)과 똑같이 목업을 고른다", () => {
    for (const frame of ["none", "phone", "other"] as const)
      for (const param of [null, "1", "0", "yes"])
        for (const stored of [null, "on", "off"])
          for (const [w, h] of [
            [1440, 900],
            [390, 844],
            [844, 390],
            [MIN_W, MIN_H],
            [MIN_W - 1, MIN_H],
            [MIN_W, MIN_H - 1],
          ]) {
            const want =
              shellMode({
                inFrame: frame === "phone",
                param,
                stored,
                fits: fitsMockup(w, h),
              }) === "mockup";
            const got = boot({ frame, param, stored, w, h });
            expect(got, JSON.stringify({ frame, param, stored, w, h })).toEqual(
              { global: want, attr: want },
            );
          }
  });

  it("저장소를 못 읽어도 멈추지 않고, 주소의 mockup=1만 따른다", () => {
    const at = { frame: "none" as const, w: 1440, h: 900, storageThrows: true };
    expect(boot({ ...at, param: null, stored: "on" }).global).toBe(false);
    expect(boot({ ...at, param: "1", stored: null }).global).toBe(true);
  });
});

describe("목업을 고를 수 있는 창 크기", () => {
  it("폰은 세로·가로 모두 걸리고, 태블릿·노트북·발표 화면은 들어온다", () => {
    for (const [w, h] of [
      [360, 800],
      [390, 844],
      [430, 932],
      [844, 390],
      [932, 430],
    ])
      expect(fitsMockup(w, h)).toBe(false);
    for (const [w, h] of [
      [768, 1024],
      [1024, 768],
      [1280, 600],
      [1440, 900],
      [1920, 1080],
    ])
      expect(fitsMockup(w, h)).toBe(true);
    expect(fitsMockup(MIN_W, MIN_H)).toBe(true);
    expect(fitsMockup(MIN_W - 1, MIN_H)).toBe(false);
    expect(fitsMockup(MIN_W, MIN_H - 1)).toBe(false);
  });
});

describe("틀 안 iframe 주소", () => {
  it("mockup 값만 빼고 경로와 다른 값은 그대로 넘긴다", () => {
    expect(withoutMockup("/", "?mockup=1")).toBe("/");
    expect(withoutMockup("/", "?mockup=1&auto=1&3d=1")).toBe("/?auto=1&3d=1");
    expect(withoutMockup("/", "?auto=1&mockup=1&dev=1")).toBe("/?auto=1&dev=1");
    expect(withoutMockup("/", "")).toBe("/");
  });

  it("합류 경로(/j/코드)와 # 뒤도 지킨다", () => {
    expect(withoutMockup("/j/ABCD", "?mockup=1")).toBe("/j/ABCD");
    expect(withoutMockup("/j/ABCD", "?mockup=1&auto=1", "#main-content")).toBe(
      "/j/ABCD?auto=1#main-content",
    );
  });

  it("같은 이름이 여러 번 와도 모두 뺀다", () => {
    expect(withoutMockup("/", "?mockup=1&mockup=0&auto=1")).toBe("/?auto=1");
  });

  it("앞 빗금을 하나로 줄여 다른 출처 주소(//host)가 되지 않는다", () => {
    expect(withoutMockup("//evil.example/x", "?mockup=1")).toBe(
      "/evil.example/x",
    );
    expect(withoutMockup("///j/ABCD", "")).toBe("/j/ABCD");
  });
});

describe("폰 배율", () => {
  const size = (w: number, h: number) => {
    const s = phoneScale(w, h);
    return { s, pw: PHONE_W * s, ph: PHONE_H * s };
  };

  it("앱이 보는 화면은 390×844이고, 상태·홈 표시줄은 그 바깥에 더한다", () => {
    expect(PHONE_W).toBe(PHONE.screenW + PHONE.bezel * 2);
    expect(PHONE_H).toBe(
      PHONE.screenH + PHONE.status + PHONE.home + PHONE.bezel * 2,
    );
    expect([PHONE.screenW, PHONE.screenH]).toEqual([390, 844]);
  });

  it("가로로 넓은 발표 화면에서는 창 높이의 88%를 채운다", () => {
    for (const [w, h] of [
      [1440, 900],
      [1280, 720],
      [1366, 650],
    ]) {
      const { ph } = size(w, h);
      expect(ph / h).toBeCloseTo(PHONE_FILL, 5);
    }
  });

  it("큰 화면에서도 1배보다 키우지 않는다(틀 안 입체 장면이 흐려지지 않게)", () => {
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ])
      expect(phoneScale(w, h)).toBe(1);
    expect(phoneScale(1920, 1060)).toBeLessThan(1);
  });

  it("어느 창에서도 폰이 창 밖으로 나가지 않고, 위 모서리 표식과 겹치지 않는다", () => {
    for (let w = MIN_W; w <= 2560; w += 37)
      for (let h = MIN_H; h <= 1600; h += 41) {
        const { pw, ph } = size(w, h);
        expect(pw).toBeLessThanOrEqual(w);
        expect(ph).toBeLessThanOrEqual(h);
        const besides = (w - pw) / 2 >= CORNER.w - 1e-9,
          below = (h - ph) / 2 >= CORNER.h - 1e-9;
        expect(besides || below).toBe(true);
      }
  });

  it("세로 태블릿(768×1024)에서는 표식 띠를 비우고도 창 높이의 85% 안팎이다", () => {
    const { ph } = size(768, 1024);
    expect(ph / 1024).toBeGreaterThan(0.82);
    expect(ph / 1024).toBeLessThanOrEqual(PHONE_FILL);
  });
});

describe("틀 안 앱이 보내는 메시지", () => {
  it("약속한 모양만 읽는다", () => {
    expect(readMockupMessage({ type: MOCKUP_MESSAGE, action: "exit" })).toBe(
      "exit",
    );
    expect(
      readMockupMessage({ type: MOCKUP_MESSAGE, action: "fullscreen" }),
    ).toBe("fullscreen");
    expect(readMockupMessage({ type: MOCKUP_MESSAGE, action: "dim" })).toBe(
      "dim",
    );
    expect(readMockupMessage({ type: MOCKUP_MESSAGE, action: "undim" })).toBe(
      "undim",
    );
    expect(readMockupMessage({ type: MOCKUP_MESSAGE, action: "eval" })).toBe(
      null,
    );
    expect(readMockupMessage({ type: MOCKUP_MESSAGE, action: 1 })).toBe(null);
    expect(readMockupMessage({ type: "other", action: "exit" })).toBe(null);
    expect(readMockupMessage("exit")).toBe(null);
    expect(readMockupMessage(null)).toBe(null);
  });
});
