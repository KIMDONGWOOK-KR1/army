import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";

// Public synthetic fixture only. No cloud requests or retained private artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

function fixtureForInput(): V2Response {
  const fixture = JSON.parse(readFileSync(new URL(
    "../../../docs/be/fixtures/get-stage.gate.scout.before-hint.json", import.meta.url,
  ), "utf8")) as V2Response;
  const step = fixture.self.mission!.steps[0];
  fixture.self.mission!.steps = [{ ...step, id: "MOCK.input", requiresReports: [] }];
  fixture.self.step_progress = { "MOCK.input": { ...fixture.self.step_progress[step.id], status: "open" } };
  fixture.stage.narration = [];
  return fixture;
}

test("초기 복원 429 뒤 만료된 방이면 오류를 지우고 첫 화면에서 새 작전을 시작할 수 있다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hoguk-game", "mock-expired-room");
  });
  const reads: number[] = [];
  await page.route("**/api/game", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      action: "get-game", game_id: "mock-expired-room",
    });
    reads.push(Date.now());
    if (reads.length === 1) {
      await route.fulfill({ status: 429, headers: { "Retry-After": "1" },
        contentType: "text/plain", body: "Too many requests." });
      return;
    }
    await route.fulfill({ status: 410, json: {
      code: "EXPIRED", message: "[합성] 만료된 연습 방입니다.",
    } });
  });
  await page.goto("/");
  await expect(page.locator(".error-banner")).toContainText("서버 요청이 잠시 몰렸다");
  await expect.poll(() => reads.length).toBe(2);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 연결", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-scene="title"]')).toBeVisible();
  expect(reads[1] - reads[0]).toBeGreaterThanOrEqual(900);
  expect(await page.evaluate(() => localStorage.getItem("hoguk-game"))).toBeNull();
  const start = page.getByRole("button", { name: "작전 시작", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByLabel("호출명", { exact: true })).toBeVisible();
  expect(reads).toHaveLength(2);
});

test("조회 요청을 합치고 429 대기 시간을 지킨 뒤 회복하며 홈에서는 재조회하지 않는다", async ({ page }) => {
  const fixture = fixtureForInput();
  const reads: number[] = [];
  const otherActions: string[] = [];
  let throttleNext = false;
  await page.route("**/api/game", async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action !== "get-game") otherActions.push(action);
    reads.push(Date.now());
    if (throttleNext) {
      throttleNext = false;
      await route.fulfill({ status: 429, headers: { "Retry-After": "2" },
        contentType: "text/plain", body: "Too many requests. Re-try the request in 1 seconds." });
    } else await route.fulfill({ status: 200, json: fixture });
  });
  await page.goto("/");
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  const initialReads = reads.length;
  throttleNext = true;
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    }
  });
  await expect(page.locator(".error-banner")).toContainText("서버 요청이 잠시 몰렸다");
  const blockedReads = reads.length;
  expect(blockedReads).toBe(initialReads + 1);
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(700);
  expect(reads).toHaveLength(blockedReads);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  expect(reads).toHaveLength(blockedReads + 1);
  expect(reads.at(-1)! - reads.at(-2)!).toBeGreaterThanOrEqual(1900);
  expect(otherActions).toEqual([]);

  throttleNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".error-banner")).toBeVisible();
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "작전 메뉴", exact: true })
    .getByRole("button", { name: "첫 화면으로", exact: true }).click();
  await expect(page.locator('[data-scene="title"]')).toBeVisible();
  const readsAtHome = reads.length;
  await page.waitForTimeout(2300);
  expect(reads).toHaveLength(readsAtHome);
});

test("제출 429는 입력과 요청 번호를 보존하고 명시적 재시도 전에는 다시 제출하지 않는다", async ({ page }) => {
  const fixture = fixtureForInput();
  const submissions: Record<string, unknown>[] = [];
  await page.route("**/api/game", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "submit-step") {
      submissions.push(command);
      if (submissions.length === 1) {
        await route.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: {
          message: "Too many requests. Re-try the request in 1 seconds.",
        } });
        return;
      }
    } else expect(command.action).toBe("get-game");
    await route.fulfill({ status: 200, json: fixture });
  });
  await page.goto("/");
  const form = page.getByTestId("mission-v2-step-MOCK.input");
  await form.getByTestId("story-open-clue").click();
  const input = form.getByRole("textbox").first();
  await input.fill("합성 입력 유지 확인");
  await form.getByTestId("story-submit").click();
  await expect(page.locator(".error-banner")).toContainText("서버 요청이 잠시 몰렸다");
  await expect(input).toHaveValue("합성 입력 유지 확인");
  await page.getByRole("button", { name: "다시 연결", exact: true }).click();
  expect(submissions).toHaveLength(1);
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(input).toHaveValue("합성 입력 유지 확인");
  expect(submissions).toHaveLength(1);
  await page.getByRole("button", { name: "다시 연결", exact: true }).click();
  await expect(page.locator(".error-banner")).toHaveCount(0);
  expect(submissions).toHaveLength(2);
  expect(submissions[0].request_id).toBeTruthy();
  expect(submissions[1]).toEqual(submissions[0]);
});
