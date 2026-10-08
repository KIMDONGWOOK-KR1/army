import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// 거점 원판 화면만 켜고 나레이션은 끈다. 다른 시험은 playwright.config.ts에서 둘 다 끈다.
const origin = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
).origin;
test.use({
  storageState: {
    cookies: [],
    origins: [
      { origin, localStorage: [{ name: "hoguk:narration", value: "off" }] },
    ],
  },
});

test("arrival opens the stop screen once, opens the four clues and closes into the mission", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  const stop = page.getByRole("dialog", { name: "전남대 정문" });
  await expect(stop).toBeVisible();
  await expect(stop).toBeFocused();
  await expect(page.locator('[data-scene="mission"]')).toBeAttached();
  // 추모 거점(5·18 사적지)이라 보상처럼 보이는 '+' 표기 없이 차분하게 연다
  await expect(stop.locator(".stop-pill")).toHaveText("단서 4");
  await expect(stop).toHaveClass(/calm/);
  await expect(stop).toContainText("기억의 흔적 1/2");
  await expect(stop).toContainText("원판을 밀어 기록을 펼쳐라");
  // 천천히 떠오르는 등장 움직임이 끝난 뒤의 대비를 잰다
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include(".stop-screen")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  // 열리자마자 초점이 대화상자에 있으니 Enter만 눌러도 원판이 돈다
  await expect(stop).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(stop).toContainText("네 보직의 단서를 받았다.");
  await expect(stop.locator(".stop-bubble")).toHaveCount(4);
  await expect(
    stop.getByRole("button", { name: "원판 돌리기" }),
  ).toHaveAttribute("aria-disabled", "true");

  await stop.getByRole("button", { name: "닫고 계속" }).click();
  await expect(stop).toHaveCount(0);
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await expect(
    page.locator('[data-scene="mission"] [data-scene-heading]'),
  ).toBeFocused();

  // 같은 게임·거점에서는 새로고침해도 다시 띄우지 않는다
  await page.reload();
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
