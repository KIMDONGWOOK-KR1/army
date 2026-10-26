"use client";
import { useState } from "react";
import { CharacterLineup } from "@/components/character-lineup";
import { Narration } from "@/components/narration";
import "./review.css";
export default function DesignReview() {
  const [narration,setNarration]=useState(false);
  const [action,setAction]=useState(false);
  return <main id="main-content" className="design-review">
    <header><p className="review-kicker">호국실록 · 디자인 검토</p><h1>함께 걷는 작은 모험.</h1><p>둥근 글자와 따뜻한 대화창. 네 사람의 발걸음이 하나의 기록이 됩니다.</p><a href="/?mockup=1">프로토타입으로 돌아가기 →</a></header>
    <div className="review-pose" role="group" aria-label="캐릭터 모습">
      <button className="button" aria-pressed={!action} onClick={()=>setAction(false)}>평소 모습</button>
      <button className="button" aria-pressed={action} onClick={()=>setAction(true)}>활동할 때</button>
    </div>
    <CharacterLineup action={action} />
    <section className="review-roles" aria-label="캐릭터 표정">
      {[['지휘관','평소엔 등에 꽂은 깃발 · 활동할 때 높이 든다 · 완장과 견장'],['정찰원','평소엔 목에 건 쌍안경 · 활동할 때 눈에 댄다 · 황토색 배낭'],['통신원','평소엔 멜빵에 꽂은 무전기 · 활동할 때 귀에 댄다'],['암호해독관','평소엔 열쇠 목걸이 · 활동할 때 두 손으로 든다 · 둥근 안경']].map(([role,copy])=><div key={role}><h2>{role}</h2><p>{copy}</p></div>)}
    </section>
    <section className="review-type"><div><p className="review-kicker">제목과 버튼 · 배민 주아</p><h2>우리, 함께 출발할까요?</h2><p>긴 설명은 Noto Sans KR로 또렷하게. 네 사람의 도착이 확인되면 다음 기록을 함께 열어요.</p></div><div><p className="review-kicker">기록 · NOTO SERIF KR</p><p className="review-serif">그해 봄의 기억을,<br/>오늘 우리의 걸음으로 잇는다.</p></div></section>
    <button className="button" onClick={()=>setNarration(true)}>기록 화면 확인하기</button>
    {narration&&<Narration lines={["1980년 5월, 광주.","그해 봄의 기억은 아직 한 권으로 모이지 않았다.","실록은 사초에서 시작된다. 그 자리에서 쓴 첫 기록."]} onClose={()=>setNarration(false)} />}
  </main>;
}
