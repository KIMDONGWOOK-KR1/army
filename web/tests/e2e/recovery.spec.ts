import { test, expect, type Page } from "@playwright/test";
async function prepareFinalLock(page: Page) {
  const api = async (action: string, data: Record<string, unknown> = {}) => {
    const res = await page.request.post("/api/game", {
      data: { action, request_id: crypto.randomUUID(), ...data },
    });
    expect(res.ok()).toBe(true);
    return res.json();
  };
  const initial = await api("create-demo", { nickname: "복구시험" }),
    game_id = initial.game.id;
  for (const site_id of ["gate", "yongbong"]) {
    await api("demo-arrival", { game_id, site_id });
    const answers =
      site_id === "gate"
        ? ["2", "1", "51.8", "일요일"]
        : ["3", "용봉관", "19.9", "8"];
    for (const [i, role] of [
      "commander",
      "scout",
      "signal",
      "cipher",
    ].entries()) {
      await api("demo-role", { game_id, demo_role: role });
      await api("submit-report", {
        game_id,
        site_id,
        role,
        answer: answers[i],
      });
    }
    await api("demo-role", { game_id, demo_role: "commander" });
    if (site_id === "gate") {
      await api("open-lock", { game_id, site_id, digits: [2, 1, 3, 7] });
      await api("depart-next-site", { game_id, site_id });
    }
  }
  await page.goto("/");
  await expect(page.locator(".lock-panel")).toBeVisible();
}
test("late mutation response cannot undo returning to the home screen", async ({
  page,
}) => {
  await prepareFinalLock(page);
  let release = () => {};
  const delayed = new Promise<void>((r) => (release = r));
  await page.route("**/api/game", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "open-lock") {
      const response = await route.fetch();
      await delayed;
      await route.fulfill({ response });
    } else await route.continue();
  });
  for (const [i, role] of [
    "지휘관",
    "정찰원",
    "통신원",
    "암호해독관",
  ].entries())
    await page
      .getByRole("textbox", { name: `${role} 잠금 숫자` })
      .fill(["3", "4", "6", "8"][i]);
  await page.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "새 작전 준비하기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 작전 준비하기" }).click();
  release();
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험" }),
  ).toBeEnabled();
  await page.waitForTimeout(600);
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험" }),
  ).toBeVisible();
});
test("startup connection failure is visible and clears after reconnecting", async ({
  page,
}) => {
  await page.route("**/api/game", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".error-banner")).toBeVisible();
  await page.unroute("**/api/game");
  await page.getByRole("button", { name: "다시 연결", exact: false }).click();
  await expect(page.locator(".error-banner")).not.toBeVisible();
});
