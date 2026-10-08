import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// 통신원 주파수 다이얼: 원을 그리며 돌리고(마우스·손가락), 키보드·휠·±버튼으로 미세 조정한다.
async function openSignal(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  await page.getByRole("button", { name: "통신원", exact: true }).click();
  const dial = page.getByRole("slider", { name: "주파수 조절" });
  await expect(dial).toBeVisible();
  await dial.scrollIntoViewIfNeeded();
  return dial;
}

const value = async (page: Page) =>
  Number(
    await page
      .getByRole("slider", { name: "주파수 조절" })
      .getAttribute("aria-valuenow"),
  );

/** 다이얼 중심에서 radius 비율만큼 떨어진, 12시 기준 시계 방향 deg 지점 */
async function rim(page: Page, deg: number) {
  const box = (await page
    .getByRole("slider", { name: "주파수 조절" })
    .boundingBox())!;
  const r = box.width * 0.36,
    a = ((deg - 90) * Math.PI) / 180;
  return {
    x: box.x + box.width / 2 + r * Math.cos(a),
    y: box.y + box.height / 2 + r * Math.sin(a),
  };
}

test("the frequency dial turns with a mouse drag, wheel, keyboard and ± buttons", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const dial = await openSignal(page);
  const input = page.getByRole("spinbutton", { name: "주파수 직접 입력" });
  await expect(dial).toHaveAttribute("aria-valuemin", "10");
  await expect(dial).toHaveAttribute("aria-valuemax", "100");
  await expect(dial).toHaveAttribute("aria-valuenow", "50");
  await expect(dial).toHaveAttribute("aria-valuetext", "50.0 메가헤르츠");
  await expect(page.getByText("주파수 조절", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".mission-form")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  // 12시에서 잡아 시계 방향으로 약 108도(= 15칸, 1.5 MHz) 돌린다.
  const start = await rim(page, 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let d = 6; d <= 108; d += 6) {
    const p = await rim(page, d);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  const turned = await value(page);
  expect(turned).toBeGreaterThanOrEqual(51.4);
  expect(turned).toBeLessThanOrEqual(51.6);
  await expect(input).toHaveValue(turned.toFixed(1));
  await expect(dial).toHaveAttribute(
    "aria-valuetext",
    `${turned.toFixed(1)} 메가헤르츠`,
  );

  // 반시계 방향으로 되돌리면 값이 줄어든다.
  const back = await rim(page, 120);
  await page.mouse.move(back.x, back.y);
  await page.mouse.down();
  for (let d = 114; d >= 30; d -= 6) {
    const p = await rim(page, d);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  expect(await value(page)).toBeLessThan(turned);

  // 키보드: 화살표 ±0.1, PageUp/PageDown ±1, Home/End 끝.
  await dial.focus();
  const before = await value(page);
  await page.keyboard.press("ArrowUp");
  expect(await value(page)).toBeCloseTo(before + 0.1, 5);
  await page.keyboard.press("ArrowRight");
  expect(await value(page)).toBeCloseTo(before + 0.2, 5);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  expect(await value(page)).toBeCloseTo(before, 5);
  await page.keyboard.press("PageUp");
  expect(await value(page)).toBeCloseTo(before + 1, 5);
  await page.keyboard.press("Home");
  await expect(dial).toHaveAttribute("aria-valuenow", "10");
  await page.keyboard.press("ArrowDown");
  await expect(dial).toHaveAttribute("aria-valuenow", "10");
  await page.keyboard.press("End");
  await expect(dial).toHaveAttribute("aria-valuenow", "100");

  // 휠 한 눈금 = 0.1 MHz, 위로 굴리면 커진다.
  for (let i = 0; i < 40; i++) await page.keyboard.press("PageDown");
  await expect(dial).toHaveAttribute("aria-valuenow", "60");
  const box = (await dial.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(dial).toHaveAttribute("aria-valuenow", "60.1");
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, 100);
  await expect(dial).toHaveAttribute("aria-valuenow", "59.9");

  // ±0.1 버튼과 직접 입력도 다이얼과 같은 값을 쓴다.
  await page.getByRole("button", { name: "주파수 0.1 높이기" }).click();
  await expect(input).toHaveValue("60.0");
  await page.getByRole("button", { name: "주파수 0.1 낮추기" }).click();
  await expect(dial).toHaveAttribute("aria-valuenow", "59.9");
  // 범위 밖 값은 치는 동안 다이얼을 움직이지 않고, 칸을 벗어나면 끝값으로 정리된다.
  await input.fill("120");
  await expect(dial).toHaveAttribute("aria-valuenow", "59.9");
  await input.blur();
  await expect(input).toHaveValue("100.0");
  await expect(dial).toHaveAttribute("aria-valuenow", "100");

  // 다이얼만으로 51.8을 맞춰 보고하면 숫자를 받는다.
  await dial.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 41; i++) await page.keyboard.press("PageUp");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("51.8");
  await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
  await expect(page.locator('[data-scene="report"]')).toBeVisible();
  await expect(page.locator(".private-digit")).toHaveText("3");
  expect(errors).toEqual([]);
});

// 손가락 시험은 무거운 이동 화면을 거치지 않고 API로 통신원 미션까지 바로 간다.
test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("a finger drag turns the dial without scrolling the mission", async ({
    page,
    context,
  }) => {
    const api = async (action: string, data: Record<string, unknown> = {}) => {
      const response = await page.request.post("/api/game", {
        data: { action, request_id: crypto.randomUUID(), ...data },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const game_id = (await api("create-demo", { nickname: "다이얼" })).game.id;
    await api("demo-arrival", { game_id, site_id: "gate" });
    await api("demo-role", { game_id, demo_role: "signal" });
    await page.goto("/");
    const dial = page.getByRole("slider", { name: "주파수 조절" });
    await expect(dial).toHaveAttribute("aria-valuenow", "50");
    await dial.scrollIntoViewIfNeeded();
    const stage = page.locator(".mission-stage");
    const scrollBefore = await stage.evaluate((el) => el.scrollTop);
    const cdp = await context.newCDPSession(page);
    const touch = async (
      type: "touchStart" | "touchMove" | "touchEnd",
      p?: { x: number; y: number },
    ) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
      });
    // 3시에서 6시 방향으로 손가락을 돌린다(시계 방향 90도 남짓 = 약 1.3 MHz).
    await touch("touchStart", await rim(page, 90));
    for (let d = 96; d <= 186; d += 6)
      await touch("touchMove", await rim(page, d));
    await touch("touchEnd");
    await expect
      .poll(async () => Number(await dial.getAttribute("aria-valuenow")))
      .toBeGreaterThanOrEqual(51.1);
    expect(Number(await dial.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(
      51.4,
    );
    expect(await stage.evaluate((el) => el.scrollTop)).toBe(scrollBefore);
  });
});
