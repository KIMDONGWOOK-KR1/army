import { notFound } from "next/navigation";
import BongjiPreview from "./preview";
export default async function BongjiPlazaPreviewPage({searchParams}:{searchParams:Promise<{team?:string;seat?:string}>}){
 if(process.env.NODE_ENV!=="development")notFound();
 const q=await searchParams,seat=Number(q.seat??0);
 const team=typeof q.team==="string"&&/^[a-zA-Z0-9-]{1,60}$/.test(q.team)?q.team:undefined;
 return <BongjiPreview team={team} seat={Number.isInteger(seat)&&seat>=0&&seat<4?seat:0}/>;
}
