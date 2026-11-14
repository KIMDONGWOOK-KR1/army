import { notFound } from "next/navigation";
export default function Together(){
  if(process.env.NODE_ENV!=="development")notFound();
  const room=`together-${Date.now()}`;
  return <main style={{height:"100dvh",display:"grid",gridTemplateRows:"44px 1fr",background:"#eceadf"}}>
    <div style={{padding:"10px 16px",color:"#37584b",fontSize:14}}>함께 노는 봉지 · 두 플레이어의 화면</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,minHeight:0}}>
      {[0,1].map(seat=><iframe key={seat} title={`${seat+1}번 플레이어`} src={`/dev/bongji?team=${room}&seat=${seat}`} style={{border:0,width:"100%",height:"100%"}} />)}
    </div>
  </main>;
}
