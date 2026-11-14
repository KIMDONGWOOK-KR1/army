"use client";
import { useEffect, useState } from "react";
import { BongjiPlaza, demoPlazaMembers } from "@/components/bongji-plaza";
import type { SharedBoat } from "@/lib/plaza-protocol";
import { ROLES } from "@/supabase/functions/_shared/types";
const KEY="hoguk:preview-reflection";
export default function BongjiPreview({team,seat=0}:{team?:string;seat?:number}){
 const [reflection,setReflection]=useState<string|null>(null),[boats,setBoats]=useState<SharedBoat[]>([]);
 const members=demoPlazaMembers(ROLES[seat]);const self=members[seat];
 const endpoint=`/api/dev/plaza/boats?game=preview-${team}&seat=${seat}`;
 useEffect(()=>{
  if(!team){try{setReflection(localStorage.getItem(KEY));}catch{}return;}
  let gone=false;
  const read=async()=>{try{const r=await fetch(endpoint,{cache:"no-store"});if(!r.ok)return;const b:SharedBoat[]=await r.json();if(!gone){setBoats(b);setReflection(b.find(v=>v.memberId===self.id&&v.kind==="reflection")?.text??null);}}catch{}};
  void read();const timer=setInterval(read,1000);return()=>{gone=true;clearInterval(timer);};
 },[team,endpoint,self.id]);
 const send=async(text:string,kind:"reflection"|"message")=>{
  if(team){const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,kind})});if(!r.ok)return false;const b:SharedBoat[]=await r.json();setBoats(b);setReflection(b.find(v=>v.memberId===self.id&&v.kind==="reflection")?.text??null);}
  else{const b:SharedBoat={id:kind==="reflection"?`reflection-${self.id}`:crypto.randomUUID(),memberId:self.id,nickname:self.nickname,text,kind,at:Date.now()};setBoats(old=>[...old.filter(v=>v.id!==b.id),b]);if(kind==="reflection"){localStorage.setItem(KEY,text);setReflection(text);}}
  return true;
 };
 return <main style={{position:"relative",height:"100dvh",overflow:"hidden",background:"var(--paper, #f7f1e3)"}}>
  <BongjiPlaza room={team?{gameId:`preview-${team}`,selfId:self.id,memberIds:members.map(m=>m.id),previewSeat:seat}:undefined}
   members={members.map(m=>({...m,reflected:m.self?!!reflection:boats.some(b=>b.memberId===m.id&&b.kind==="reflection")}))}
   reflection={{text:reflection,boats:team||boats.length?boats:undefined,preview:true,onSend:text=>send(text,"reflection"),onMessage:text=>send(text,"message")}}
   recordContent={<section style={{display:"grid",gap:12}}><h3>함께 남기는 한 문장</h3><p>실제 게임에서는 네 사람의 종이배가 모이면 공동 문장을 작성하고 함께 동의해요.</p></section>}/>
 </main>;
}
