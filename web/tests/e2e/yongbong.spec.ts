import { expect, test, type Page } from "@playwright/test";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";
import { ROLES, type Role } from "../../supabase/functions/_shared/types";
import { yongbongDemoInput } from "../../supabase/functions/_shared/yongbong-course-v2";

test("four sessions travel gate to Yongbong, relay records privately and retain outdoor completion", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ baseURL,
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: [
      { name: "hoguk:narration", value: "off" }, { name: "hoguk:stop", value: "off" }, { name: "hoguk:sound", value: "off" },
    ] }] },
  })));
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    let gameId = "", stageId = "gate";
    const call = async (page: Page, action: string, extra: Record<string, unknown> = {}) => {
      const response = await page.request.post("/api/game", { data: { action, game_id: gameId || undefined,
        stage_id: stageId, request_id: crypto.randomUUID(), ...extra } });
      expect(response.status(), action).toBe(200);
      return await response.json() as SnapshotV2;
    };
    const created = await call(pages[0], "create-game", { nickname: "시험1" }); gameId = created.game.id;
    for (let i = 1; i < 4; i++) await call(pages[i], "join-game", { code: created.game.code, nickname: `시험${i + 1}` });
    await call(pages[0], "start-game");
    await expect.poll(async () => (await call(pages[0], "get-game")).game.status).toBe("equip");
    const ready = await Promise.all(pages.map((p) => call(p, "set-ready")));
    const forRole = (role: Role) => pages[ready.findIndex((s) => s.self.role === role)];
    const commander = forRole("commander"), cipher = forRole("cipher");
    await call(commander, "begin-operation");
    for (const role of ROLES) {
      await call(forRole(role), "report-arrival", { method: "simulated" });
    }
    for (const role of ROLES) {
      for (const level of [1, 2, 3]) await call(commander, "request-hint", { target_role: role, level });
      await call(forRole(role), "submit-report"); await call(forRole(role), "confirm-explanation");
    }
    await call(commander, "open-after-explanation");
    await Promise.all(pages.map((p) => p.goto("/")));
    await commander.getByTestId("depart-next-stage").click();
    stageId = "yongbong";
    for (const p of pages) await expect(p.locator('[data-scene="travel"]')).toBeVisible();
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    for (const p of pages) await expect(p.locator('[data-scene="mission"]')).toBeVisible();
    await expect(cipher.getByTestId("shared-material")).toHaveCount(0);
    const input = yongbongDemoInput(created.course.id).privateInput.stages.yongbong;
    const solve = async (role: Role, skip: string[] = []) => {
      const s = await call(forRole(role), "get-stage");
      for (const step of s.self.mission!.steps.filter((s) => !skip.includes(s.id))) {
        const answer = input.steps[step.id].answer ?? Object.fromEntries(step.fields!.map((f) => [f.id, f.id === "created_at" ? "확인 불가" : `[합성] ${role} 기록 ${f.id}`]));
        await call(forRole(role), "submit-step", { step_id: step.id, answer, method: "official_digital", source: { text: "[합성] 확인 출처" } });
      }
    };
    await solve("signal"); await call(forRole("signal"), "submit-report");
    await expect(cipher.getByTestId("shared-material")).toContainText("확인 불가");
    await expect(commander.getByTestId("shared-material")).toHaveCount(0);
    await expect(forRole("scout").getByTestId("shared-material")).toHaveCount(0);
    await commander.getByRole("button", { name: "외부 대체 모드 선택", exact: true }).click();
    await commander.reload();
    await expect(commander.getByTestId("visit-mode")).toContainText("실내 관람 아님");
    // Explicit opt-in capture from this synthetic-only rehearsal; never a cloud session.
    if (process.env.YONGBONG_CAPTURE === "1") {
      await commander.screenshot({ path: "../docs/fe/images/yongbong-outdoor-synthetic.png", fullPage: true });
    }
    await solve("scout"); await call(forRole("scout"), "submit-report");
    await solve("cipher"); await call(cipher, "submit-report");
    // Repeated category inputs are enabled in the actual UI.
    const classify = commander.getByTestId("mission-v2-step-Y-04.classify");
    await expect(classify.locator("select").first()).toBeEnabled();
    const classification = input.steps["Y-04.classify"].answer as Record<string, string>;
    for (const [key, value] of Object.entries(classification)) {
      await classify.getByLabel(`[합성] 카드 ${key.toUpperCase()}`, { exact: true }).selectOption(value);
    }
    await classify.getByLabel("확인 방식", { exact: true }).selectOption("official_digital");
    await classify.getByLabel("확인한 출처", { exact: false }).fill("[합성] 검토 출처");
    await classify.getByRole("button", { name: /제출|기록/ }).click();
    await expect(classify).toContainText("조사 완료");
    await solve("commander", ["Y-04.classify"]); await call(commander, "submit-report");
    const snapshot = await call(commander, "get-stage");
    if (snapshot.stage.completion.type !== "lock") throw new Error("lock required");
    await call(commander, "open-lock", { digits: snapshot.stage.completion.order.map((r) => input.roles[r]!.digit) });
    for (const p of pages) {
      await expect(p.getByTestId("stage-v2-completed")).toContainText("실내 관람 아님");
      await expect(p.getByTestId("depart-next-stage")).toHaveCount(0);
    }
    await cipher.reload();
    await cipher.getByRole("button", { name: "수집한 기록 읽기", exact: true }).click();
    await expect(cipher.getByTestId("journal-v2")).toContainText("실내 관람 아님");
    await expect(cipher.getByTestId("journal-v2").getByTestId("shared-material")).toContainText("확인 불가");
    for (const width of [360, 390, 430]) {
      await cipher.setViewportSize({ width, height: 844 });
      expect(await cipher.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
