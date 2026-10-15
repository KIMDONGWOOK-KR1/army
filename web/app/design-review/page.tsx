"use client";
import { useState } from "react";
import { CharacterLineup } from "@/components/character-lineup";
import { Narration } from "@/components/narration";
import "./review.css";
export default function DesignReview() {
  const [narration,setNarration]=useState(false);
  return <main id="main-content" className="design-review">
    <header><p className="review-kicker">호국실록 · 디자인 검토</p><h1>네 사람, 서로 다른 표정.</h1><p>작은 화면에서는 또렷하게, 기록을 읽을 때는 차분하게.</p><a href="/?mockup=1">프로토타입으로 돌아가기 →</a></header>
    <CharacterLineup />
    <section className="review-roles" aria-label="캐릭터 표정">
      {[['지휘관','차분한 눈썹과 작은 미소'],['정찰원','둥근 눈과 부드러운 볼'],['통신원','올라간 입꼬리와 넉넉한 볼'],['암호해독관','가느다란 눈과 둥근 안경']].map(([role,copy])=><div key={role}><h2>{role}</h2><p>{copy}</p></div>)}
    </section>
    <section className="review-type"><div><p className="review-kicker">화면 · PRETENDARD</p><h2>다음 행동이 한눈에.</h2><p>네 사람의 도착이 확인되면, 다음 기록을 함께 열어요.</p></div><div><p className="review-kicker">기록 · NOTO SERIF KR</p><p className="review-serif">그해 봄의 기억을,<br/>오늘 우리의 걸음으로 잇는다.</p></div></section>
    <button className="button" onClick={()=>setNarration(true)}>기록 화면 확인하기</button>
    {narration&&<Narration lines={["1980년 5월, 광주.","그해 봄의 기억은 아직 한 권으로 모이지 않았다.","실록은 사초에서 시작된다. 그 자리에서 쓴 첫 기록."]} onClose={()=>setNarration(false)} />}
  </main>;
}
