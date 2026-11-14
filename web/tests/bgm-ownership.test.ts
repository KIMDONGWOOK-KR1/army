import { afterEach, beforeEach, expect, it, vi } from "vitest";
const deck = vi.hoisted(()=>({set:vi.fn((_mood: unknown, ..._args: unknown[])=>false),tick:vi.fn(),busy:false}));
const files = vi.hoisted(()=>({set:vi.fn()}));
vi.mock("../lib/sound-synth", async importOriginal => {
  const actual=await importOriginal<typeof import("../lib/sound-synth")>();
  return {...actual,createBgmDeck:()=>deck,buildChain:(ctx:AudioContext)=>({master:ctx.createGain(),bgm:ctx.createGain(),sfx:{ui:ctx.createGain(),music:ctx.createGain()}})};
});
vi.mock("../lib/sound-files",async importOriginal=>({...await importOriginal<typeof import("../lib/sound-files")>(),createFileDeck:()=>files,fetchTrack:vi.fn(async()=>null)}));
let nodes: {gain:{value:number}}[];
beforeEach(()=>{
 vi.resetModules();deck.set.mockClear();files.set.mockClear();nodes=[];
 class Context {
  currentTime=0;state="running";destination={};
  createGain(){const node={gain:{value:1,cancelScheduledValues:vi.fn(),setTargetAtTime:(v:number)=>{node.gain.value=v;}},connect:vi.fn()};nodes.push(node);return node;}
  createBuffer(){return {};};createBufferSource(){return {connect:vi.fn(),start:vi.fn()};}
 }
 vi.stubGlobal("window",{AudioContext:Context,localStorage:{getItem:()=>null,setItem:vi.fn()},dispatchEvent:vi.fn(),setTimeout:vi.fn()});
 vi.stubGlobal("navigator",{userActivation:{hasBeenActive:true,isActive:true}});
});
afterEach(()=>vi.unstubAllGlobals());
it("봉지가 열린 동안 파일과 합성 배경음이 모두 정지하고 나레이션·설정 변경도 되살리지 못한다",async()=>{
 const e=await import("../lib/sound");e.unlock();e.startBgm("home","08");const release=e.acquireBgmSilence();
 expect(files.set).toHaveBeenLastCalledWith(null);expect(deck.set.mock.calls.at(-1)?.[0]).toBeNull();
 e.setFileDuck(1);e.setFileLevel(1);e.setBgmLevel(1);e.setAudioMix({music:1});e.startBgm("field");
 expect(nodes[1].gain.value).toBe(0);expect(nodes[4].gain.value).toBe(0);expect(deck.set.mock.calls.at(-1)?.[0]).toBeNull();
 release();expect(deck.set.mock.calls.at(-1)?.[0]).toBe("field");expect(nodes[1].gain.value).toBe(1);
});
it("중복 마운트에서 이전 소유자가 떠나도 새 봉지 음악과 전역곡이 겹치지 않는다",async()=>{
 const e=await import("../lib/sound");const first=e.acquireBgmSilence();e.unlock();const next=e.acquireBgmSilence();e.startBgm("home","08");first();first();
 expect(files.set).toHaveBeenLastCalledWith(null);expect(nodes[4].gain.value).toBe(0);next();expect(files.set).toHaveBeenLastCalledWith("08");
});
