import type { NextRequest } from "next/server";
import { plazaHttp } from "@/lib/server/plaza-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(req:NextRequest){
  if(process.env.NODE_ENV!=="development"||process.env.VERCEL)return new Response(null,{status:404});
  return plazaHttp(req,async()=>{
    const game=req.nextUrl.searchParams.get("game")??"",seat=Number(req.nextUrl.searchParams.get("seat"));
    if(!/^preview-[a-zA-Z0-9-]{1,60}$/.test(game)||!Number.isInteger(seat)||seat<0||seat>3)throw new Error();
    return {game,member:`demo-${["commander","scout","signal","cipher"][seat]}`};
  });
}
export const GET=handle;
export const POST=handle;
