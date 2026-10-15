import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("journey guidance and sound settings remain usable across viewport sizes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width,height:844});
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    if (width === 390) {
      await expect(page.locator(".home-hero.ready")).toBeVisible({timeout:30000});
      await page.screenshot({path:"test-results/final-home-mobile.jpg",animations:"disabled"});
    }
    await page.getByRole("button", {name:"탐방 안내",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await expect(dialog.getByRole("list",{name:"전남대 탐방 순서"})).toContainText("용봉열사 추모의 벽");
    await expect(dialog.getByRole("heading",{name:"지휘관",exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({path:"test-results/final-guide-mobile.jpg",animations:"disabled"});
    const a11y = await new AxeBuilder({page}).include(".game-dialog").withTags(["wcag2a","wcag2aa"]).analyze();
    expect(a11y.violations).toEqual([]);
    await dialog.getByRole("button",{name:"닫기",exact:true}).click();
  }
  await page.getByRole("button",{name:"메뉴 열기",exact:true}).click();
  await page.getByRole("button",{name:"효과음만",exact:true}).click();
  await expect(page.getByRole("slider",{name:"배경음 음량"})).toHaveValue("0");
  await expect(page.getByRole("slider",{name:"효과음 음량"})).toHaveValue("75");
  await page.reload();
  await page.getByRole("button",{name:"메뉴 열기",exact:true}).click();
  await expect(page.getByRole("button",{name:"효과음만",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"집중",exact:true}).click();
  await expect(page.getByRole("slider",{name:"배경음 음량"})).toHaveValue("25");
  const slider=page.getByRole("slider",{name:"배경음 음량"});
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("30");
  await page.getByRole("button",{name:"효과음·배경음 끄기",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"전체 소리가 꺼져 있어요"})).toBeVisible();
  await expect(page.getByRole("button",{name:"효과음 들어보기",exact:true})).toBeDisabled();
  await page.screenshot({path:"test-results/final-audio.jpg",animations:"disabled"});
  const a11y = await new AxeBuilder({page}).include(".game-dialog").withTags(["wcag2a","wcag2aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  expect(errors).toEqual([]);
});
