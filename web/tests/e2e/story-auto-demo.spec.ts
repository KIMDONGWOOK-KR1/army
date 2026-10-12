import { expect, test } from "@playwright/test";

test("automatic solo tour pauses and completes the assisted course", async ({ page, baseURL }) => {
  test.setTimeout(360000);
  await page.addInitScript(() => {
    localStorage.setItem("hoguk:narration", "off");
    localStorage.setItem("hoguk:stop", "off");
    localStorage.setItem("hoguk:sound", "off");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.goto(baseURL!);
  const creation = page.waitForResponse((response) => response.url().endsWith("/api/game") && response.request().postDataJSON()?.action === "create-demo");
  await page.getByRole("button", { name: "자동 시연 보기", exact: true }).click();
  const response = await creation;
  expect(response.ok(), "시연 방 생성 HTTP 응답").toBe(true);
  const controls = page.getByTestId("auto-demo-controls");
  await expect(controls).toContainText("자동 시연 · 해설로 체험");
  await controls.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.clock.fastForward(7000);
  await expect(page.getByRole("button", { name: "시연 거점에 도착", exact: true })).toBeVisible();
  await controls.getByRole("button", { name: "시연 계속", exact: true }).click();
  // Accelerate presentation timers only; real requests still use the normal local server.
  for (let tick = 0; tick < 600 && !await page.getByTestId("result-v2").isVisible(); tick++) {
    await page.clock.fastForward(1500);
    await page.waitForTimeout(150);
    const label = await controls.innerText();
    expect(label, `자동 진행 중 예기치 않은 정지: ${await controls.getAttribute("data-demo-step")}`).not.toContain("시연 일시정지");
  }
  await expect(page.getByTestId("result-v2")).toBeVisible();
  await expect(controls).toContainText("시연을 모두 마쳤어요");
  await expect(page.getByTestId("final-joint-record")).toContainText("회고 4/4 · 동의 4/4");
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await controls.getByRole("button", { name: "시연 닫기", exact: true }).click();
  await expect(controls).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("result-v2")).toBeVisible();
  await expect(controls).toHaveCount(0);
});

test("arrival presentation advances and manual input hands control back", async ({ page, baseURL }) => {
  await page.addInitScript(() => { localStorage.setItem("hoguk:sound", "off"); });
  await page.goto(baseURL!);
  await page.getByRole("button", { name: "자동 시연 보기", exact: true }).click();
  const controls = page.getByTestId("auto-demo-controls");
  await expect(controls).toBeVisible();
  await expect(page.getByTestId("story-help")).toBeVisible({ timeout: 90000 });
  // A real user input, rather than a programmatic demo click, takes over.
  await page.getByTestId("story-help").locator("summary").click();
  await expect(controls).toContainText("시연 일시정지");
  await controls.getByRole("button", { name: "직접 체험하기", exact: true }).click();
  await expect(controls).toHaveCount(0);
  await expect(page.getByTestId("story-workbench")).toBeVisible();
});
