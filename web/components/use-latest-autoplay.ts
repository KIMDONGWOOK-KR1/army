"use client";
import { useEffect, useRef } from "react";
import { backend, soloFor, setSoloRole } from "@/lib/client";
import { isV2Response, type GameResponse } from "@/lib/game-snapshot";
import type { Command, Role } from "@/supabase/functions/_shared/types";

// Local presentation only. Uses the existing explanation path; never ships private answers.
export function useLatestAutoplay(props: {
  active:boolean; paused:boolean; busy:boolean; s:GameResponse|null; scene:string;
  send:(c:Command)=>Promise<GameResponse|null>; stop:()=>void;
}) {
  const latest=useRef(props); latest.current=props;
  useEffect(()=>{
    if (!props.active || backend!=="local") return;
    let working=false, nextAt=Date.now()+2500, cancelled=false;
    let hold:string|null=null, boatStep=0;
    const click=(label:string)=>{
      const button=Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find(b=>!b.disabled && (b.getAttribute("aria-label")===label || b.textContent?.trim()===label));
      button?.click(); return !!button;
    };
    const tick=async()=>{
      const p=latest.current;
      // Background demos must not keep renewing leases or fill the local request queue.
      if(document.hidden || p.paused){hold=null;return;}
      if(cancelled||working||p.busy||p.paused||Date.now()<nextAt)return;
      working=true; nextAt=Date.now()+4000;
      try {
        const s=p.s;
        if(!s){await p.send({action:"create-solo",nickname:"자동 시연"});return;}
        if(!isV2Response(s))return;
        const solo=soloFor(s.game.id); if(!solo)return;
        const command=async(action:Command["action"],extra:Partial<Command>={})=>{
          const result=await p.send({action,stage_id:s.stage.id,...extra});
          if(!result)throw new Error("자동 시연 응답을 기다립니다.");
          return result;
        };
        const as=async(role:Role,action:Command["action"],extra:Partial<Command>={})=>{
          const r=await fetch("/api/game/solo",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({seat:solo.seats[role],command:{action,game_id:s.game.id,stage_id:s.stage.id,request_id:crypto.randomUUID(),...extra}})});
          if(!r.ok)throw new Error("자동 시연 요청 실패");
        };
        if(s.game.site_phase==="travel"){await command("report-arrival",{method:"simulated"});return;}
        if(s.game.site_phase==="cleared"){
          hold=null;
          // 헌화: 내 국화를 올린다(동료 국화가 다 놓이면 화면이 스스로 넘어간다)
          if(p.scene==="mission"&&click("국화 올리기")){nextAt=Date.now()+5000;return;}
          if(p.scene==="sacho")await command("depart-next-site");
          return;
        }
        if(s.stage.completion.type==="tribute"){
          const step=s.self.mission?.steps[0]; if(!step)return;
          // 참배 순서: 먼저 내 국화를 올린다(헌화), 그다음 함께 누른다(분향)
          if(click("국화 올리기")){nextAt=Date.now()+1600;return;}
          if(s.game.tribute?.missed) hold=null;
          const answer=hold?`hold:${hold}`:`start:${hold=crypto.randomUUID()}`;
          await command("submit-step",{step_id:step.id,answer,simulated:true}); nextAt=Date.now()+700;return;
        }
        if(s.stage.completion.type!=="lock"){
          if(boatStep===0){if(click("회고 종이배 띄우기"))boatStep++;return;}
          if(boatStep===1){
            const field=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="종이배에 담을 회고"]');
            if(field){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set?.call(field,"[자동 시연] 정문에서 함께 모은 기억을 추모의 벽에 전하고, 오늘의 마음을 종이배에 담아요.");field.dispatchEvent(new Event("input",{bubbles:true}));boatStep++;}return;
          }
          if(boatStep===2){if(click("회고를 담아 띄우기"))boatStep++;return;}
          if(boatStep===3){const boat=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.getAttribute("aria-label")?.includes("의 회고 종이배 읽기"));if(boat){boat.click();boatStep++;}return;}
          if(boatStep===4){click("닫기");boatStep++;return;}
          if(boatStep===5){click("석상 곁에서 춤추기");boatStep++;nextAt=Date.now()+8000;return;}
          p.stop();return;
        }
        const next=document.querySelector<HTMLButtonElement>('[data-testid="quiz-next"]');
        if(next){next.click();return;}
        const role=s.self.role!;
        if(!s.self.reported){
          const steps=s.self.mission?.steps??[];
          const complete=steps.length>0&&steps.every(st=>["done","explained"].includes(s.self.step_progress[st.id]?.status));
          if(!complete){await as("commander","request-hint",{target_role:role,level:((s.self.hint_level??0)+1) as 1|2|3});await command("get-game");return;}
          await command("submit-report");return;
        }
        await command("confirm-explanation");
        const roles:Role[]=["commander","scout","signal","cipher"];
        const nextRole=roles[roles.indexOf(role)+1];
        if(nextRole){setSoloRole(s.game.id,nextRole);await command("get-game");return;}
        setSoloRole(s.game.id,"commander");await command("get-game");
        await command("open-after-explanation");
      }catch(e){console.warn("자동 시연 재시도",e);nextAt=Date.now()+5000;}
      finally{working=false;}
    };
    const timer=window.setInterval(()=>void tick(),500);
    return()=>{cancelled=true;clearInterval(timer);};
  },[props.active]);
}
