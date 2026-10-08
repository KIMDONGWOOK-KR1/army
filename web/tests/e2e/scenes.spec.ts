import { test, expect } from "@playwright/test";
test("one game scene fills the viewport and progresses from mission to reward to lock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".game-canvas")).toBeVisible();
  await expect(page.locator(".game-scene")).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(844);
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await page
    .getByRole("button", { name: /학교 출입을 막는 계엄군에 항의하려고/ })
    .click();
  await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
  await expect(page.locator('[data-scene="report"]')).toBeVisible();
  await expect(page.locator(".private-digit")).toHaveText("2");
  await expect(page.locator(".lock-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  await expect(page.locator('[data-scene="lock"]')).toBeVisible();
  await expect(page.locator(".private-digit")).toHaveCount(0);
  await expect(page.locator(".game-scene")).toHaveCount(1);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
