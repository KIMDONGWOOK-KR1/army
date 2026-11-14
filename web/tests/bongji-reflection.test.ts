import { expect, it, vi } from "vitest";
import { sendReflection } from "../lib/bongji-reflection";
import { fullTeam } from "./helpers/full-v2";
import { ROLES } from "../supabase/functions/_shared/types";
it("종이배 회고가 실제 완료 상태를 갱신하고 팀의 종이배에 본문을 공개한다",async()=>{
 const t=await fullTeam();await t.arrive();await t.wallComplete();await t.depart();await t.arrive();
 const submit=async(text:string)=>sendReflection(async command=>{const result=await t.call("commander",command);return {...t.view("commander"),result};},"bongji",text);
 expect(await submit("  오늘\n함께 걸어 고마웠어요.  ")).toBe(true);
 expect(t.view("commander").self.retro).toBe("오늘 함께 걸어 고마웠어요.");
 expect(t.view("scout").game.retro_mask?.[ROLES.indexOf("commander")]).toBe(true);
 expect(t.view("scout").game.plaza_boats?.[0].text).toBe("오늘 함께 걸어 고마웠어요.");
 for(const r of ROLES.filter(r=>r!=="commander"))await t.call(r,{action:"submit-retro",text:"[합성] 동료의 회고"});
 await t.draft("draft-joint-record");await t.call("scout",{action:"consent-joint-record",draft_version:1});
 expect(await submit("다시 쓴 회고")).toBe(true);
 expect(t.view("scout").self.joint_record?.confirm_mask).toEqual([false,false,false,false]);
 for(const r of ROLES)await t.call(r,{action:"consent-joint-record",draft_version:2});
 expect(t.game.status).toBe("done");expect(t.view("commander").self.retro).toBe("다시 쓴 회고");
});
it("빈 회고·초과 입력·실패 응답은 배를 띄울 성공으로 처리하지 않는다",async()=>{
 const send=vi.fn(async()=>null);expect(await sendReflection(send,"bongji","   ")).toBe(false);expect(await sendReflection(send,"bongji","가".repeat(601))).toBe(false);expect(send).not.toHaveBeenCalled();
 expect(await sendReflection(send,"bongji","오늘의 마음")).toBe(false);
});
