import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlazaAudio } from "@/components/bongji-sound";
const settings = vi.hoisted(() => ({ muted: false, mix: { music: .5, effects: .7 }, listeners: new Set<() => void>(), acquire: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/sound", () => ({ getAudioMix: () => settings.mix, isMuted: () => settings.muted, acquireBgmSilence: settings.acquire, subscribeMuted: (fn: () => void) => { settings.listeners.add(fn); return () => settings.listeners.delete(fn); } }));
vi.mock("@/lib/sound-files", () => ({ isWebKitAudio: () => false }));
class Gain {
  gain = { value: 0, setTargetAtTime: vi.fn((n: number) => { this.gain.value = n; }), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn((n: number) => { this.gain.value = n; }), linearRampToValueAtTime: vi.fn((n: number) => { this.gain.value = n; }) };
  connect = vi.fn(() => this); disconnect = vi.fn();
}
class Source { buffer: { name: string } | null = null; loop = false; connect = vi.fn((node: Gain) => node); start = vi.fn((..._args: number[]) => undefined); stop = vi.fn((..._args: number[]) => undefined); }
let gains: Gain[], sources: Source[], downloads: Map<string,(v: unknown) => void>;
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
async function downloaded(name = "hoguk-bongji-afternoon") {
  const resolve = downloads.get(`/sound/${name}.mp3`); expect(resolve).toBeDefined();
  resolve!({ ok: true, arrayBuffer: async () => ({ name, duration: name.endsWith("house") ? 64 : 76.8 }) }); await flush();
}
beforeEach(() => {
  gains=[]; sources=[]; downloads=new Map(); settings.muted=false; settings.mix={music:.5,effects:.7}; settings.listeners.clear();
  settings.acquire.mockReset().mockReturnValue(settings.release); settings.release.mockReset();
  class Context {
    currentTime=10; state="running"; destination={};
    createGain(){const g=new Gain();gains.push(g);return g;}
    createBufferSource(){const s=new Source();sources.push(s);return s;}
    decodeAudioData(data: unknown, done: (d: unknown)=>void){done(data);}
    resume=vi.fn(async()=>undefined);close=vi.fn(async()=>undefined);
  }
  vi.stubGlobal("window",{AudioContext:Context,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("navigator",{userAgent:"test"});
  vi.stubGlobal("fetch",vi.fn((url:string)=>new Promise(r=>downloads.set(url,r))));
});
afterEach(()=>vi.unstubAllGlobals());
describe("봉지 구역 음악과 소유권",()=>{
  it("반복 입장·터치에도 곡 하나만 로드하고 한 번 재생한다",async()=>{
    const a=createPlazaAudio()!; a.enter();a.enter(); await downloaded();a.enter(); await flush();
    expect([...downloads.keys()]).toEqual(["/sound/hoguk-bongji-afternoon.mp3", "/sound/hoguk-bongji-afternoon-house.mp3"]);
    expect(sources).toHaveLength(1);expect(a.ready).toBe(true);expect(settings.acquire).toHaveBeenCalledOnce();a.dispose();
  });
  it("다운로드 실패 뒤 같은 곡을 다시 요청한다",async()=>{
    const a=createPlazaAudio()!;a.enter();downloads.get("/sound/hoguk-bongji-afternoon.mp3")!({ok:false});await flush();
    expect(a.failed).toBe(true);a.enter();await downloaded();expect(a.ready).toBe(true);expect(a.failed).toBe(false);a.dispose();
  });
  it("떠난 뒤 로딩을 마친 곡과 효과음은 시작하지 않는다",async()=>{
    const a=createPlazaAudio()!;a.enter();a.play("shutter");a.dispose();await downloaded();await downloaded("hoguk-bongji-shutter");
    expect(sources).toHaveLength(0);expect(settings.release).toHaveBeenCalledOnce();expect(settings.listeners.size).toBe(0);
  });
  it("전역 음악을 복귀시키기 전에 로컬 루프를 멈추고 반복 정리는 무시한다",async()=>{
    const a=createPlazaAudio()!;a.enter();await downloaded();
    settings.release.mockImplementation(()=>expect(sources[0].stop).toHaveBeenCalledOnce());a.dispose();a.dispose();expect(settings.release).toHaveBeenCalledOnce();
  });
  it("음량 변경·음소거·화면 덮개를 함께 지킨다",()=>{
    const a=createPlazaAudio()!;a.cover(true); settings.mix={music:.2,effects:.3};settings.listeners.forEach(f=>f());
    expect(gains[0].gain.value).toBe(0);expect(gains[1].gain.value).toBeCloseTo(.16);expect(gains[2].gain.value).toBe(.3);
    settings.muted=true;a.cover(false);expect(gains[0].gain.value).toBe(0);settings.muted=false;settings.listeners.forEach(f=>f());expect(gains[0].gain.value).toBe(1);a.dispose();
  });
});

it("석상에 가면 원곡이 멈춘 시점에 리믹스가 시작한다",async()=>{
 const a=createPlazaAudio()!;a.enter();await downloaded();a.setZone("statue");await downloaded("hoguk-bongji-afternoon-house");
 expect(sources).toHaveLength(2);expect(a.zone).toBe("statue");
 expect(sources[0].stop.mock.calls[0][0]).toBe(sources[1].start.mock.calls[0][0]);
 a.dispose();
});
it("다운로드 중 연못으로 돌아오면 늦은 리믹스가 재생되지 않는다",async()=>{
 const a=createPlazaAudio()!;a.enter();await downloaded();a.setZone("statue");a.setZone("pond");await downloaded("hoguk-bongji-afternoon-house");
 expect(sources).toHaveLength(1);expect(a.zone).toBe("pond");a.dispose();
});
it("리믹스 실패 중 원곡은 유지하고 다음 터치에서 재시도한다",async()=>{
 const a=createPlazaAudio()!;a.enter();await downloaded();a.setZone("statue");downloads.get("/sound/hoguk-bongji-afternoon-house.mp3")!({ok:false});await flush();
 expect(a.failed).toBe(true);expect(a.zone).toBe("pond");a.enter();await downloaded("hoguk-bongji-afternoon-house");expect(a.zone).toBe("statue");a.dispose();
});
it("회고를 쓰는 동안 두 편곡 모두 같은 낮은 음량을 적용한다",()=>{
 const a=createPlazaAudio()!;a.hush(true);expect(gains[1].gain.value).toBeCloseTo(.16);settings.mix.music=.8;settings.listeners.forEach(f=>f());expect(gains[1].gain.value).toBeCloseTo(.256);a.hush(false);expect(gains[1].gain.value).toBeCloseTo(.64);a.dispose();
});
