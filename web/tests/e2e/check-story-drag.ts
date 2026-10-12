import { expect, type Locator, type Page } from "@playwright/test";

async function gesture(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, touch: boolean, cancel = false) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
      for (let i = 1; i <= 16; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16, id: 1 }] });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    } finally { await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach(); }
  } else {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(from.x + (to.x - from.x) * i / 16, from.y + (to.y - from.y) * i / 16);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    }
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
}
async function center(locator: Locator) {
  const r = await locator.boundingBox(); if (!r) throw new Error("Drag target missing");
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Deliberately arbitrary drafts. No solution, submission or private data capture. */
export async function checkOrderDrag(page: Page, form: Locator, stepId: string, chromium: boolean, checkLayout: (page: Page) => Promise<void>) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const n of [1, 2]) await form.getByTestId(`order-choice-${stepId}-${n}`).click();
  await checkLayout(page);
  if (chromium) await form.getByTestId("story-order").screenshot({ path: "test-results/drag-order-draft.png" });
  const order = () => form.locator('[data-testid^="order-card-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  const moveFirst = async (touch: boolean, cancel = false) => {
    const rows = form.locator('[data-testid^="order-card-"]');
    await rows.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await rows.first().locator('[data-testid^="order-grip-"]').hover();
    const first = await center(rows.first()), second = await center(rows.nth(1));
    const from = await center(rows.first().locator('[data-testid^="order-grip-"]'));
    await gesture(page, from, { x: from.x, y: from.y + second.y - first.y + 24 }, touch, cancel);
  };
  await moveFirst(false);
  await expect.poll(order).toEqual(["order-card-2", "order-card-1"]);
  if (chromium) {
    await moveFirst(true);
    await expect.poll(order).toEqual(["order-card-1", "order-card-2"]);
  }
  const before = await order();
  await moveFirst(false, true);
  await expect.poll(order).toEqual(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(form.locator('[data-testid^="order-grip-"]')).toHaveCount(0);
  await form.getByRole("button", { name: "2번째 카드 위로", exact: true }).press("Enter");
  await expect.poll(order).toEqual([...before].reverse());
  expect(await form.locator('[data-testid^="order-card-"]').first().evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  for (const _ of [1, 2]) await form.getByRole("button", { name: "1번째 카드 빼기", exact: true }).click();
}

export async function checkWordDrag(page: Page, chromium: boolean, checkLayout: (page: Page) => Promise<void>) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const tray = page.getByTestId("story-word-tray"), target = page.getByRole("button", { name: "낱말 자리 2", exact: true });
  await tray.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await checkLayout(page);
  if (chromium) await tray.screenshot({ path: "test-results/drag-word-tray.png" });
  await tray.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const initial = await target.textContent();
  const grip = page.getByTestId("joint-grip-1");
  await gesture(page, await center(grip), await center(target), false, true);
  await expect(target).toHaveText(initial!);
  await gesture(page, await center(page.getByTestId("joint-grip-1")), await center(target), chromium);
  const word = await page.getByTestId("joint-word-1").textContent();
  await expect(target).toContainText(word!.replace("✓", ""));
  await expect(tray.locator('[data-drop-target="true"]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(tray.locator('[data-testid^="joint-grip-"]')).toHaveCount(0);
}
