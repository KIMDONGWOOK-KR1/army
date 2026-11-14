import type { NextRequest } from "next/server";
import { localPlazaIdentity } from "@/lib/server/store";
import { plazaHttp } from "@/lib/server/plaza-http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(req:NextRequest){
  if(process.env.NEXT_PUBLIC_BACKEND==="supabase"||process.env.VERCEL)return new Response(null,{status:403});
  return plazaHttp(req,()=>localPlazaIdentity(req.cookies.get("hoguk_session")?.value??"",req.nextUrl.searchParams.get("game")??"",Number(req.nextUrl.searchParams.get("seat")??0)));
}
export const GET=handle;
export const POST=handle;
