import { expect,it } from "vitest";
import { fullTeam } from "./helpers/full-v2";
import { ROLES } from "../supabase/functions/_shared/types";
it("shares reflections and messages without exposing private mission records or changing consent",async()=>{
 const t=await fullTeam();await t.arrive();await t.wallComplete();await t.depart();await t.arrive();
 for(const r of ROLES)await t.call(r,{action:"submit-retro",text:`${r}의 회고`});
 await t.draft("draft-joint-record");await t.call("scout",{action:"consent-joint-record",draft_version:1});
 const consent=t.view("scout").self.joint_record;
 const cmd={action:"submit-retro",boat_kind:"message" as const,text:"다 같이 춤추자!",request_id:"boat-repeat"};
 const result=await t.call("commander",cmd);await t.call("commander",cmd);
 expect(t.view("scout").game.plaza_boats?.filter(b=>b.kind==="message")).toHaveLength(1);
 expect(t.view("scout").game.plaza_boats?.find(b=>b.id===result.boat_id)?.text).toBe("다 같이 춤추자!");
 expect(t.view("scout").self.joint_record).toEqual(consent);
 expect(JSON.stringify(t.events)).not.toContain("다 같이 춤추자!");
 for(const r of ROLES)await t.call(r,{action:"consent-joint-record",draft_version:1});
 const ended=t.game.endedAt,score=t.game.score;
 await t.call("signal",{action:"submit-retro",boat_kind:"message",text:"완주 축하해요"});
 expect(t.game.status).toBe("done");expect(t.game.endedAt).toBe(ended);expect(t.game.score).toBe(score);
 expect(t.view("cipher").game.plaza_boats?.at(-1)?.text).toBe("완주 축하해요");
 await expect(t.callUser("outsider",{action:"submit-retro",boat_kind:"message",text:"x"})).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("keeps messages in Bongji, validates length and does not substitute for a reflection",async()=>{
 const t=await fullTeam();await expect(t.call("scout",{action:"submit-retro",boat_kind:"message",text:"hello"})).rejects.toMatchObject({code:"WRONG_PHASE"});
 await t.arrive();await t.wallComplete();await t.depart();await t.arrive();
 await expect(t.call("scout",{action:"submit-retro",boat_kind:"message",text:"x".repeat(601)})).rejects.toMatchObject({code:"BAD_RECORD"});
 await t.call("scout",{action:"submit-retro",boat_kind:"message",text:"hello"});
 expect(t.view("scout").self.retro).toBeNull();expect(t.view("scout").game.retro_mask).toEqual([false,false,false,false]);
});
