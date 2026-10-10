import { expect, test, type Page } from "@playwright/test";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";
import { ROLES, type Role } from "../../supabase/functions/_shared/types";
import { fullDemoV2Input } from "../../supabase/functions/_shared/wall-bongji-course-v2";

test("four sessions complete memorial and reflections, refresh consent versions and see private results", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ baseURL,
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: [
      { name: "hoguk:narration", value: "off" }, { name: "hoguk:stop", value: "off" }, { name: "hoguk:sound", value: "on" },
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
    const commander = forRole("commander"); await call(commander, "begin-operation");
    for (const id of ["gate", "yongbong"]) {
      stageId = id;
      for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
      for (const role of ["scout", "signal", "cipher", "commander"] as const) {
        for (const level of [1, 2, 3]) await call(commander, "request-hint", { target_role: role, level });
        await call(forRole(role), "submit-report"); await call(forRole(role), "confirm-explanation");
      }
      await call(commander, "open-after-explanation"); await call(commander, "depart-next-site");
    }
    console.log("Synthetic full-course: entering wall");
    stageId = "wall";
    for (const p of pages) await p.goto("/");
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    for (const p of pages) {
      await expect(p.locator('[data-scene="mission"]')).toBeVisible();
      await expect(p.locator(".hud-score")).toHaveCount(0);
      await expect(p.getByRole("button", { name: "팀 자물쇠로" })).toHaveCount(0);
      await p.evaluate(() => {
        (window as unknown as { heard: string[] }).heard = [];
        window.addEventListener("hoguk:sound", (e) => (window as unknown as { heard: string[] }).heard.push((e as CustomEvent<string>).detail));
      });
    }
    const input = fullDemoV2Input(created.course.id).privateInput.stages.wall;
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      const s = await call(forRole(role), "get-stage");
      for (const step of s.self.mission!.steps) {
        const answer = input.steps[step.id].answer ?? Object.fromEntries(step.fields!.map((f) => [f.id, `[합성] wall-${role} 개인 기록`]));
        await call(forRole(role), "submit-step", { step_id: step.id, answer, method: "official_digital", source: { text: "[합성] 출처" } });
      }
      await forRole(role).getByRole("button", { name: "조사 결과 보고", exact: true }).click();
    }
    const fillDraft = async (text: string) => {
      await commander.getByRole("button", { name: "공동 기록 작성", exact: true }).click();
      for (let i = 1; i <= 3; i++) await commander.getByLabel(`낱말 ${i}`, { exact: true }).selectOption({ index: i });
      await commander.getByLabel("공동 문장", { exact: true }).fill(text);
      await commander.getByLabel("공동 근거", { exact: true }).fill("[합성] 팀 근거");
      await commander.getByRole("button", { name: "공동 기록 저장", exact: true }).click();
    };
    console.log("Synthetic full-course: wall reports complete");
    await fillDraft("[합성] 벽 공동 문장");
    for (const role of ROLES) {
      const p = forRole(role); await expect(p.getByTestId("memorial-record")).toContainText("[합성] 벽 공동 문장");
      for (const other of ROLES.filter((r) => r !== role)) await expect(p.locator("body")).not.toContainText(`wall-${other} 개인 기록`);
      await p.getByRole("button", { name: "공동 문장과 근거 확인", exact: true }).click();
    }
    for (const p of pages) {
      await expect(p.getByTestId("stage-v2-completed")).toBeVisible();
      expect(await p.evaluate(() => (window as unknown as { heard: string[] }).heard)).toEqual([]);
    }
    await commander.getByRole("button", { name: "조용히 머무르기", exact: true }).click();
    await expect(commander.getByTestId("depart-next-stage")).toHaveCount(0);
    await expect(commander.getByRole("timer")).toHaveCount(0);
    await commander.getByRole("button", { name: "지금 이동 준비", exact: true }).click();
    await commander.getByTestId("depart-next-stage").click(); stageId = "bongji";
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    for (const role of ROLES) {
      const p = forRole(role);
      await p.getByLabel("개인 회고 본문", { exact: true }).fill(`[합성] ${role} 비공개 회고`);
      await p.getByRole("button", { name: "회고 저장", exact: true }).click();
    }
    console.log("Synthetic full-course: retros complete");
    await fillDraft("[합성] 최종 공동 문장");
    await commander.getByRole("button", { name: "공동 기록에 동의", exact: true }).click();
    const scout = forRole("scout");
    await scout.getByRole("button", { name: "회고 수정", exact: true }).click();
    await scout.getByLabel("개인 회고 본문", { exact: true }).fill("[합성] scout 비공개 회고 수정");
    await scout.getByRole("button", { name: "회고 저장", exact: true }).click();
    await commander.reload();
    await expect(commander.getByTestId("joint-record")).toContainText("기록 버전 2");
    await expect(commander.getByRole("button", { name: "공동 기록에 동의", exact: true })).toBeEnabled();
    for (const role of ROLES) await forRole(role).getByRole("button", { name: "공동 기록에 동의", exact: true }).click();
    for (const role of ROLES) {
      const p = forRole(role); await expect(p.getByTestId("result-v2")).toContainText("조사 3/3 · 사초 3/3");
      for (const other of ROLES.filter((r) => r !== role)) await expect(p.locator("body")).not.toContainText(`${other} 비공개 회고`);
      await p.reload(); await expect(p.getByTestId("result-v2")).toContainText("[합성] 최종 공동 문장");
    }
    console.log("Synthetic full-course: results restored");
    if (process.env.FULL_CAPTURE === "1") await commander.getByTestId("final-joint-record").screenshot({ path: "../docs/fe/images/full-result-synthetic.png" });
    for (const width of [360, 390, 430]) {
      await commander.setViewportSize({ width, height: 844 });
      expect(await commander.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await expect(commander.getByTestId("final-joint-record")).toBeVisible();
    await call(commander, "get-result");
    await scout.goto("/verify"); await expect(scout.getByTestId("result-v2")).toContainText("scout 비공개 회고 수정");
  } catch (error) { console.error(error instanceof Error ? error.message : "Synthetic scenario failed"); throw error; }
  finally { await Promise.allSettled(contexts.map((c) => c.close())); }
});
