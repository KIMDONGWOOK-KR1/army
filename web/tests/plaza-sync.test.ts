import { expect,it } from "vitest";
import { NextRequest } from "next/server";
import { PlazaPeers,validFrame,type PlazaFrame,type PlazaWire } from "../lib/plaza-protocol";
import { createPlazaRooms } from "../lib/server/plaza-room";
import { plazaHttp } from "../lib/server/plaza-http";
const frame=(member="a",seq=1,session="connection-a",at=1000):PlazaFrame=>({v:1,member,seq,session,at,pose:{x:0,z:15,heading:0,moving:false,dancing:true,beat:2,salute:null}});
it("delivers a player's dance and salute across clients only inside the same team",()=>{
 const rooms=createPlazaRooms(),a:PlazaWire[]=[],b:PlazaWire[]=[],other:PlazaWire[]=[];
 const leave=rooms.join("team","a","connection-a",v=>a.push(v));rooms.join("team","b","connection-b",v=>b.push(v));rooms.join("another","c","connection-c",v=>other.push(v));
 expect(rooms.publish("team","a",frame())).toBe(true);expect(b.at(-1)).toMatchObject({member:"a",pose:{dancing:true}});expect(other).toEqual([]);
 const salute=frame("a",2);salute.pose.salute={id:"salute-1",at:Date.now()};
 expect(rooms.publish("team","a",salute,Date.now()+200)).toBe(true);expect(b.at(-1)).toMatchObject({pose:{salute:{id:"salute-1"}}});
 expect(rooms.publish("team","b",frame("a",3))).toBe(false);leave();expect(b.at(-1)).toEqual({leave:"a",session:"connection-a"});
});
it("ignores duplicates, retired connections, outsiders and expired peers",()=>{
 const peers=new PlazaPeers("me",new Set(["me","a"]));
 expect(peers.accept(frame(),0)).toBe(true);expect(peers.accept(frame(),50)).toBe(false);
 expect(peers.accept(frame("outsider"),50)).toBe(false);expect(peers.accept(frame("me"),50)).toBe(false);
 expect(peers.accept(frame("a",1,"new",2000),100)).toBe(true);
 peers.leave("a","connection-a");expect(peers.frames.size).toBe(1);
 expect(peers.accept(frame("a",9,"connection-a",3000),200)).toBe(false);
 peers.prune(8000);expect(peers.frames.size).toBe(0);
});
it("rejects malformed motion, nonfinite values and positions outside the virtual plaza",()=>{
 expect(validFrame(frame())).toBe(true);expect(validFrame({...frame(),pose:{...frame().pose,x:1000}})).toBe(false);
 expect(validFrame({...frame(),pose:{...frame().pose,beat:NaN}})).toBe(false);expect(validFrame({member:"a"})).toBe(false);
});
it("streams immediately, enforces identity and origin, and cleans up on disconnect",async()=>{
 const controller=new AbortController();const game="test-"+crypto.randomUUID();
 const url=`http://localhost/api/plaza?game=${game}&client=connection-a`;
 const identity=async()=>({game,member:"a"});
 const stream=await plazaHttp(new NextRequest(url,{signal:controller.signal}),identity);
 expect(stream.headers.get("content-type")).toBe("text/event-stream");
 const reader=stream.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain("connected");
 const post=(value:unknown,origin?:string)=>plazaHttp(new NextRequest(url,{method:"POST",headers:{"content-type":"application/json",host:"localhost",...(origin?{origin}:{})},body:JSON.stringify(value)}),identity);
 expect((await post(frame())).status).toBe(204);expect(new TextDecoder().decode((await reader.read()).value)).toContain('"dancing":true');
 expect((await post(frame("b"))).status).toBe(400);expect((await post(frame(),"http://evil.test")).status).toBe(403);
 controller.abort();expect((await reader.read()).done).toBe(true);
 expect((await plazaHttp(new NextRequest(url),async()=>{throw new Error();})).status).toBe(403);
});
