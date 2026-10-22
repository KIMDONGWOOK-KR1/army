import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";

// Public synthetic fixture only. No live backend, scenario, location, secret,
// answer or retained browser artifact is used by these pending-state checks.
function pendingWallFixture(): V2Response {
  const fixture = JSON.parse(readFileSync(new URL(
    "../../../docs/be/fixtures/get-stage.gate.scout.before-hint.json",
    import.meta.url,
  ), "utf8")) as V2Response;
  fixture.course.id = "jnu-demo-dev-review-gps-mock-r1";
  fixture.course.name = "[합성] GPS 검수 코스";
  fixture.current_site = {
    ...fixture.current_site,
    id: "wall", seq: 3, name: "[합성] 추모의 벽",
    lat: null, lng: null, reverent: true,
  };
  fixture.course.sites = [fixture.current_site];
  fixture.stage = {
    ...fixture.stage,
    id: "wall", seq: 3, name: fixture.current_site.name,
    kind: "memorial", quiet: true,
    narration: [],
    arrival: {
      ...fixture.stage.arrival,
      mode: "gps", confirmed: false, lat: null, lng: null,
    },
    completion: { type: "tribute", label: "국화 올리기" },
  };
  fixture.game = {
    ...fixture.game,
    id: "mock-gps-pending-wall",
    stage_id: "wall", current_site_seq: 3,
    stage_kind: "memorial", quiet: true,
    site_phase: "travel", stage_phase: "travel",
    arrival_mask: [false, false, false, false],
  };
  fixture.self.mission = null;
  fixture.self.clue = null;
  fixture.self.lock = null;
  return fixture;
}

test.use({ trace: "off", screenshot: "off", video: "off" });

for (const path of ["/", "/verify"]) {
  test(`GPS 검수 ${path}: 좌표 미확정 거점은 지도·도착 버튼 없이 대기한다`, async ({ page }) => {
    const fixture = pendingWallFixture();
    const writes: string[] = [];
    await page.context().route("**/api/game", async (route) => {
      const action = route.request().postDataJSON()?.action as string | undefined;
      if (action === "get-game" || action === "get-stage") {
        await route.fulfill({ status: 200, json: fixture });
      } else {
        writes.push(action ?? "unknown");
        await route.fulfill({ status: 405, json: { code: "READ_ONLY_MOCK" } });
      }
    });
    await page.addInitScript(({ gameId }) => {
      localStorage.setItem("hoguk-game", gameId);
      localStorage.setItem("hoguk-v2-game", gameId);
      localStorage.setItem("hoguk:narration", "off");
      localStorage.setItem("hoguk:stop", "off");
      localStorage.setItem("hoguk:sound", "off");
    }, { gameId: fixture.game.id });
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "[합성] 추모의 벽 GPS 좌표 등록 대기", exact: true })).toBeVisible();
    await expect(page.getByTestId("gps-review-pending")).toBeVisible();
    await expect(page.locator(".field-3d, .travel-hud")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /GPS 위치 확인|위치 확인|모의 도착|시연 거점에 도착/ })).toHaveCount(0);
    await expect(page.getByText("정식 콘텐츠 GPS 검수", { exact: false }).first()).toBeVisible();
    expect(writes).toEqual([]);
  });
}
