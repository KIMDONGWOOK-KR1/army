import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>vi.unstubAllGlobals());
it("다른 탭이 재생권을 가져가면 양보하고 숨긴 화면은 재생하지 않는다",async()=>{
 vi.resetModules();
 const win=new EventTarget(), doc=Object.assign(new EventTarget(),{hidden:false});
 let channel: {onmessage: ((e:{data:string})=>void)|null;postMessage:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>};
 class Channel {onmessage=null;postMessage=vi.fn();close=vi.fn();constructor(){channel=this;}}
 vi.stubGlobal("window",Object.assign(win,{BroadcastChannel:Channel}));vi.stubGlobal("document",doc);
 const a=await import("../lib/audio-focus");const changed=vi.fn();const release=a.subscribeAudioFocus(changed);
 expect(a.isAudioForeground()).toBe(true);
 channel!.onmessage!({data:"claim"});expect(a.isAudioForeground()).toBe(false);
 win.dispatchEvent(new Event("focus"));expect(a.isAudioForeground()).toBe(true);
 doc.hidden=true;doc.dispatchEvent(new Event("visibilitychange"));expect(a.isAudioForeground()).toBe(false);
 win.dispatchEvent(new Event("focus"));expect(a.isAudioForeground()).toBe(false);
 doc.hidden=false;doc.dispatchEvent(new Event("visibilitychange"));expect(a.isAudioForeground()).toBe(true);
 release();expect(channel!.close).toHaveBeenCalledOnce();expect(changed).toHaveBeenCalled();
});
