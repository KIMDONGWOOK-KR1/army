import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// 발표용 시연 장면 고르기: 작전 메뉴에서 장면을 고르면 그 단계로 바로 넘어간다.
test("demo scene picker jumps to the lock and to the finished operation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();

  const open = async () => {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await page.getByRole("button", { name: "시연 장면 고르기" }).click();
    return page.getByRole("dialog", { name: "시연 장면 고르기" });
  };
  const scenes = await open();
  await expect(scenes).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".game-dialog")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  // 정찰원 화면에서 골라도 자물쇠를 여는 지휘관 화면으로 바뀐다
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "정찰원" }).click();
  await (await open())
    .getByRole("button", { name: /정문 기억의 자물쇠/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-scene="lock"]')).toBeVisible();
  await expect(page.getByText("4 / 4 보직 보고 완료")).toBeVisible();

  await (await open())
    .getByRole("button", { name: /작전 완료와 사초/ })
    .click();
  await expect(page.locator('[data-scene="done"]')).toBeVisible();

  // 끝난 작전에서도 다시 앞 장면으로 돌아갈 수 있다
  await (await open()).getByRole("button", { name: /용봉관으로 이동/ }).click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await expect(page.getByText("용봉관까지", { exact: false })).toBeVisible();
});
