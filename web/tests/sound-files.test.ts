import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORIAL_SOUND, MISSION_SOUND, NEXT, RETRY_SECONDS, TRACKS, createFileDeck, fileFor, isWebKitAudio, loopEndFor, trackForScene } from "../lib/sound-files";

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
    expect(loopEndFor("01", 73.662)).toBe(73.632);
    expect(loopEndFor("03", 87.6)).toBe(87.6);
  });
  it("소수점 반올림 차이(5ms 안쪽)면 표본을 자르지 않고 디코딩 길이 그대로 돈다", () => {
    // 봉지 08은 새 마당 곡으로 통일. 5ms 이내 디코딩 차이는 유지한다.
    expect(loopEndFor("08", 76.80002)).toBe(76.80002);
    expect(loopEndFor("03", 4209152 / 48000)).toBe(4209152 / 48000);
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
    expect(fileFor("02", iphoneSafari)).toBe("hoguk-02-role-reveal.mp3");
    expect(fileFor("03", android)).toBe("hoguk-03-walk.mp3");
  });
});

describe("장면별 곡", () => {
  it("첫 화면·대기실·보직·장비는 01", () => {
    for (const scene of ["title", "enroll", "lobby", "briefing", "equip"]) expect(trackForScene({ scene })).toBe("01");
  });
  it("이동은 03, 추모 구역으로 다가가는 길은 05", () => {
    expect(trackForScene({ scene: "travel" })).toBe("03");
    expect(trackForScene({ scene: "travel", hushed: true })).toBe(MEMORIAL_SOUND ? "05" : null);
  });
  it("미션·자물쇠는 04(문제 풀이 바탕음, MISSION_SOUND), 정문 도착 뒤·추모의 벽·묵념은 05, 봉지는 08", () => {
    for (const scene of ["mission", "report", "waiting", "lock"]) {
      expect(trackForScene({ scene })).toBe(MISSION_SOUND ? "04" : null);
      expect(trackForScene({ scene, reverent: true })).toBe(MEMORIAL_SOUND ? "05" : null);
      expect(trackForScene({ scene, epilogue: true })).toBe("08");
    }
    expect(trackForScene({ scene: "memorial" })).toBe("10");
    expect(fileFor("10", "AppleWebKit/605.1.15 Version/18.0 Safari/604.1")).toBe("hoguk-memorial-remembrance.wav");
    expect(trackForScene({ scene: "memorial", final: true })).toBeNull();
  });
  it("최종 결과에는 반복 곡이 없다(09만 한 번)", () => {
    expect(trackForScene({ scene: "done", final: true })).toBeNull();
  });
});

describe("못 받은 반복 곡", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  // 오디오 노드 흉내(소리는 내지 않고 시작된 곡만 센다)
  const fakeCtx = () => {
    const started: number[] = [];
    const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
    const node = () => ({ connect: (n: unknown) => n, gain: param(), frequency: param(), type: "" });
    const ctx = {
      currentTime: 0,
      createGain: node,
      createBiquadFilter: node,
      createBufferSource: () => ({ ...node(), buffer: null as { duration: number } | null, loop: false, loopStart: 0, loopEnd: 0,
        start() { started.push(this.buffer!.duration); }, stop() {} }),
      decodeAudioData: (_: ArrayBuffer, ok: (b: unknown) => void) => ok({ duration: 87.690667 }),
    };
    return { ctx: ctx as unknown as BaseAudioContext, started };
  };
  it("한 번 실패해도 버리지 않고 잠시 뒤 다시 받아 튼다(예전 합성 배경음으로 바꾸지 않는다)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("navigator", { userAgent: "test" });
    let walk = 0;
    vi.stubGlobal("fetch", async (url: string) =>
      (url.includes("walk") && ++walk === 1 ? { ok: false } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const { ctx, started } = fakeCtx();
    const fails: string[] = [];
    const deck = createFileDeck(ctx, {} as AudioNode, { onFail: (t) => fails.push(t) });
    deck.set("03");
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([]);
    expect(deck.failed("03")).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_SECONDS[0] * 1000);
    expect(started).toEqual([87.690667]);
    expect(fails).toEqual([]);
  });
});


it("빠르게 장면을 바꿔도 이전 반복곡이 정지하기 전에 다음 곡을 시작하지 않는다", async()=>{
 vi.stubGlobal("window",globalThis);vi.stubGlobal("navigator",{userAgent:"test"});
 vi.stubGlobal("fetch",async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}));
 const sources:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
 const param=()=>({value:1,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn(),setTargetAtTime:vi.fn()});
 const node=()=>({connect:(n:unknown)=>n,gain:param(),frequency:param()});
 const ctx={currentTime:0,createGain:node,createBiquadFilter:node,createBufferSource:()=>{const src={...node(),start:vi.fn(),stop:vi.fn()};sources.push(src);return src;},decodeAudioData:(_:unknown,ok:(b:unknown)=>void)=>ok({duration:100})};
 const deck=createFileDeck(ctx as unknown as BaseAudioContext,{} as AudioNode);
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 try {
 deck.set("01");await flush();ctx.currentTime=2;deck.set("03");await flush();
 expect(sources.length).toBe(2);expect(sources[1].start.mock.calls[0][0]).toBeGreaterThanOrEqual(sources[0].stop.mock.calls[0][0]);
 ctx.currentTime=2.05;deck.set("04");await flush();
 expect(sources.length).toBe(3);expect(sources[2].start.mock.calls[0][0]).toBeGreaterThanOrEqual(sources[1].stop.mock.calls[0][0]);
 } finally {vi.unstubAllGlobals();}
});
