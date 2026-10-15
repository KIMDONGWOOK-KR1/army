import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({storageState:{cookies:[],origins:[]},reducedMotion:"no-preference"});
test("narration keeps its action visible, stable paragraphs and keyboard focus at small sizes", async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/design-review');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.character-lineup')).toHaveAttribute('data-ready','true');
  await page.screenshot({path:'test-results/type-face-mobile.jpg'});
  const trigger = page.getByRole('button',{name:'기록 화면 확인하기'});
  await trigger.focus();
  await trigger.press('Enter');
  const dialog=page.getByRole('dialog',{name:'기록'});
  await expect(dialog.getByRole('button',{name:'건너뛰기'})).toBeFocused();
  const before=await dialog.locator('.narration-text').boundingBox();
  await dialog.getByRole('button',{name:'한 번에 읽기'}).click();
  const after=await dialog.locator('.narration-text').boundingBox();
  expect(after!.height).toBeCloseTo(before!.height,0);
  for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]) {
    await page.setViewportSize({width,height});
    const button=dialog.getByRole('button',{name:'계속',exact:true});
    const box=await button.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y+box!.height).toBeLessThanOrEqual(height);
    expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await button.focus();await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    // Native dialogs may give browser chrome one Tab stop before wrapping.
    if (!await dialog.evaluate(el=>el.contains(document.activeElement))) await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
    if(width===320) await page.screenshot({path:'test-results/narration-small.jpg'});
    if(width===390) await page.screenshot({path:'test-results/narration-polished.jpg'});
  }
  expect((await new AxeBuilder({page}).include('.narration').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'기록 화면 확인하기'})).toBeFocused();
  await page.setViewportSize({width:1200,height:1000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'test-results/type-face-desktop.jpg',animations:'disabled'});
});

test("demo travel, mission, lock and result controls fit short and narrow screens", async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('hoguk:narration','off');
    localStorage.setItem('hoguk:stop','off');
    localStorage.setItem('hoguk:sound','off');
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:568});
  await page.goto('/');
  await page.getByRole('button',{name:'혼자 데모 체험',exact:true}).click();
  for(const [title,scene,action] of [
    ['정문까지 걸어가기','travel','시연 거점에 도착'],
    ['정문 도착, 보직별 단서','mission','단서 확인하고 보고'],
    ['정문 기억의 자물쇠','lock','자물쇠 확인'],
    ['작전 완료와 사초','done','새 작전 준비하기'],
  ]) {
    await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
    await page.getByRole('button',{name:'시연 장면 고르기',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:new RegExp(title)}).click();
    await expect(page.locator(`[data-scene="${scene}"]`)).toBeVisible();
    for(const [width,height] of [[320,568],[844,390],[390,844]]) {
      await page.setViewportSize({width,height});
      const button=page.getByRole('button',{name:action,exact:true});
      await button.scrollIntoViewIfNeeded();
      const box=await button.boundingBox();
      expect(box!.y,scene).toBeGreaterThanOrEqual(0);
      expect(box!.y+box!.height,scene).toBeLessThanOrEqual(height+1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),scene).toBe(true);
      if(width===320) await page.screenshot({path:`test-results/polish-${scene}-small.jpg`});
    }
  }
});
