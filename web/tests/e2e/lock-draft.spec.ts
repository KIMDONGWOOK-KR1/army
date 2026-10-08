import { test, expect, type Page } from "@playwright/test";

const roles = ["지휘관", "정찰원", "통신원", "암호해독관"];
const digits = (page: Page) =>
  roles.map((role) => page.getByRole("textbox", { name: `${role} 잠금 숫자` }));

async function api(
  page: Page,
  action: string,
  data: Record<string, unknown> = {},
) {
  const response = await page.request.post("/api/game", {
    data: { action, request_id: crypto.randomUUID(), ...data },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function prepareLock(page: Page) {
  const initial = await api(page, "create-demo", { nickname: "입력시험" });
  const game_id = initial.game.id;
  await api(page, "demo-arrival", { game_id, site_id: "gate" });
  for (const [i, role] of [
    "commander",
    "scout",
    "signal",
    "cipher",
  ].entries()) {
    await api(page, "demo-role", { game_id, demo_role: role });
    await api(page, "submit-report", {
      game_id,
      site_id: "gate",
      role,
      answer: ["2", "1", "51.8", "일요일"][i],
    });
  }
  await api(page, "demo-role", { game_id, demo_role: "commander" });
  await page.goto("/");
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  return game_id;
}

async function expectDigits(page: Page, values: string[]) {
  for (const [i, input] of digits(page).entries())
    await expect(input).toHaveValue(values[i]);
}

async function roundTrip(page: Page) {
  await page.getByRole("button", { name: "내 숫자 확인" }).click();
  await expect(page.locator(".lock-panel")).toHaveCount(0);
  await expect(page.locator(".private-digit")).toBeVisible();
  await page.locator(".private-digit").scrollIntoViewIfNeeded();
  await expect(page.locator(".private-digit")).toBeInViewport({ ratio: 0.99 });
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  await expect(page.locator(".private-digit")).toHaveCount(0);
}

test("unsubmitted lock digits survive repeated number-screen round trips and polling", async ({
  page,
}) => {
  await prepareLock(page);
  await digits(page)[1].fill("0");
  await digits(page)[3].fill("7");
  for (let i = 0; i < 2; i++) {
    await roundTrip(page);
    await expectDigits(page, ["", "0", "", "7"]);
  }
  await digits(page)[3].fill("");
  await page.route("**/api/game", async (route) => {
    if (route.request().postDataJSON().action !== "get-game")
      return route.continue();
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.game.score = 99;
    await route.fulfill({ response, json: snapshot });
  });
  // Observe an applied poll, not just its response headers.
  await expect(page.locator(".hud-score")).toContainText("99");
  await roundTrip(page);
  await expectDigits(page, ["", "0", "", ""]);
  await expect(
    page.getByRole("button", { name: "자물쇠 확인", exact: true }),
  ).toBeDisabled();
});

test("a failed submission keeps unconfirmed digits when checking the personal number", async ({
  page,
}) => {
  await prepareLock(page);
  const values = ["2", "1", "3", "7"];
  for (const [i, input] of digits(page).entries()) await input.fill(values[i]);
  let attempts = 0;
  await page.route("**/api/game", (route) => {
    if (route.request().postDataJSON().action === "open-lock") {
      attempts++;
      return route.abort();
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
  const banner = page.locator('.error-banner[role="alert"]');
  const retry = banner.getByRole("button", { name: "다시 연결" });
  await expect(banner).toBeVisible();
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 360, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    // Use real clicks with the error visible: an overlay must not block navigation.
    await roundTrip(page);
    await expectDigits(page, values);
    await expect(banner).toBeVisible();
    await expect(retry).toBeInViewport({ ratio: 0.99 });
    const consoleBox = await page.locator(".game-console").boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(bannerBox!.y).toBeGreaterThanOrEqual(
      consoleBox!.y + consoleBox!.height,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(viewport.height);
  }
  await retry.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(banner).toBeVisible();
  await expectDigits(page, values);
  await page.unroute("**/api/game");
  await retry.click();
  await expect(page.locator('[data-scene="sacho"]')).toBeVisible();
  await expect(banner).not.toBeVisible();
});

test("server attempts clear rejected drafts while locked digits and new edits survive round trips", async ({
  page,
}) => {
  const game_id = await prepareLock(page);
  for (const input of digits(page)) await input.fill("0");
  await page.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
  await expect(page.locator(".lock-panel")).toContainText("2회 남음");
  await roundTrip(page);
  await expectDigits(page, ["", "", "", ""]);

  for (const [i, input] of digits(page).entries())
    await input.fill(["2", "0", "0", "0"][i]);
  await page.getByRole("button", { name: "내 숫자 확인" }).click();
  // A completed request/recovery can update the lock while its scene is unmounted.
  await api(page, "open-lock", {
    game_id,
    site_id: "gate",
    digits: [2, 0, 0, 0],
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".hud-score")).toContainText("80");
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  await expectDigits(page, ["2", "", "", ""]);
  await expect(digits(page)[0]).toBeDisabled();
  await digits(page)[1].fill("1");
  await roundTrip(page);
  await expectDigits(page, ["2", "1", "", ""]);
  await expect(digits(page)[0]).toBeDisabled();
  await digits(page)[2].fill("3");
  await digits(page)[3].fill("7");
  await page.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
  await page.getByRole("button", { name: "다음 거점으로 출발" }).click();
  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  await page
    .getByRole("button", { name: /대학의 역사와 오월의 기록/ })
    .click();
  await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  await expectDigits(page, ["", "", "", ""]);
  for (const input of digits(page)) await expect(input).toBeEnabled();
});
