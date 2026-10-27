import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import type { GameResponse, V2Response } from "../../lib/game-snapshot";

// Use the isolated local synthetic backend or a public documentation fixture.
// Home navigation must not delete a room, reset teammates, or retain artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

async function clickAction(page: Page, button: Locator, action: string) {
  const [response] = await Promise.all([
    page.waitForResponse((reply) => reply.url().endsWith("/api/game") &&
      reply.request().method() === "POST" && reply.request().postDataJSON()?.action === action),
    button.click(),
  ]);
  expect(response.status()).toBe(200);
  return await response.json() as GameResponse;
}

async function expectHome(page: Page) {
  await expect(page.locator('[data-scene="title"]')).toBeVisible();
  // Enabled means restoration has settled, not just the initial server render.
  await expect(page.getByRole("button", { name: "작전 시작", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("hoguk-game"))).toBeNull();
}

async function rejoin(page: Page, code: string) {
  await page.getByRole("button", { name: "코드로 합류", exact: true }).click();
  await page.getByLabel("호출명", { exact: true }).fill("연습1");
  await page.getByLabel("입장 코드", { exact: true }).fill(code);
  return clickAction(page, page.getByRole("button", { name: "작전에 합류하기", exact: true }), "join-game");
}

test("개발용 대기실에서 나갔다 재입장하고 초대 링크에서도 첫 화면으로 돌아온다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "작전 시작", exact: true }).click();
  await page.getByLabel("호출명", { exact: true }).fill("연습1");
  const created = await clickAction(page,
    page.getByRole("button", { name: "새 작전 만들기", exact: true }), "create-game");
  await expect(page.locator('[data-scene="lobby"]')).toBeVisible();
  await page.getByRole("button", { name: "첫 화면으로", exact: true }).click();
  await expectHome(page);
  await page.reload();
  await expectHome(page);
  const retained = await page.request.post("/api/game", {
    data: { action: "get-game", game_id: created.game.id },
  });
  expect(retained.status()).toBe(200);
  const retainedRoom = await retained.json() as V2Response;
  expect(retainedRoom.game.id).toBe(created.game.id);
  expect(retainedRoom.game.members).toHaveLength(1);
  expect(retainedRoom.self.id).toBe(created.self.id);
  const joined = await rejoin(page, created.game.code);
  expect(joined.game.id).toBe(created.game.id);
  expect(joined.self.id).toBe(created.self.id);
  expect(joined.game.members).toHaveLength(1);
  await expect(page.locator('[data-scene="lobby"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hoguk-game"))).toBe(created.game.id);
  await page.goto(`/j/${created.game.code}?dev=1`);
  await expect(page.locator('[data-scene="lobby"]')).toBeVisible();
  await page.getByRole("button", { name: "첫 화면으로", exact: true }).click();
  await expectHome(page);
  expect(new URL(page.url()).pathname).toBe("/");
  await page.reload();
  await expectHome(page);
});

test("개인 미션에서 나가면 늦은 조회를 무시하고 재입장 시 진행을 유지한다", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL(
    "../../../docs/be/fixtures/get-stage.gate.scout.after-hint.json", import.meta.url,
  ), "utf8")) as V2Response;
  fixture.course.id = "jnu-demo-dev-home-fixture";
  fixture.game.id = "mock-home-progress";
  const originalProgress = structuredClone(fixture.self.step_progress);
  let holdRefresh = false;
  let delayed: Route | null = null;
  const writes: string[] = [];
  await page.context().route("**/api/game", async (route) => {
    const command = route.request().postDataJSON() as { action?: string };
    if (command.action === "get-game" && holdRefresh) {
      holdRefresh = false;
      delayed = route;
      return;
    }
    if (!["get-game", "get-stage"].includes(command.action ?? "")) {
      writes.push(command.action ?? "unknown");
      if (command.action !== "join-game") {
        await route.fulfill({ status: 405, json: { code: "READ_ONLY_MOCK" } });
        return;
      }
    }
    await route.fulfill({ status: 200, json: fixture });
  });
  await page.goto("/?dev=1");
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  holdRefresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => delayed !== null).toBe(true);
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "작전 메뉴", exact: true })
    .getByRole("button", { name: "첫 화면으로", exact: true }).click();
  await expectHome(page);
  expect(new URL(page.url()).pathname).toBe("/");
  const response = page.waitForResponse((reply) => reply.url().endsWith("/api/game") &&
    reply.request().postDataJSON()?.action === "get-game");
  await (delayed as Route | null)!.fulfill({ status: 200, json: fixture });
  await (await response).finished();
  // Let the resolved response run through React before checking it was ignored.
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expectHome(page);
  await page.reload();
  await expectHome(page);
  expect(writes).toEqual([]);
  const joined = await rejoin(page, fixture.game.code) as V2Response;
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  expect(joined.game.id).toBe(fixture.game.id);
  expect(joined.game.score).toBe(fixture.game.score);
  expect(joined.self.step_progress).toEqual(originalProgress);
  expect(joined.self.hints).toEqual(fixture.self.hints);
  expect(writes).toEqual(["join-game"]);
});

test("자동 시연에서 첫 화면으로 나가면 새로고침해도 시연을 다시 만들지 않는다", async ({ page }) => {
  const created = page.waitForResponse((reply) => reply.url().endsWith("/api/game") &&
    reply.request().postDataJSON()?.action === "create-demo");
  await page.goto("/?auto=1");
  expect((await created).status()).toBe(200);
  await expect(page.getByRole("button", { name: "시연 정지", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "작전 메뉴", exact: true })
    .getByRole("button", { name: "첫 화면으로", exact: true }).click();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/game") || request.method() !== "POST") return;
    const action = request.postDataJSON()?.action as string;
    if (!["get-game", "get-stage"].includes(action)) writes.push(action);
  });
  await expectHome(page);
  expect(new URL(page.url()).searchParams.has("auto")).toBe(false);
  await expect(page.getByRole("button", { name: "자동 시연", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.clock.install();
  await page.clock.fastForward(1500);
  await expectHome(page);
  await page.reload();
  await expectHome(page);
  await page.clock.fastForward(1500);
  await expectHome(page);
  expect(writes).toEqual([]);
});
