import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";
import { ROLE_NAMES, ROLES, type Role } from "../../supabase/functions/_shared/types";

// Public synthetic snapshots only: no real course, private source, answer or
// deployed backend is read. Do not retain page/network artifacts for this flow.
const COMMON = "[합성] 정문 공통 안내입니다. 각자의 임무를 확인합니다.";
const PERSONAL: Record<Role, string> = {
  commander: "[합성] 지휘관만 읽는 개인 안내입니다. 팀의 진행을 확인합니다.",
  scout: "[합성] 정찰원만 읽는 개인 안내입니다. 주변 표식을 살펴봅니다.",
  signal: "[합성] 통신원만 읽는 개인 안내입니다. 전달 장비를 확인합니다.",
  cipher: "[합성] 암호해독관만 읽는 개인 안내입니다. 기호 자료를 살펴봅니다.",
};
const commonDialog = (page: Page) => page.locator('.narration[data-narration-kind="common"]');
const personalDialog = (page: Page) => page.locator('.narration[data-narration-kind="personal"]');

function fixtureFor(role: Role): V2Response {
  const fixture = JSON.parse(readFileSync(new URL(
    `../../../docs/be/fixtures/get-stage.gate.${role}.before-hint.json`,
    import.meta.url,
  ), "utf8")) as V2Response;
  fixture.game.id = `mock-narration-${role}`;
  fixture.stage.narration = [{
    id: "MOCK-GATE.shared-intro", channel: "screen", trigger: "enter", text: COMMON,
  }];
  fixture.self.mission!.intro.text = PERSONAL[role];
  fixture.self.mission!.scenes = [];
  return fixture;
}

async function renderFixture(page: Page, fixture: V2Response, enabled = true) {
  const writes: string[] = [];
  await page.context().route("**/api/game", async (route) => {
    const command = route.request().postDataJSON() as { action?: string };
    if (command.action === "get-game" || command.action === "get-stage") {
      await route.fulfill({ status: 200, json: fixture });
    } else {
      writes.push(command.action ?? "unknown");
      await route.fulfill({ status: 405, json: { code: "READ_ONLY_MOCK" } });
    }
  });
  await page.addInitScript(({ gameId, enabled }) => {
    localStorage.setItem("hoguk-game", gameId);
    localStorage.setItem("hoguk:narration", enabled ? "on" : "off");
    localStorage.setItem("hoguk:stop", "off");
    localStorage.setItem("hoguk:sound", "off");
  }, { gameId: fixture.game.id, enabled });
  await page.goto("/");
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  return writes;
}

async function expectPrivateCopyOnly(page: Page, role: Role) {
  await expect(personalDialog(page)).toHaveAccessibleName(`${ROLE_NAMES[role]} 개인 임무`);
  await expect(personalDialog(page).locator(".narration-text")).toHaveText(PERSONAL[role]);
  for (const other of ROLES.filter((candidate) => candidate !== role)) {
    // Check textContent, including hidden DOM, not merely visible elements.
    await expect(page.locator("body")).not.toContainText(PERSONAL[other]);
  }
}

async function expectButtonInsideViewport(page: Page, button: Locator) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  const width = await page.locator("html").evaluate((root) => root.scrollWidth);
  expect(width).toBeLessThanOrEqual(viewport.width + 1);
}

test.use({ reducedMotion: "reduce", trace: "off", screenshot: "off", video: "off" });

for (const role of ROLES) {
  test(`${role}: 공통 안내 다음 본인 개인 안내만 보고 미션을 시작한다`, async ({ page }) => {
    const writes = await renderFixture(page, fixtureFor(role));
    await expect(commonDialog(page).locator(".narration-text")).toHaveText(COMMON);
    await expect(personalDialog(page)).toHaveCount(0);
    await commonDialog(page).getByRole("button", { name: "계속", exact: true }).click();
    await expect(commonDialog(page)).toHaveCount(0);
    await expectPrivateCopyOnly(page, role);
    await personalDialog(page).getByRole("button", { name: "임무 시작", exact: true }).click();
    await expect(page.locator(".narration")).toHaveCount(0);
    await expect(page.locator(".mission-header .role-badge")).toHaveText(ROLE_NAMES[role]);
    expect(writes).toEqual([]);
  });
}

