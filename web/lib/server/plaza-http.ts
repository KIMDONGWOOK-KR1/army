import type { NextRequest } from "next/server";
import { plazaRooms } from "./plaza-room";
export async function plazaHttp(req:NextRequest,identity:()=>Promise<{game:string;member:string}>){
  const headers={"Cache-Control":"no-store, private"};
  const origin=req.headers.get("origin"),own=`${req.nextUrl.protocol}//${req.headers.get("host")}`;
  if(origin&&origin!==own)return Response.json({error:"FORBIDDEN"},{status:403,headers});
  const session=req.nextUrl.searchParams.get("client")??"";
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(session))return Response.json({error:"INVALID_REQUEST"},{status:400,headers});
  let who:{game:string;member:string};
  try{who=await identity();}catch{return Response.json({error:"FORBIDDEN"},{status:403,headers});}
  if(req.method==="POST"){
    if(!req.headers.get("content-type")?.includes("application/json"))return new Response(null,{status:400});
    const text=await req.text();if(text.length>2048)return new Response(null,{status:413});
    try{const value=JSON.parse(text);if(value.session!==session||!plazaRooms.publish(who.game,who.member,value))return new Response(null,{status:400});}
    catch{return new Response(null,{status:400});}
    return new Response(null,{status:204,headers});
  }
  const encoder=new TextEncoder();let dispose=()=>{};
  const stream=new ReadableStream<Uint8Array>({
    start(controller){
      let closed=false;
      const write=(text:string)=>{if(!closed){try{controller.enqueue(encoder.encode(text));}catch{dispose();}}};
      const leave=plazaRooms.join(who.game,who.member,session,value=>write(`data: ${JSON.stringify(value)}\n\n`));
      const ping=setInterval(()=>write(": keepalive\n\n"),10000);
      dispose=()=>{if(closed)return;closed=true;clearInterval(ping);leave();req.signal.removeEventListener("abort",dispose);try{controller.close();}catch{}};
      req.signal.addEventListener("abort",dispose,{once:true});write(": connected\n\n");
      if(req.signal.aborted)dispose();
    },cancel(){dispose();},
  });
  return new Response(stream,{headers:{...headers,"Content-Type":"text/event-stream","Connection":"keep-alive","X-Accel-Buffering":"no"}});
}
