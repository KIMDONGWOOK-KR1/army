import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";
import type { Role } from "../../supabase/functions/_shared/types";

// Existing isolated synthetic integration server; four independent local sessions.
// No answers, uploads, deployed backend or retained browser artifacts are used.
test.use({ trace: "off", screenshot: "off", video: "off" });

test("local opt-in photo mock gates StoryMission and three failures leave the real mission unsolved", async ({ browser, baseURL }) => {
  const contexts: BrowserContext[] = [];
  const call = async (context: BrowserContext, action: string, extra: Record<string, unknown> = {}) => {
    const response = await context.request.post("/api/game", {
      data: { action, request_id: randomUUID(), ...extra },
    });
    expect(response.status(), action).toBe(200);
    return await response.json() as V2Response;
  };
  try {
    for (let index = 0; index < 4; index++) contexts.push(await browser.newContext({
      baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    }));
    const created = await call(contexts[0], "create-game", { nickname: "사진시연1" });
    const game_id = created.game.id;
    for (let index = 1; index < 4; index++) await call(contexts[index], "join-game", {
      code: created.game.code, nickname: `사진시연${index + 1}`,
    });
    await call(contexts[0], "start-game", { game_id });
    await expect.poll(async () => (await call(contexts[0], "get-game", { game_id })).game.status,
      { timeout: 15000, intervals: [500, 1000] }).toBe("equip");
    const roles = {} as Record<Role, BrowserContext>;
    for (const context of contexts) {
      const ready = await call(context, "set-ready", { game_id });
      roles[ready.self.role!] = context;
    }
    await call(roles.commander, "begin-operation", { game_id });
    for (const context of contexts) await call(context, "report-arrival", {
      game_id, stage_id: "gate", method: "simulated",
    });
    const before = await call(roles.scout, "get-game", { game_id });
    expect(before.self.mission!.steps.every((step) => !step.id.endsWith(".legacy"))).toBe(true);
    const page = await roles.scout.newPage();
    await page.addInitScript((id) => {
      localStorage.setItem("hoguk-game", id);
      localStorage.setItem("hoguk:narration", "off");
      localStorage.setItem("hoguk:stop", "off");
      localStorage.setItem("hoguk:sound", "off");
    }, game_id);
    await page.goto("/");
    // A normal four-person local room does not silently acquire a mock requirement.
    await expect(page.getByTestId("story-workbench")).toBeVisible();
    await expect(page.getByTestId("scout-scan")).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem("hoguk:photo-gate", "on"));
    await page.reload();
    const scan = page.getByTestId("scout-scan");
    await expect(scan).toBeVisible();
    await expect(scan).toContainText("합성 단서");
    await expect(page.getByTestId("scout-scan-locked")).toBeVisible();
    await expect(page.getByTestId("story-workbench")).toHaveCount(0);
    await expect(page.locator('[data-testid^="mission-v2-step-"]')).toHaveCount(0);
    for (const count of [1, 2, 3]) {
      await scan.getByRole("button", { name: /촬영할 수 없어요/ }).click();
      await scan.getByRole("button", { name: "알리기", exact: true }).click();
      if (count < 3) {
        await expect(scan).toContainText(`실패 ${count} / 3`);
        await expect(page.getByTestId("story-workbench")).toHaveCount(0);
      }
    }
    await expect(page.getByTestId("scout-scan-result")).toHaveAttribute("data-verified", "false");
    await expect(page.getByTestId("scout-scan-result")).toContainText("사진 검증 실패 후 통과");
    await expect(page.getByTestId("scout-scan-locked")).toHaveCount(0);
    await expect(page.getByTestId("story-workbench")).toBeVisible();
    const firstStep = page.getByTestId(`mission-v2-step-${before.self.mission!.steps[0].id}`);
    await expect(firstStep).toBeVisible();
    await firstStep.getByTestId("story-open-clue").click();
    await expect(firstStep.getByTestId("story-clue-content")).toBeVisible();
    for (const label of ["확인 방식", "확인한 출처", "연결할 자료 (선택)"])
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(page.locator(".hud-score")).toContainText(String(before.game.score));
    const after = await call(roles.scout, "get-game", { game_id });
    expect(after.self.step_progress).toEqual(before.self.step_progress);
    expect(after.self.reported).toBe(false);
    expect(after.game.score).toBe(before.game.score);
    expect(after.game.report_mask).toEqual(before.game.report_mask);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