test("공통 확인 뒤 재접속하면 개인 안내부터 이어지고 완료 뒤에는 반복하지 않는다", async ({ page }) => {
  await renderFixture(page, fixtureFor("scout"));
  await commonDialog(page).getByRole("button", { name: "계속", exact: true }).click();
  await expectPrivateCopyOnly(page, "scout");
  await page.reload();
  await expectPrivateCopyOnly(page, "scout");
  await expect(commonDialog(page)).toHaveCount(0);
  await personalDialog(page).getByRole("button", { name: "임무 시작", exact: true }).click();
  await expect(page.locator(".narration")).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await expect(page.locator(".narration")).toHaveCount(0);
});

test("나레이션 끄기 옵션은 공통·개인 화면을 함께 건너뛴다", async ({ page }) => {
  const fixture = fixtureFor("signal");
  await renderFixture(page, fixture, false);
  await expect(page.locator(".narration")).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage)
    .filter((key) => key.startsWith("hoguk:narration-seen:")))).toEqual([]);
});

test("개인 임무를 아직 받지 못했을 때는 공통 안내만 표시한다", async ({ page }) => {
  const fixture = fixtureFor("cipher");
  fixture.self.mission = null;
  await renderFixture(page, fixture);
  await expect(commonDialog(page).locator(".narration-text")).toHaveText(COMMON);
  await commonDialog(page).getByRole("button", { name: "계속", exact: true }).click();
  await expect(page.locator(".narration")).toHaveCount(0);
  for (const personal of Object.values(PERSONAL)) {
    await expect(page.locator("body")).not.toContainText(personal);
  }
});

test("나중에 본인 임무가 도착하면 이미 읽은 공통 안내 없이 개인 안내를 표시한다", async ({ page }) => {
  const fixture = fixtureFor("commander");
  const mission = fixture.self.mission;
  fixture.self.mission = null;
  await renderFixture(page, fixture);
  await commonDialog(page).getByRole("button", { name: "계속", exact: true }).click();
  await expect(page.locator(".narration")).toHaveCount(0);
  fixture.self.mission = mission;
  fixture.version += 1;
  fixture.game.version += 1;
  // The normal local refresh must notice the new self projection without
  // closing the page or resetting the user's narration progress.
  await expectPrivateCopyOnly(page, "commander");
  await expect(commonDialog(page)).toHaveCount(0);
});

for (const length of ["short", "long"] as const) {
  test(`360px ${length} 개인 안내에서도 본문과 계속 버튼이 화면 안에 있다`, async ({ page }) => {
    const fixture = fixtureFor("scout");
    const copy = length === "short"
      ? PERSONAL.scout
      : Array.from({ length: 30 }, (_, index) => `[합성] 개인 안내 ${index + 1}. 읽는 영역을 스크롤해 안내를 확인합니다.`).join("\n");
    fixture.self.mission!.intro.text = copy;
    await page.setViewportSize({ width: 360, height: 640 });
    await renderFixture(page, fixture);
    await expectButtonInsideViewport(page, commonDialog(page).getByRole("button", { name: "계속", exact: true }));
    await commonDialog(page).getByRole("button", { name: "계속", exact: true }).click();
    const personal = personalDialog(page);
    await expect(personal.locator(".narration-text")).toHaveText(copy, { useInnerText: true });
    if (length === "long") {
      const body = personal.locator(".narration-body");
      expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await personal.locator(".narration-line").last().scrollIntoViewIfNeeded();
      await expect(personal.locator(".narration-line").last()).toBeInViewport();
    }
    const start = personal.getByRole("button", { name: "임무 시작", exact: true });
    await expectButtonInsideViewport(page, start);
    await expect(start).toBeFocused();
    await start.click();
    await expect(page.locator(".narration")).toHaveCount(0);
  });
}
