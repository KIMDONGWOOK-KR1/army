"use client";
import { useEffect, useRef, useState } from "react";
import { backend, soloFor } from "@/lib/client";
import { plazaChannel } from "@/lib/plaza-channel";
import { PlazaPeers, type PlazaFrame, type PlazaPose, type PlazaWire } from "@/lib/plaza-protocol";
export type PlazaRoom = { gameId: string; selfId: string; memberIds: string[]; serverNow?: number; previewSeat?: number };
export function usePlazaSync(room?: PlazaRoom) {
  const peers=useRef(new PlazaPeers("",new Set()));
  const send=useRef<((pose:PlazaPose)=>void)|null>(null);
  const [connected,setConnected]=useState(false),[online,setOnline]=useState<string[]>([]);
  const offset=useRef(0);
  useEffect(()=>{
    if(!room)return;
    offset.current=room.serverNow ? room.serverNow-Date.now() : 0;
    const cache=new PlazaPeers(room.selfId,new Set(room.memberIds));peers.current=cache;
    const session=crypto.randomUUID();let seq=0,lastSent=0,lastSignature="",lastAction="",last:PlazaPose|null=null,gone=false;
    let localReady=false,pending:PlazaFrame|null=null,posting=false;
    const receive=(wire:PlazaWire)=>{
      if(!wire || typeof wire!=="object")return;
      if("leave" in wire)cache.leave(wire.leave,wire.session);else cache.accept(wire,performance.now());
    };
    const local=room.previewSeat!==undefined||backend==="local";
    const hub=plazaChannel(room.gameId);
    const solo=soloFor(room.gameId);
    const query=new URLSearchParams({game:room.gameId,client:session,...(room.previewSeat!==undefined?{seat:String(room.previewSeat)}:solo?{seat:String(solo.seats[solo.role])}:{})});
    const url=`${room.previewSeat!==undefined?"/api/dev/plaza":"/api/plaza"}?${query}`;
    const drain=async()=>{
      if(posting||gone)return;posting=true;
      while(pending&&!gone){
        const f=pending;pending=null;
        try{
          const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(f),credentials:"same-origin",cache:"no-store"});
          if(!r.ok)throw new Error();
          if(!gone)setConnected(true);
        }catch{setConnected(false);break;}
      }
      posting=false;
    };
    const publish=(pose:PlazaPose,force=false)=>{
      last=pose;const now=performance.now();
      const signature=JSON.stringify(pose),action=`${pose.dancing}:${pose.salute?.id??""}:${pose.moving}`;
      if(!force && action===lastAction && (now-lastSent<180 || (signature===lastSignature&&now-lastSent<1800)))return;
      if(local?!localReady:!hub.ready)return;
      lastSent=now;lastSignature=signature;lastAction=action;
      const f:PlazaFrame={v:1,member:room.selfId,session,seq:++seq,at:Date.now()+offset.current,pose};
      if(local){pending=f;void drain();}else hub.send?.(f);
    };
    send.current=publish;
    let stream:EventSource|undefined;
    if(local){
      stream=new EventSource(url);
      stream.onopen=()=>{localReady=true;setConnected(true);if(last)publish(last,true);};
      stream.onerror=()=>{localReady=false;setConnected(false);cache.frames.clear();};
      stream.onmessage=e=>{try{receive(JSON.parse(e.data));}catch{}};
    }else hub.listeners.add(receive);
    const heartbeat=setInterval(()=>{
      cache.prune(performance.now());
      setOnline(previous=>{const next=[...cache.frames.keys()].sort();return previous.join()===next.join()?previous:next;});
      if(!local)setConnected(hub.ready);
      if(last && !document.hidden)publish(last);
    },500);
    const visibility=()=>{
      if(!last)return;
      if(document.hidden)publish({...last,moving:false,dancing:false,salute:null},true);
      else publish(last,true);
    };
    document.addEventListener("visibilitychange",visibility);
    return()=>{
      if(last)publish({...last,moving:false,dancing:false,salute:null},true);
      gone=true;send.current=null;clearInterval(heartbeat);stream?.close();hub.listeners.delete(receive);cache.frames.clear();
      document.removeEventListener("visibilitychange",visibility);
    };
  // Roster stays stable after roles are assigned; snapshots must not restart the link.
  },[room?.gameId,room?.selfId,room?.previewSeat]);
  return {peers,send,connected,online,clock:()=>Date.now()+offset.current};
}
