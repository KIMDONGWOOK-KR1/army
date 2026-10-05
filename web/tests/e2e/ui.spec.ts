import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("responsive UI and solo demo complete both sites with reload recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험" }),
  ).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  expect(
    await page
      .locator(".map-legend")
      .evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThan(60);
  for (const width of [360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "혼자 데모 체험" }).click();
  await expect(
    page.getByRole("button", { name: "시연 거점에 도착" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/travel-mobile.png",
    fullPage: true,
  });
  for (const site of ["gate", "yongbong"]) {
    await page.getByRole("button", { name: "시연 거점에 도착" }).click();
    for (const role of ["지휘관", "정찰원", "통신원", "암호해독관"]) {
      await page.getByRole("button", { name: role, exact: true }).click();
      await expect(page.locator(".mission-form")).toBeVisible();
      if (role === "지휘관")
        await page
          .getByRole("button", {
            name:
              site === "gate"
                ? "서로의 관찰과 기록을 나눈다"
                : "시대별 기록과 그곳의 사람들",
            exact: false,
          })
          .click();
      if (role === "정찰원")
        await page
          .getByPlaceholder("현장에서 찾은 답을 입력하라")
          .fill(site === "gate" ? "1" : "용봉관");
      if (role === "통신원")
        await page
          .getByRole("spinbutton", { name: "주파수 직접 입력" })
          .fill(site === "gate" ? "51.8" : "19.9");
      if (role === "암호해독관")
        await page
          .getByRole("button", { name: site === "gate" ? /일요일$/ : /鳳$/ })
          .click();
      if (site === "gate" && role === "통신원")
        await page.screenshot({
          path: "test-results/signal-mobile.png",
          fullPage: true,
        });
      await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
      await expect(page.locator(".private-digit")).toBeVisible();
      await page.reload();
      await expect(page.locator(".private-digit")).toBeVisible();
    }
    await page.getByRole("button", { name: "지휘관", exact: true }).click();
    const digits =
      site === "gate" ? ["2", "1", "3", "7"] : ["3", "4", "6", "8"];
    for (const [i, role] of [
      "지휘관",
      "정찰원",
      "통신원",
      "암호해독관",
    ].entries())
      await page
        .getByRole("textbox", { name: `${role} 잠금 숫자` })
        .fill(digits[i]);
    if (site === "gate")
      await page.screenshot({
        path: "test-results/lock-mobile.png",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "자물쇠 확인", exact: true })
      .click();
    if (site === "gate") {
      await expect(
        page.getByRole("button", { name: "다음 거점으로 출발" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "다음 거점으로 출발" }).click();
    }
  }
  await expect(
    page.getByRole("button", { name: "수집한 기록 읽기" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/completed-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "수집한 기록 읽기" }).click();
  await expect(page.locator(".record-card.acquired")).toHaveCount(2);
  expect(errors).toEqual([]);
});
