import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROLES, type Role } from "../../supabase/functions/_shared/types";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";

test("four roles see their next action, team progress and only earned journal stamps", async ({browser,baseURL}) => {
  const contexts = await Promise.all(ROLES.map(()=>browser.newContext({baseURL,viewport:{width:390,height:844},reducedMotion:"reduce",storageState:{cookies:[],origins:[{origin:baseURL!,localStorage:[{name:"hoguk:narration",value:"off"},{name:"hoguk:stop",value:"off"},{name:"hoguk:sound",value:"off"}]}]}})));
  try {
    const pages=await Promise.all(contexts.map(c=>c.newPage()));
    let gameId="";
    const call=async(p:Page,action:string,extra:Record<string,unknown>={})=>{
      const response=await p.request.post("/api/game",{data:{action,game_id:gameId||undefined,stage_id:"gate",request_id:crypto.randomUUID(),...extra}});
      expect(response.status(),action).toBe(200); return await response.json() as SnapshotV2;
    };
    const created=await call(pages[0],"create-game",{nickname:"탐방1"});gameId=created.game.id;
    for(let i=1;i<4;i++) await call(pages[i],"join-game",{code:created.game.code,nickname:`탐방${i+1}`});
    await call(pages[0],"start-game");
    await expect.poll(async()=>(await call(pages[0],"get-game")).game.status).toBe("equip");
    const ready=await Promise.all(pages.map(p=>call(p,"set-ready")));
    const forRole=(role:Role)=>pages[ready.findIndex(s=>s.self.role===role)];
    const commander=forRole("commander"), scout=forRole("scout");
    await call(commander,"begin-operation");
    await scout.goto("/");
    const panel=scout.getByTestId("coop-compass");
    await expect(panel).toContainText("내 도착을 확인");
    await scout.getByRole("button",{name:"본인 모의 도착 확인",exact:true}).click();
    await expect(panel).toContainText("도착 확인 1/4");
    await expect(panel).toContainText("내 도착은 확인됐어요");
    await scout.getByText("네 사람의 발걸음",{exact:true}).click();
    await expect(panel.getByRole("list",{name:"역할별 진행 상태"})).toContainText("정찰원 · 나");
    for(const [width,height] of [[320,568],[390,844],[1440,900]]) {
      await scout.setViewportSize({width,height});
      expect(await scout.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const a11y=await new AxeBuilder({page:scout}).include('[data-testid="coop-compass"]').withTags(["wcag2a","wcag2aa"]).analyze();
      expect(a11y.violations).toEqual([]);
    }
    await scout.setViewportSize({width:390,height:844});
    await scout.screenshot({path:"test-results/coop-travel.jpg",animations:"disabled"});
    await panel.getByRole("button",{name:"기록첩",exact:true}).click();
    await expect(scout.getByTestId("expedition-passport")).toContainText("함께 마친 장소 0/4");
    await scout.getByRole("button",{name:"닫기",exact:true}).click();
    for(const role of ROLES.filter(r=>r!=="scout")) await call(forRole(role),"report-arrival",{method:"simulated"});
    await expect(scout.locator('[data-scene="mission"]')).toBeVisible();
    for(const role of ["scout","signal","cipher","commander"] as const) {
      for(const level of [1,2,3]) await call(commander,"request-hint",{target_role:role,level});
      await call(forRole(role),"submit-report"); await call(forRole(role),"confirm-explanation");
    }
    await expect(panel).toContainText("조사 보고 4/4");
    await scout.getByText("네 사람의 발걸음",{exact:true}).click();
    const reward = scout.locator(".reward-stage"), digit = scout.locator(".private-digit");
    const rewardBox = await reward.boundingBox(), digitBox = await digit.boundingBox();
    expect(rewardBox).not.toBeNull(); expect(digitBox).not.toBeNull();
    expect(digitBox!.y).toBeGreaterThanOrEqual(rewardBox!.y);
    expect(digitBox!.y + digitBox!.height).toBeLessThanOrEqual(rewardBox!.y + rewardBox!.height);
    await scout.screenshot({path:"test-results/coop-team.jpg",animations:"disabled"});
    await call(commander,"open-after-explanation");
    await expect(scout.getByTestId("stage-v2-completed")).toBeVisible();
    await panel.getByRole("button",{name:"기록첩",exact:true}).click();
    const passport=scout.getByTestId("expedition-passport");
    await expect(passport).toContainText("함께 마친 장소 1/4");
    await expect(passport.locator('li[data-state="complete"]')).toHaveCount(1);
    await scout.screenshot({path:"test-results/coop-passport.jpg",animations:"disabled"});
    const a11y=await new AxeBuilder({page:scout}).include(".game-dialog").withTags(["wcag2a","wcag2aa"]).analyze();
    expect(a11y.violations).toEqual([]);
  } finally {await Promise.allSettled(contexts.map(c=>c.close()));}
});
