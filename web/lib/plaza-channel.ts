import type { RealtimeChannel } from "@supabase/supabase-js";
import type { PlazaFrame, PlazaWire } from "./plaza-protocol";
type Listener = (packet: PlazaWire) => void;
type Hub = { listeners: Set<Listener>; send?: (packet: PlazaFrame) => void; ready: boolean };
const hubs = new Map<string,Hub>();
export function plazaChannel(game: string) {
  let h=hubs.get(game);
  if(!h) { h={listeners:new Set(),ready:false};hubs.set(game,h); }
  return h;
}
/** Share useGame's already-authorized private game channel, never subscribe twice. */
export function bindPlazaChannel(game: string, channel: RealtimeChannel) {
  const hub=plazaChannel(game);
  const send=(packet:PlazaFrame)=>{if(hub.ready)void channel.send({type:"broadcast",event:"plaza-pose",payload:packet});};
  hub.send=send;
  channel.on("broadcast",{event:"plaza-pose"},({payload})=>hub.listeners.forEach(fn=>fn(payload)));
  return {
    ready(on:boolean){hub.ready=on;},
    close(){if(hub.send===send){hub.ready=false;delete hub.send;}if(!hub.listeners.size)hubs.delete(game);},
  };
}
