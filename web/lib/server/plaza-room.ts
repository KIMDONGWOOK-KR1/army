import { validFrame, type PlazaFrame, type PlazaWire } from "../plaza-protocol";
type Subscriber={member:string;session:string;send:(value:PlazaWire)=>void};
export function createPlazaRooms(){
  const rooms=new Map<string,{states:Map<string,PlazaFrame>;listeners:Set<Subscriber>}>();
  const room=(id:string)=>{let r=rooms.get(id);if(!r){r={states:new Map(),listeners:new Set()};rooms.set(id,r);}return r;};
  const emit=(r:ReturnType<typeof room>,wire:PlazaWire)=>{for(const s of r.listeners)s.send(wire);};
  return {
    join(game:string,member:string,session:string,send:Subscriber["send"]){
      const r=room(game),s={member,session,send};r.listeners.add(s);
      for(const f of r.states.values())if(Date.now()-f.at<7000)send(f);
      return()=>{r.listeners.delete(s);if(r.states.get(member)?.session===session){r.states.delete(member);emit(r,{leave:member,session});}if(!r.listeners.size)rooms.delete(game);};
    },
    publish(game:string,member:string,value:unknown,now=Date.now()){
      if(!validFrame(value)||value.member!==member)return false;
      const r=rooms.get(game);if(!r||![...r.listeners].some(s=>s.member===member&&s.session===value.session))return false;
      const previous=r.states.get(member);
      if(previous?.session===value.session&&value.seq<=previous.seq)return false;
      const f={...value,at:now};r.states.set(member,f);emit(r,f);return true;
    },
  };
}
const scope=globalThis as typeof globalThis&{hogukPlazaRooms?:ReturnType<typeof createPlazaRooms>};
export const plazaRooms=scope.hogukPlazaRooms??=createPlazaRooms();
