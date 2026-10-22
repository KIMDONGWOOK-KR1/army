import { plain } from "../../lib/practice-text";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";
import type { Role } from "../../supabase/functions/_shared/types";

const placeholder = "/images/course-material-placeholder.svg";
const fixture = (role: Role): V2Response => {
  const snapshot = JSON.parse(readFileSync(new URL(
    `../../../docs/be/fixtures/get-stage.gate.${role}.before-hint.json`, import.meta.url,
  ), "utf8")) as V2Response;
  snapshot.course.demo = true;
  snapshot.course.id = "jnu-demo-dev-image-test";
  return snapshot;
};

// Public synthetic fixtures only; image and game responses never contact a deployed backend.
for (const path of ["/", "/verify"]) {
  test(`사진 자료 ${path}: 누락·실패 대체와 자료 교체, 역할별 표시`, async ({ page }) => {
    let current = fixture("scout");
    delete current.self.mission!.asset;
    await page.addInitScript((gameId) => {
      localStorage.setItem("hoguk-game", gameId);
      localStorage.setItem("hoguk-v2-game", gameId);
      localStorage.setItem("hoguk:narration", "off");
      localStorage.setItem("hoguk:stop", "off");
      localStorage.setItem("hoguk:sound", "off");
    }, current.game.id);
    await page.route("**/api/game", (route) => route.fulfill({ status: 200, json: current }));
    await page.route("https://example.com/missing-material.png", (route) => route.fulfill({ status: 404, body: "" }));
    await page.route("https://example.com/material.svg", (route) => route.fulfill({
      status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>',
    }));
    const material = page.getByTestId("mission-asset");
    const img = material.locator("img");
    await page.goto(path);
    await expect(material).toHaveAttribute("data-temporary", "true");
    await expect(img).toHaveJSProperty("src", new URL(placeholder, page.url()).href);
    await expect.poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(material).toContainText("임시 이미지 · 실제 현장 자료 아님");
    await page.setViewportSize({ width: 360, height: 844 });
    expect(await material.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    current.self.mission!.asset = { url: `https://example.com${placeholder}`, alt: "임시 이미지", confirmed: true };
    await page.reload();
    await expect(img).toHaveJSProperty("src", new URL(placeholder, page.url()).href);

    current.self.mission!.asset = { url: "https://example.com/missing-material.png", alt: "[합성] 사진 자료", confirmed: true };
    await page.reload();
    await expect(material).toContainText("사진을 불러오지 못해");
    await expect(img).toHaveJSProperty("src", new URL(placeholder, page.url()).href);

    current.self.mission!.asset = { url: "https://example.com/material.svg", alt: "[합성] 교체한 사진 자료", confirmed: true };
    await page.reload();
    await expect(material).toHaveAttribute("data-temporary", "false");
    await expect(img).toHaveAttribute("src", "https://example.com/material.svg");
    await expect.poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
    await expect(material).not.toContainText("임시 이미지");

    current.stage.id = "yongbong";
    current.current_site.id = "yongbong";
    current.self.mission!.asset = { url: null, alt: "[합성] 사진 자료", confirmed: false };
    await page.reload();
    await expect(img).toHaveJSProperty("src", new URL(placeholder, page.url()).href);
    await expect(material).toHaveAttribute("data-temporary", "true");

    current = fixture("signal");
    delete current.self.mission!.asset;
    await page.reload();
    await expect(page.getByText(path === "/" ? plain(current.self.mission!.steps[0].prompt) : current.self.mission!.steps[0].prompt, { exact: true })).toBeVisible();
    await expect(material).toHaveCount(0);
  });
}
