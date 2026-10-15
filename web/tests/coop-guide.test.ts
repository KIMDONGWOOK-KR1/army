import { describe, expect, it } from "vitest";
import { team } from "./helpers/v2";
import { fullTeam } from "./helpers/full-v2";
import { projectGameV2 } from "../supabase/functions/_shared/engine-v2";
import { ROLES } from "../supabase/functions/_shared/types";
import { coopGuide, expeditionStops } from "../lib/coop-guide";

describe("cooperative wayfinding uses server progress", () => {
  it("distinguishes my arrival from the whole team's arrival", async () => {
    const t = await team({arrive:false});
    const view = () => projectGameV2(t.game,t.course,t.user("scout"),t.now());
    expect(coopGuide(view()).count).toBe(0);
    await t.call("scout",{action:"report-arrival",method:"simulated"});
    expect(coopGuide(view())).toMatchObject({count:1,label:"도착 확인"});
    expect(coopGuide(view()).action).toContain("내 도착은 확인됐어요");
    expect(expeditionStops(view()).filter(s=>s.status==="complete")).toHaveLength(0);
  });
  it("offers an active waiting instruction and does not copy private payloads", async () => {
    const t = await team(); await t.solve("scout");
    const view = projectGameV2(t.game,t.course,t.user("scout"),t.now());
    const guide = coopGuide(view);
    expect(guide.action).toContain("말로 전하고");
    expect(guide.count).toBe(1);
    expect(guide.members.find(m=>m.role==="scout")?.done).toBe(true);
    expect(JSON.stringify(guide)).not.toContain(view.self.mission!.intro.text);
    expect(guide).not.toHaveProperty("digit");
    expect(guide.members.some(m=>"record" in m || "digit" in m)).toBe(false);
  });
  it("shows quiet tribute and renewed consent after a changed reflection", async () => {
    const t = await fullTeam(); await t.arrive();
    expect(coopGuide(t.view("scout"))).toMatchObject({quiet:true,label:"헌화"});
    await t.offer("scout");
    expect(coopGuide(t.view("scout")).action).toContain("조용히 머물러요");
    for (const role of ROLES.filter(r=>r!=="scout")) await t.offer(role);
    expect(expeditionStops(t.view("scout")).filter(s=>s.status==="complete")).toHaveLength(3);
    await t.depart(); await t.arrive();
    for (const role of ROLES) await t.call(role,{action:"submit-retro",text:`[합성] ${role} 비공개`});
    await t.draft("draft-joint-record");
    await t.call("scout",{action:"consent-joint-record",draft_version:1});
    expect(coopGuide(t.view("scout")).action).toContain("현재 기록에 동의");
    await t.call("commander",{action:"submit-retro",text:"[합성] 수정한 비공개 회고"});
    expect(coopGuide(t.view("scout")).action).toContain("최신 공동 문장");
    expect(coopGuide(t.view("scout")).members.find(m=>m.role==="scout")?.done).toBe(false);
    expect(JSON.stringify(coopGuide(t.view("scout")))).not.toContain("수정한 비공개 회고");
  });
});
