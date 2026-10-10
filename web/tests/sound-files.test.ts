import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEXT, TRACKS, fileFor, isWebKitAudio, loopEndFor, trackForScene } from "../lib/sound-files";

describe("음원 표", () => {
  it("public/sound/manifest.json과 같다", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/sound/manifest.json", import.meta.url), "utf8"));
    for (const [id, t] of Object.entries(TRACKS)) {
      expect(manifest.tracks[id]).toMatchObject({ file: t.file, seconds: t.seconds, loop: t.loop });
      expect(!!manifest.tracks[id].webkitWav).toBe("webkitWav" in t);
      if ("webkitWav" in t) expect(manifest.tracks[id].webkitWav).toBe(t.file.replace(".mp3", ".wav"));
    }
    expect(Object.keys(manifest.tracks).sort()).toEqual(Object.keys(TRACKS).sort());
  });
  it("반복 끝점은 manifest 길이, 디코딩이 더 짧으면 디코딩 길이", () => {
    expect(loopEndFor("01", 80.026)).toBe(80);
    expect(loopEndFor("03", 95.99)).toBe(95.99);
  });
  it("다음 단계 곡 목록에는 있는 곡만", () => {
    for (const list of Object.values(NEXT)) for (const t of list) expect(TRACKS[t]).toBeDefined();
  });
});

describe("웹킷에서만 WAV", () => {
  const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const iphoneChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
  it("아이폰(사파리·크롬)은 웹킷, 안드로이드 크롬은 아니다", () => {
    expect(isWebKitAudio(iphoneSafari)).toBe(true);
    expect(isWebKitAudio(iphoneChrome)).toBe(true);
    expect(isWebKitAudio(android)).toBe(false);
  });
  it("틈이 생기는 반복 곡만 WAV로 바꿔 받는다", () => {
    expect(fileFor("03", iphoneSafari)).toBe("hoguk-03-walk.wav");
    expect(fileFor("04", iphoneSafari)).toBe("hoguk-04-mission.mp3");
    expect(fileFor("03", android)).toBe("hoguk-03-walk.mp3");
  });
});

describe("장면별 곡", () => {
  it("첫 화면·대기실·보직·장비는 01", () => {
    for (const scene of ["title", "enroll", "lobby", "briefing", "equip"]) expect(trackForScene({ scene })).toBe("01");
  });
  it("이동은 03, 추모 구역으로 다가가는 길은 05", () => {
    expect(trackForScene({ scene: "travel" })).toBe("03");
    expect(trackForScene({ scene: "travel", hushed: true })).toBe("05");
  });
  it("용봉관 미션·자물쇠는 04, 정문 도착 뒤·추모의 벽·묵념은 05, 봉지는 08", () => {
    for (const scene of ["mission", "report", "waiting", "lock"]) {
      expect(trackForScene({ scene })).toBe("04");
      expect(trackForScene({ scene, reverent: true })).toBe("05");
      expect(trackForScene({ scene, epilogue: true })).toBe("08");
    }
    expect(trackForScene({ scene: "memorial" })).toBe("05");
  });
  it("최종 결과에는 반복 곡이 없다(09만 한 번)", () => {
    expect(trackForScene({ scene: "done", final: true })).toBeNull();
  });
});
