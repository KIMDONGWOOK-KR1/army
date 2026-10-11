import { expect, test } from "@playwright/test";
import { ROLE_NAMES, ROLES } from "../../supabase/functions/_shared/types";

test("solo entrance follows MINO through Yongbong, memorial, Bongji and final consent", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hoguk:narration", "off");
    localStorage.setItem("hoguk:stop", "off");
    localStorage.setItem("hoguk:sound", "off");
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL!);
  await page.getByRole("button", { name: "혼자 데모 체험", exact: true }).click();
  const roleBar = page.getByLabel("시연 보직 전환");
  const role = async (r: typeof ROLES[number]) => {
    const button = roleBar.getByRole("button", { name: ROLE_NAMES[r], exact: true });
    await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true");
  };
  for (const site of ["gate", "yongbong"]) {
    await page.getByRole("button", { name: "시연 거점에 도착", exact: true }).click();
    await expect(page.locator('[data-scene="mission"]')).toBeVisible();
    await page.getByTestId("story-help").locator("summary").click();
    for (const r of ROLES) for (const level of [1, 2, 3])
      await page.getByRole("button", { name: `${ROLE_NAMES[r]} ${level}단계 힌트`, exact: true }).click();
    for (const r of ["scout", "signal", "cipher", "commander"] as const) {
      await role(r);
      await page.getByTestId("story-help").locator("summary").click();
      await page.getByRole("button", { name: "내 해설 읽음 확인", exact: true }).click();
      await page.getByRole("button", { name: "조사 결과 보고", exact: true }).click();
    }
    await page.getByRole("button", { name: "팀 자물쇠로", exact: true }).click();
    await page.getByRole("button", { name: "해설 확인 후 복원", exact: true }).click();
    await expect(page.getByTestId("stage-v2-completed")).toBeVisible();
    if (site === "yongbong") {
      await expect(page.getByTestId("next-stop")).toContainText("용봉열사 추모의 벽");
      await expect(page.getByRole("button", { name: "새 작전 준비하기" })).toHaveCount(0);
      await page.screenshot({ path: `test-results/solo-yongbong-next-${test.info().project.name}.png` });
    }
    await page.getByTestId("depart-next-stage").click();
    if (site === "gate" && test.info().project.name === "chromium") {
      await expect(page.locator(".field-3d canvas")).toBeVisible({ timeout: 30000 });
      // Sample the moving avatar on both sides of the avenue; these captures
      // contain only the map, never a mission answer or a private lock digit.
      await page.waitForTimeout(18000);
      await page.screenshot({ path: "test-results/solo-walk-avenue.png" });
      await page.waitForTimeout(18000);
      await page.screenshot({ path: "test-results/solo-walk-crossing.png" });
    }
  }
  await page.getByRole("button", { name: "시연 거점에 도착", exact: true }).click();
  await page.getByRole("button", { name: "묵념 마치기", exact: true }).click();
  for (const r of ["scout", "signal", "cipher", "commander"] as const) {
    await role(r);
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "팀 자물쇠로" })).toHaveCount(0);
    await page.getByRole("button", { name: "국화 올리기", exact: true }).click();
  }
  await expect(page.getByTestId("stage-v2-completed")).toBeVisible();
  await page.getByTestId("depart-next-stage").click();
  await page.getByRole("button", { name: "시연 거점에 도착", exact: true }).click();
  for (const r of ["scout", "signal", "cipher", "commander"] as const) {
    await role(r);
    await expect(page.getByLabel("개인 회고 본문", { exact: true })).toHaveValue("");
    await page.getByLabel("개인 회고 본문", { exact: true }).fill(`혼자 체험 ${r} 회고`);
    await page.getByRole("button", { name: "회고 저장", exact: true }).click();
  }
  await page.getByRole("button", { name: "공동 기록 작성", exact: true }).click();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole("button", { name: `낱말 자리 ${i}`, exact: true }).click();
    await page.getByTestId(`joint-word-${i}`).click();
  }
  await expect(page.getByTestId("joint-preview")).toContainText("민주주의는 개인의");
  await page.getByLabel("공동 근거", { exact: true }).fill("시연용 기록과 헌화, 네 보직의 회고");
  await page.getByRole("button", { name: "공동 기록 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "공동 기록 수정", exact: true })).toBeVisible();
  await expect(page.getByTestId("joint-record")).toContainText("기록 버전 1");
  for (const r of ROLES) {
    await role(r); await page.getByRole("button", { name: "공동 기록에 동의", exact: true }).click();
  }
  await expect(page.getByTestId("result-v2")).toContainText("조사 3/3 · 사초 3/3");
  await expect(page.getByTestId("final-joint-record")).toContainText("회고 4/4 · 동의 4/4");
  await page.reload(); await expect(page.getByTestId("result-v2")).toBeVisible();
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
