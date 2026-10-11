import { expect, test } from "@playwright/test";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";
import { ROLES } from "../../supabase/functions/_shared/types";

test("paper motion opens, collects and cancels without delaying play", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ baseURL, viewport: { width: 390, height: 1300 }, reducedMotion: "no-preference" })));
  let phase = "setup";
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const page of pages) await page.addInitScript(() => {
      localStorage.setItem("hoguk:narration", "off"); localStorage.setItem("hoguk:stop", "off"); localStorage.setItem("hoguk:sound", "off");
    });
    let game = "";
    const call = async (page: typeof pages[number], action: string, extra: Record<string, unknown> = {}) => {
      const response = await page.request.post("/api/game", { data: { action, game_id: game || undefined, stage_id: "gate", request_id: crypto.randomUUID(), ...extra } });
      expect(response.status()).toBe(200);
      return await response.json() as SnapshotV2;
    };
    const created = await call(pages[0], "create-game", { nickname: "모션1" }); game = created.game.id;
    for (let i = 1; i < 4; i++) await call(pages[i], "join-game", { code: created.game.code, nickname: `모션${i + 1}` });
    await call(pages[0], "start-game");
    await expect.poll(async () => (await call(pages[0], "get-game")).game.status).toBe("equip");
    const ready = await Promise.all(pages.map((p) => call(p, "set-ready")));
    const forRole = (role: string) => pages[ready.findIndex((s) => s.self.role === role)];
    const commander = forRole("commander"), signal = forRole("signal"), cipher = forRole("cipher"), scout = forRole("scout");
    await call(commander, "begin-operation");
    for (const page of pages) { await call(page, "report-arrival", { method: "simulated" }); await page.goto("/"); }

    // Observe and pause only decorative WAAPI layers. Never capture inputs or API bodies.
    await signal.evaluate(() => {
      type Capture = { part: string; kind: string; duration: number; last: string; animation: Animation };
      const state = { pause: true, captures: [] as Capture[] };
      Object.assign(window, { paperMotionTest: state });
      const native = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = native.call(this, frames, options);
        const layer = this.closest<HTMLElement>('[data-testid="story-paper-flight"]');
        if (layer) {
          const duration = Number(animation.effect?.getTiming().duration);
          const keyframes = (animation.effect as KeyframeEffect).getKeyframes();
          state.captures.push({ part: (this as HTMLElement).dataset.paperPart ?? "flight", kind: layer.dataset.kind!, duration,
            last: String(keyframes.at(-1)?.transform ?? "none"), animation });
          if (state.pause) { animation.pause(); animation.currentTime = duration * .45; }
        }
        return animation;
      };
    });
    phase = "opening";
    await signal.getByTestId("story-open-clue").click();
    await expect(signal.getByTestId("story-submit").first()).toBeVisible();
    await expect(signal.getByTestId("story-paper-flight")).toHaveAttribute("aria-hidden", "true");
    expect(await signal.getByTestId("story-paper-flight").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    const open = await signal.evaluate(() => (window as unknown as { paperMotionTest: { captures: { part: string; duration: number; last: string }[] } }).paperMotionTest.captures.map(({ part, duration, last }) => ({ part, duration, last })));
    expect(open.find((a) => a.part === "lid")?.last).toBe("rotateX(-165deg)");
    expect(open.find((a) => a.part === "flight")?.duration).toBe(280);
    if (browser.browserType().name() === "chromium") await signal.getByTestId("story-paper-flight").screenshot({ path: "test-results/paper-opening-midpoint.png", animations: "allow" });
    // New navigation cancels the paused overlay, while the clue stays opened.
    phase = "navigation-cancel";
    await signal.getByTestId("story-step-tab-G-03.words").click();
    await expect(signal.getByTestId("story-paper-flight")).toHaveCount(0);
    await signal.getByTestId("story-step-tab-G-03.freq").click();
    await expect(signal.getByTestId("story-open-clue")).toHaveCount(0);

    phase = "keyboard";
    await cipher.getByTestId("story-open-clue").press("Enter");
    await expect(cipher.getByTestId("story-paper-flight")).toHaveCount(0);
    await expect(cipher.getByTestId("story-clue-content").first()).toHaveAttribute("data-motion", "false");

    // The explanation route completes the investigation without entering any private answer.
    phase = "completion-focus";
    for (const level of [1, 2, 3]) await call(commander, "request-hint", { target_role: "signal", level });
    const claim = signal.getByTestId("mission-v2-step-G-03.freq").getByTestId("story-claim");
    await expect(claim).toBeFocused();
    phase = "collection-flight";
    await claim.click();
    await expect(signal.getByTestId("story-step-tab-G-03.freq")).toHaveAttribute("data-collected", "true");
    await expect(signal.getByTestId("story-paper-flight")).toHaveAttribute("data-kind", "collect");
    const destination = await signal.evaluate(() => (window as unknown as { paperMotionTest: { captures: { kind: string; part: string; last: string }[] } }).paperMotionTest.captures.findLast((a) => a.kind === "collect" && a.part === "flight")?.last);
    expect(destination?.startsWith("translate(")).toBe(true);
    phase = "scroll-cancel-and-restore";
    await signal.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await expect(signal.getByTestId("story-paper-flight")).toHaveCount(0);
    await signal.reload();
    await signal.getByTestId("story-step-tab-G-03.freq").click();
    await expect(signal.getByTestId("story-paper-flight")).toHaveCount(0);
    await expect(signal.getByTestId("story-discovery-stamp")).toBeVisible();

    phase = "natural-finish";
    await signal.evaluate(() => {
      Object.assign(window, { finishedPaperLayers: 0 });
      const native = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = native.call(this, frames, options);
        if (this.matches('[data-testid="story-paper-flight"]'))
          void animation.finished.then(() => { (window as unknown as { finishedPaperLayers: number }).finishedPaperLayers++; }, () => {});
        return animation;
      };
    });
    await signal.getByTestId("story-step-tab-G-03.words").click();
    await signal.getByTestId("mission-v2-step-G-03.words").getByTestId("story-claim").click();
    await expect.poll(() => signal.evaluate(() => (window as unknown as { finishedPaperLayers: number }).finishedPaperLayers)).toBe(2);
    await expect(signal.getByTestId("story-paper-flight")).toHaveCount(0);

    phase = "reduced-motion";
    await scout.emulateMedia({ reducedMotion: "reduce" });
    await scout.getByTestId("story-open-clue").click();
    await expect(scout.getByTestId("story-paper-flight")).toHaveCount(0);
    await expect(scout.getByTestId("story-submit").first()).toBeVisible();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const category = ["Timeout", "not visible", "not enabled", "toBe", "toHave", "strict mode"].filter((word) => message.includes(word)).join(", ");
    throw new Error(`Paper motion UI check failed at ${phase} (${category}); answer-bearing page details suppressed`);
  } finally { await Promise.allSettled(contexts.map((c) => c.close())); }
});
