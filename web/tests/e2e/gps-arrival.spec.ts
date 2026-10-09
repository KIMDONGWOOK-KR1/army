import { expect, test, type Page } from "@playwright/test";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";
import { JNU_GPS_POINTS } from "../../supabase/functions/_shared/jnu-gps";

// Synthetic browser positions and isolated local rooms only. Never record private responses.
test("four GPS arrivals unlock missions; outside, denied, stale and noisy fixes cannot", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({
    baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: [
      { name: "hoguk:narration", value: "off" }, { name: "hoguk:stop", value: "off" },
      { name: "hoguk:sound", value: "off" },
    ] }] },
  })));
  try {
    for (const context of contexts) await context.addInitScript(() => {
      const listeners = new Map<number, { success: PositionCallback; error?: PositionErrorCallback | null }>();
      let seq = 0;
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
        watchPosition(success: PositionCallback, error?: PositionErrorCallback | null) {
          listeners.set(++seq, { success, error }); return seq;
        },
        clearWatch(id: number) { listeners.delete(id); },
      } });
      Object.assign(window, { emitGps(lat: number, lng: number, accuracy: number, age: number, denied: boolean) {
        listeners.forEach(({ success, error }) => denied
          ? error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
          : success({ timestamp: Date.now() - age, coords: { latitude: lat, longitude: lng, accuracy,
            altitude: null, altitudeAccuracy: null, heading: null, speed: null }, toJSON() { return {}; } } as GeolocationPosition));
      } });
    });
    const pages = await Promise.all(contexts.map(c => c.newPage()));
    let id = "", positionSent = false;
    const arrivals = [0, 0, 0, 0];
    for (const [i, page] of pages.entries()) page.on("request", request => {
      if (!request.url().endsWith("/api/game") || request.method() !== "POST") return;
      const body = request.postDataJSON();
      if (["lat", "lng", "accuracy", "coords", "position", "latitude", "longitude"].some(k => k in body)) positionSent = true;
      if (body.action === "report-arrival") arrivals[i]++;
    });
    const call = async (page: Page, action: string, extra: Record<string, unknown> = {}) => {
      const response = await page.request.post("/api/game", { data: {
        action, game_id: id || undefined, stage_id: "gate", request_id: crypto.randomUUID(), ...extra,
      } });
      expect(response.status(), action).toBe(200);
      return await response.json() as SnapshotV2;
    };
    const created = await call(pages[0], "create-game", { nickname: "시험1" });
    id = created.game.id;
    for (let i = 1; i < 4; i++) await call(pages[i], "join-game", { code: created.game.code, nickname: `시험${i+1}` });
    await call(pages[0], "start-game");
    await expect.poll(async () => (await call(pages[0], "get-game")).game.status).toBe("equip");
    const ready = await Promise.all(pages.map(p => call(p, "set-ready")));
    const commanderIndex = ready.findIndex(s => s.self.role === "commander");
    await call(pages[commanderIndex], "begin-operation");
    for (const page of pages) {
      await page.goto("/");
      await expect(page.locator('[data-scene="travel"]')).toBeVisible();
      await expect(page.getByRole("button", { name: /수동 도착|모의 도착/ })).toHaveCount(0);
      await expect(page.locator(".hud-distance")).toContainText("반경 10m");
      await page.getByRole("button", { name: "GPS 위치 확인 · 반경 10m", exact: true }).click({ noWaitAfter: true });
    }
    const target = JNU_GPS_POINTS.gate;
    const emit = async (page: Page, offset = 0, accuracy = 5, age = 0, denied = false) => {
      await page.evaluate(({ target, offset, accuracy, age, denied }) => {
        (window as unknown as { emitGps: (lat: number, lng: number, accuracy: number, age: number, denied: boolean) => void })
          .emitGps(target.lat + offset, target.lng, accuracy, age, denied);
      }, { target, offset, accuracy, age, denied });
    };
    // Four independent failure modes. All must leave the server locked.
    for (let i = 0; i < 8; i++) {
      await Promise.all([emit(pages[0], .002), emit(pages[1], 0, 41), emit(pages[2], 0, 5, 10000), emit(pages[3], 0, 5, 0, true)]);
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
    expect(arrivals).toEqual([0, 0, 0, 0]);
    await expect(pages[3].locator(".hud-gps")).toContainText("위치 권한이 꺼져 있다");
    await expect(pages[0].locator(".hud-distance")).not.toContainText("도착 범위 안");
    await pages[0].screenshot({ path: ".demo-data/gps-travel-public.png" });
    // Three participants enter. The fourth still waits outside.
    for (let i = 0; i < 8; i++) {
      await Promise.all(pages.map((p, n) => emit(p, n === 3 ? .002 : 0)));
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
    await expect.poll(async () => (await call(pages[0], "get-game")).game.arrival_mask.filter(Boolean).length).toBe(3);
    for (const page of pages) await expect(page.locator('[data-scene="travel"]')).toBeVisible();
    const roleBefore = ready[0].self.role;
    await pages[0].reload();
    await expect(pages[0].getByRole("button", { name: /내 도착 확인됨 · 팀원 대기 \(3\/4\)/ })).toBeVisible();
    expect((await call(pages[0], "get-game")).self.role).toBe(roleBefore);
    for (let i = 0; i < 11; i++) {
      await emit(pages[3]);
      await new Promise(resolve => setTimeout(resolve, 1050));
    }
    await expect.poll(async () => (await call(pages[0], "get-game")).game.site_phase).toBe("mission");
    for (const page of pages) await expect(page.locator('[data-scene="mission"]')).toBeVisible();
    expect(arrivals).toEqual([1, 1, 1, 1]);
    expect(positionSent).toBe(false);
    await pages[0].reload();
    await expect(pages[0].locator('[data-scene="mission"]')).toBeVisible();
  } finally {
    await Promise.all(contexts.map(c => c.close()));
  }
});
