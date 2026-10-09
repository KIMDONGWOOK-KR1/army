import { mkdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";
test.use({ storageState: { cookies: [], origins: [] } });

// Only public synthetic fixtures; no server seed or answer module is imported.
test("v2 legacy presentation restores narration, reward, summary and personal journal", async ({ page }) => {
  const fixture = (state: string): V2Response => JSON.parse(readFileSync(new URL(
    `../../../docs/be/fixtures/get-stage.gate.cipher.${state}.json`, import.meta.url,
  ), "utf8"));
  let current = fixture("before-hint");
  current.course.id = "jnu-demo-dev-public-ui";
  current.course.demo = true;
  current.stage.sacho!.id = "legacy-sacho-gate";
  current.game.site_phase = "travel";
  current.game.stage_phase = "travel";
  current.game.arrival_mask = [false, false, false, false];
  await page.addInitScript((id) => {
    localStorage.setItem("hoguk-game", id);
    localStorage.setItem("hoguk:sound", "off");
  }, current.game.id);
  await page.route("**/api/game", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "report-arrival") {
      current.game.site_phase = "mission";
      current.game.stage_phase = "mission";
      current.game.arrival_mask = [true, true, true, true];
      current.version++;
      current.game.version = current.version;
    } else if (!["get-game", "get-stage"].includes(command.action)) {
      await route.fulfill({ status: 405, json: { code: "READ_ONLY_MOCK", message: "화면 확인용 예시다." } });
      return;
    }
    await route.fulfill({ status: 200, json: current });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "기록", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "본인 모의 도착 확인", exact: true }).click({ noWaitAfter: true });
  await expect(page.locator(".stop-screen")).toBeVisible();
  await page.getByRole("button", { name: "닫고 계속", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole("dialog", { name: "기록", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();

  const completed = fixture("stage-completed");
  completed.course.id = current.course.id;
  completed.stage.sacho!.id = "legacy-sacho-gate";
  const body = "[합성] 네 역할이 정문의 자료를 확인하고 함께 기록을 복원했다.";
  for (const site of [completed.current_site, ...completed.course.sites, ...completed.game.acquired_sites]) {
    if (site.id === "gate") site.sacho = { ...site.sacho, char: "記", body };
  }
  completed.version = current.version + 1;
  completed.game.version = completed.version;
  current = completed;
  await page.reload();
  await expect(page.getByRole("dialog", { name: "기록", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("stage-v2-completed")).toContainText(body);
  await page.getByRole("button", { name: "정문 결과 보기", exact: true }).click({ noWaitAfter: true });
  await expect(page.locator('[data-scene="done"]')).toContainText("정문 확인 완료");
  await page.getByRole("button", { name: "수집한 기록 읽기", exact: true }).click({ noWaitAfter: true });
  const journal = page.getByTestId("journal-v2");
  await expect(journal).toContainText(body);
  await expect(journal).toContainText("내 조사 기록");
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await journal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  if (process.env.CAPTURE_PUBLIC_FIXTURE === "1") {
    mkdirSync(".demo-data", { recursive: true });
    await page.screenshot({ path: ".demo-data/restored-journal-public.png", animations: "disabled" });
  }
});
