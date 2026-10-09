import { test, expect } from "@playwright/test";

// 폰은 백그라운드로 가거나 메모리가 모자라면 WebGL 문맥을 잃는다. 잃었다 되찾아도
// 필드가 페이지 오류 없이 새 렌더러로 다시 떠야 한다(field-3d.tsx onRestore).
test("WebGL 문맥을 잃었다 되찾아도 필드가 오류 없이 다시 뜬다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "혼자 데모 체험", exact: true })
    .click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();

  // WebGL을 못 쓰는 환경에서는 필드 대신 그림이 뜨므로 건너뛴다
  const canvas = page.locator(".field-3d canvas");
  const hasField = await canvas
    .first()
    .waitFor({ state: "attached", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasField, "WebGL 필드가 뜨지 않는 환경");
  await page.waitForTimeout(1500);

  const lost = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(".field-3d canvas");
    const gl = c?.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return false;
    c!.dataset.old = "1"; // 잃은 캔버스 표시: 되찾은 뒤 새 캔버스로 바뀌는지 본다
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
    return true;
  });
  test.skip(!lost, "WEBGL_lose_context를 쓸 수 없는 환경");
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext(),
  );

  // 잃었던 캔버스는 빠지고 새 렌더러 캔버스 하나가 다시 붙으며, 그 문맥은 살아 있다
  await expect(page.locator(".field-3d canvas[data-old]")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(canvas).toHaveCount(1);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>(".field-3d canvas");
          const gl = c?.getContext("webgl2");
          return !!gl && !gl.isContextLost();
        }),
      { timeout: 20000 },
    )
    .toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  expect(errors).toEqual([]);
});
