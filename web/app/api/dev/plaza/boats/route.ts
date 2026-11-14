import type { NextRequest } from "next/server";
import type { SharedBoat } from "@/lib/plaza-protocol";
export const dynamic="force-dynamic";
const scope=globalThis as typeof globalThis&{hogukPreviewBoats?:Map<string,SharedBoat[]>};
const rooms=scope.hogukPreviewBoats??=new Map<string,SharedBoat[]>();
async function handle(req:NextRequest){
  if(process.env.NODE_ENV!=="development"||process.env.VERCEL)return new Response(null,{status:404});
  const origin=req.headers.get("origin");if(origin&&origin!==`${req.nextUrl.protocol}//${req.headers.get("host")}`)return new Response(null,{status:403});
  const game=req.nextUrl.searchParams.get("game")??"",seat=Number(req.nextUrl.searchParams.get("seat"));
  if(!/^preview-[a-zA-Z0-9-]{1,60}$/.test(game)||!Number.isInteger(seat)||seat<0||seat>3)return new Response(null,{status:400});
  let boats=rooms.get(game)??[];
  if(req.method==="POST"){
    const raw=await req.text();if(raw.length>4096)return new Response(null,{status:413});
    let body;try{body=JSON.parse(raw);}catch{return new Response(null,{status:400});}
    if(typeof body.text!=="string"||!body.text.trim()||body.text.length>600||!["reflection","message"].includes(body.kind))return new Response(null,{status:400});
    const memberId=`demo-${["commander","scout","signal","cipher"][seat]}`;
    const boat:SharedBoat={id:body.kind==="reflection"?`reflection-${memberId}`:crypto.randomUUID(),memberId,nickname:["기록자","솔빛","너울","가람"][seat],text:body.text.trim(),kind:body.kind,at:Date.now()};
    boats=[...boats.filter(b=>b.id!==boat.id),boat].slice(-44);rooms.set(game,boats);
    if(rooms.size>30)rooms.delete(rooms.keys().next().value!);
  }
  return Response.json(boats,{headers:{"Cache-Control":"no-store"}});
}
export const GET=handle;
export const POST=handle;
