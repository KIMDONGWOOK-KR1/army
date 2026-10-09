import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({
  storageState: { cookies: [], origins: [] },
  reducedMotion: "no-preference",
});
test("typewriter narration appears at start, arrival and reward only once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".narration")).toHaveCount(0);
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  const narration = page.getByRole("dialog", { name: "기록" });
  await expect(narration).toContainText("오늘의 실록을 함께 엮는다");
  await expect(narration.getByRole("button", { name: "건너뛰기" })).toBeFocused();
  await narration.click();
  await expect(narration.getByRole("button", { name: "계속" })).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: "test-results/narration-mobile.png",
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await narration.getByRole("button", { name: "계속" }).click();
  await expect(narration).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await expect(narration).toHaveCount(0);
  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  // 거점 원판 화면이 먼저 뜨고, 닫아야 도착 나레이션이 이어진다.
  const stop = page.getByRole("dialog", { name: "전남대 정문" });
  await expect(stop).toBeVisible();
  await expect(narration).toHaveCount(0);
  await stop.getByRole("button", { name: "닫고 계속" }).click();
  await expect(stop).toHaveCount(0);
  await expect(narration).toContainText("전남대 정문");
  await page.keyboard.press("Escape");
  await expect(narration).toHaveCount(0);
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
});
