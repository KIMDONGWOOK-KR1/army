import { checkOrderDrag, checkWordDrag } from "./check-story-drag";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";
import { storyBDemoV2Input } from "../../supabase/functions/_shared/story-b-course-v2";
import { ROLES, ROLE_NAMES, type Role, type StepAnswer } from "../../supabase/functions/_shared/types";

test("story-b normal solutions, mobile layout, memorial and four-person consent", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ baseURL,
    viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: [
      { name: "hoguk:narration", value: "off" }, { name: "hoguk:stop", value: "off" }, { name: "hoguk:sound", value: "on" },
    ] }] },
  })));
  let activeStep = "setup";
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
    expect(created.course.name).toBe("민주기록 작전 · 전남대편 (시연용)");
    const { privateInput } = storyBDemoV2Input(created.course.id, JSON.parse(await readFile(process.env.LOCAL_STORY_B_PRIVATE_FILE ?? ".story-b.private.local.json", "utf8")));
    for (let i = 1; i < 4; i++) await call(pages[i], "join-game", { code: created.game.code, nickname: `시험${i + 1}` });
    await call(pages[0], "start-game");
    await expect.poll(async () => (await call(pages[0], "get-game")).game.status).toBe("equip");
    const ready = await Promise.all(pages.map((p) => call(p, "set-ready")));
    const forRole = (role: Role) => pages[ready.findIndex((s) => s.self.role === role)];
    const commander = forRole("commander"); await call(commander, "begin-operation");
    for (const id of ["gate", "yongbong"]) {
      stageId = id;
      for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
      for (const p of pages) await p.goto("/");
      if (id === "gate") {
        // Cosmetic storage must never unlock a dependency or fake a server completion.
        const key = `hoguk:discovery:${gameId}:gate:commander`;
        await commander.evaluate(({ key }) => sessionStorage.setItem(key, JSON.stringify({ opened: ["G-01.verdict"], collected: ["G-01.verdict"] })), { key });
        await commander.reload();
        await expect(commander.getByTestId("story-mission-deck")).toContainText("다음 단서를 기다리는 중");
        await expect(commander.getByTestId("story-claim")).toHaveCount(0);
        await expect(commander.getByTestId("story-step-tab-G-01.verdict")).toHaveAttribute("data-complete", "false");
        await commander.evaluate((key) => sessionStorage.removeItem(key), key);
        await commander.reload();
      }
      if (id === "gate" && browser.browserType().name() === "chromium") {
        const metrics: Record<string, number> = {};
        for (const role of ROLES) {
          const p = forRole(role); await expect(p.getByTestId("story-workbench")).toBeVisible();
          metrics[role] = await p.locator(".mission-stage").evaluate((el) => (el as HTMLElement).innerText.replace(/\s/g, "").length);
          await p.setViewportSize({ width: 390, height: 1500 });
          await p.getByTestId("story-workbench").screenshot({ path: `test-results/play-${role}.png` });
          await p.setViewportSize({ width: 390, height: 844 });
        }
        await writeFile("test-results/play-text-metrics.json", JSON.stringify(metrics));
      }
      for (const p of pages) p.on("request", (request) => {
        if (!request.url().endsWith("/api/game") || request.method() !== "POST") return;
        const body = request.postDataJSON();
        if (body.action === "submit-step") {
          expect(Object.hasOwn(body, "method")).toBe(false);
          expect(Object.hasOwn(body, "source")).toBe(false);
        }
      });
      const solveStep = async (role: Role, stepId: string) => {
        activeStep = stepId;
        const p = forRole(role), snap = await call(p, "get-game"), step = snap.self.mission!.steps.find((s) => s.id === stepId)!;
        await p.getByTestId(`story-step-tab-${step.id}`).click();
        const form = p.getByTestId(`mission-v2-step-${step.id}`);
        await expect(form).toBeVisible();
        await expect(form.getByTestId("story-open-clue")).toBeVisible();
        await expect(form.getByTestId("story-submit")).toHaveCount(0);
        await checkLayout(p);
        if (step.id === "G-03.freq") {
          const parcelAudit = await new AxeBuilder({ page: p }).include('[data-testid="story-mission-deck"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(parcelAudit.violations.map((v) => v.id)).toEqual([]);
          await p.emulateMedia({ reducedMotion: "no-preference" });
        }
        if (step.id === "G-04.spots") {
          await form.getByTestId("story-open-clue").focus();
          await form.getByTestId("story-open-clue").press("Enter");
          await expect(form.getByTestId("story-clue-content")).toHaveAttribute("data-motion", "false");
        } else await form.getByTestId("story-open-clue").click();
        if (step.id === "G-03.freq") {
          expect(await form.getByTestId("story-clue-content").evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.24s");
          await p.reload();
          await expect(form.getByTestId("story-submit")).toBeVisible();
          await expect(form.getByTestId("story-open-clue")).toHaveCount(0);
          await p.emulateMedia({ reducedMotion: "reduce" });
        }
        if (step.id === "G-02.name") {
          activeStep = "G-02.name:reduced-motion";
          const motion = await form.getByTestId("story-clue-content").evaluate((el) => {
            const style = getComputedStyle(el);
            return { duration: style.animationDuration, frames: el.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes()).map((f) => ({ transform: f.transform ?? "none" })) };
          });
          expect(motion.duration).toBe("0.16s");
          expect(motion.frames.every((f) => f.transform === "none")).toBe(true);
          activeStep = step.id;
        }
        await expect(form.getByTestId("story-submit")).toBeVisible();
        await checkLayout(p);
        if (["G-03.freq", "G-01.order", "G-01.verdict", "G-04.spots", "G-02.record", "Y-02.functions"].includes(step.id)) {
          const deck = p.getByTestId("story-mission-deck");
          if (browser.browserType().name() === "chromium") {
            await p.setViewportSize({ width: 390, height: 1600 });
            await deck.screenshot({ path: `test-results/ui-${step.type}.png` });
            await p.setViewportSize({ width: 390, height: 844 });
          }
          const audit = await new AxeBuilder({ page: p }).include('[data-testid="story-mission-deck"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(audit.violations.map((v) => ({ id: v.id, impact: v.impact }))).toEqual([]);
        }
        if (step.id === "G-02.record") await form.screenshot({ path: `test-results/mino-observation-${browser.browserType().name()}.png` });
        if (step.id === "G-01.order") {
          activeStep = "order-drag";
          await checkOrderDrag(p, form, step.id, browser.browserType().name() === "chromium", checkLayout);
          activeStep = step.id;
        }
        const answer: StepAnswer | undefined = privateInput.stages[id].steps[step.id].answer;
        if (step.type === "frequency") await form.getByLabel("주파수 직접 입력").fill(answer as string);
        else if (step.type === "choice") await form.locator("input[type=radio]").nth(Number(answer) - 1).check();
        else if (step.type === "truefalse") {
          for (const [i, value] of (answer as string[]).entries()) {
            await form.getByLabel("묶음 안 카드 선택").getByRole("button").nth(i).click();
            await form.getByRole("radio", { name: value === "true" ? "참" : "거짓", exact: true }).check();
          }
        } else if (step.type === "order") {
          // Keyboard selection, moving and removing cards must be equivalent to tapping.
          await form.getByTestId(`order-choice-${step.id}-1`).focus();
          await form.getByTestId(`order-choice-${step.id}-1`).press("Enter");
          await form.getByTestId(`order-choice-${step.id}-2`).click();
          await form.getByRole("button", { name: "2번째 카드 위로", exact: true }).click();
          await expect(form.getByLabel("배열한 사건 카드").locator("li").first()).toContainText(step.choices![1]);
          await form.getByRole("button", { name: "1번째 카드 빼기", exact: true }).click();
          await form.getByRole("button", { name: "1번째 카드 빼기", exact: true }).click();
          for (const value of answer as string[]) await form.getByTestId(`order-choice-${step.id}-${value}`).click();
        } else if (step.type === "match" || step.type === "classification") {
          for (const [i, field] of step.fields!.entries()) {
            await form.getByLabel("묶음 안 카드 선택").getByRole("button").nth(i).click();
            await form.getByTestId(`connect-${step.id}-${(answer as Record<string, string>)[field.id]}`).click();
          }
        } else if (step.type === "words") {
          for (const [i, value] of (answer as string[]).entries()) await form.getByLabel(`낱말 ${i + 1}`, { exact: true }).fill(value);
        } else if (step.grading === "set-hash") {
          if (step.id === "G-04.spots") {
            await form.locator("input[type=checkbox]").first().check();
            await p.getByTestId("story-step-tab-G-04.time").click();
            await expect(p.getByTestId("story-mission-deck")).toContainText("다음 단서를 기다리는 중");
            await p.getByTestId("story-step-tab-G-04.spots").click();
            await expect(form.locator("input[type=checkbox]").first()).toBeChecked();
            await form.locator("input[type=checkbox]").first().uncheck();
          }
          for (const value of answer as string[]) await form.locator("input[type=checkbox]").nth(Number(value) - 1).check();
        } else if (step.grading === "record") {
          for (const field of step.fields!) {
            await form.getByTestId(`record-tab-${field.id}`).click();
            await form.getByLabel(`${field.label} (필수)`, { exact: true }).fill(`시연 관찰 메모: ${field.label}`);
          }
        } else await form.getByLabel("답안 또는 기록").fill(answer as string);
        await expect(form.getByLabel("확인 방식", { exact: true })).toHaveCount(0);
        await expect(form.getByLabel(/확인한 출처/)).toHaveCount(0);
        await form.getByTestId("story-submit").click();
        await expect(form.getByTestId("story-claim")).toBeVisible();
        if (step.id === "G-03.freq" && browser.browserType().name() === "chromium")
          await form.getByTestId("story-claim").screenshot({ path: "test-results/discovery-reward.png" });
        await form.getByTestId("story-claim").click();
        await expect(form).toContainText("조사 완료");
        await expect(p.getByTestId(`story-step-tab-${step.id}`)).toHaveAttribute("data-collected", "true");
        if (step.id === "G-03.freq") {
          if (browser.browserType().name() === "chromium")
            await form.getByTestId("story-discovery-stamp").screenshot({ path: "test-results/discovery-stamp.png" });
          await p.reload();
          await p.getByTestId(`story-step-tab-${step.id}`).click();
          await expect(form.getByTestId("story-claim")).toHaveCount(0);
          await expect(form).toContainText("기록 도장");
        }
      };
      if (id === "gate") await solveStep("signal", "G-03.freq");
      if (id === "yongbong") {
        await commander.getByTestId("story-visit-options").locator("summary").click();
        await commander.getByRole("button", { name: "외부 대체 모드 선택" }).click();
      }
      for (const role of ["scout", "signal", "cipher", "commander"] as const) {
        const p = forRole(role), snap = await call(p, "get-game");
        for (const step of snap.self.mission!.steps) {
          if (snap.self.step_progress[step.id].status !== "done") await solveStep(role, step.id);
        }
        activeStep = `${id}:${role}:report`;
        await p.getByRole("button", { name: "조사 결과 보고", exact: true }).click();
        await expect(p.getByTestId("mission-v2-private-digit")).toBeVisible();
      }
      const stage = (await call(commander, "get-game")).stage;
      if (stage.completion.type !== "lock") throw new Error("Expected lock completion");
      activeStep = `${id}:lock`;
      await commander.getByRole("button", { name: "팀 자물쇠로", exact: true }).click();
      for (const r of stage.completion.order) await commander.getByLabel(`${ROLE_NAMES[r]} 잠금 숫자`, { exact: true }).fill(String(privateInput.stages[id].roles[r]!.digit!));
      await commander.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
      for (const p of pages) {
        await expect(p.getByTestId("stage-v2-completed")).toBeVisible();
        await expect(p.getByTestId("story-sacho-assembly")).toBeVisible();
        if (id === "yongbong") await expect(p.getByTestId("next-stop")).toContainText("문제 없이 국화를 올리는 곳이에요.");
      }
      await checkLayout(commander);
      await call(commander, "depart-next-site");
    }
    console.log("MINO full-course: entering wall");
    activeStep = "wall"; stageId = "wall";
    for (const p of pages) p.removeAllListeners("request");
    for (const p of pages) await p.goto("/");
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    for (const p of pages) {
      await expect(p.locator('[data-scene="memorial"]')).toBeVisible();
      await expect(p.locator(".hud-score")).toHaveCount(0);
      await expect(p.getByRole("button", { name: "팀 자물쇠로" })).toHaveCount(0);
      await p.evaluate(() => {
        (window as unknown as { heard: string[] }).heard = [];
        window.addEventListener("hoguk:sound", (e) => (window as unknown as { heard: string[] }).heard.push((e as CustomEvent<string>).detail));
      });
    }
    // 도착하면 먼저 벽 앞에서 묵념한다(끝나면 저절로 넘어가고, '묵념 마치기'로 바로 넘길 수도 있다)
    for (const p of pages) {
      await p.getByRole("button", { name: "묵념 마치기", exact: true }).click();
      await expect(p.locator('[data-scene="mission"]')).toBeVisible();
    }
    // 추모의 벽: 소개를 읽고 각자 국화 한 송이를 올린다(문제·공동 기록 없음)
    for (const p of pages) await expect(p.getByTestId("tribute")).toContainText("국화 0송이");
    await expect(commander.getByTestId("tribute")).toContainText("민주화운동에 헌신하다 세상을 떠난 전남대 열사 스무 분");
    await checkLayout(commander);
    for (const [i, role] of (["scout", "signal", "cipher", "commander"] as const).entries()) {
      const p = forRole(role);
      await p.getByRole("button", { name: "국화 올리기", exact: true }).click();
      if (i < 3) await expect(p.getByTestId("tribute")).toContainText(`국화 ${i + 1}송이`);
    }
    console.log("MINO full-course: four flowers laid");
    activeStep = "bongji";
    let jointText = "";
    const fillDraft = async (text: string) => {
      await commander.getByRole("button", { name: "공동 기록 작성", exact: true }).click();
      activeStep = "word-drag";
      await checkWordDrag(commander, browser.browserType().name() === "chromium", checkLayout);
      activeStep = "bongji";
      for (let i = 1; i <= 3; i++) {
        await commander.getByRole("button", { name: `낱말 자리 ${i}`, exact: true }).click();
        await commander.getByTestId(`joint-word-${i}`).click();
      }
      if (await commander.getByTestId("joint-preview").isVisible()) jointText = await commander.getByTestId("joint-preview").innerText();
      else { jointText = text; await commander.getByLabel("공동 문장", { exact: true }).fill(text); }
      await commander.getByLabel("공동 근거", { exact: true }).fill("[합성] 팀 근거");
      await commander.getByRole("button", { name: "공동 기록 저장", exact: true }).click();
    };
    for (const p of pages) {
      await expect(p.getByTestId("stage-v2-completed")).toBeVisible();
      await expect(p.getByTestId("story-sacho-assembly")).toHaveCount(0);
      // 헌화형 추모의 벽(hh 2026-10-10): 누름 소리·사초(07, 1/3 크기)는 나도 되지만, 맞음·자물쇠 같은 판정 소리는 없다
      const heard = await p.evaluate(() => (window as unknown as { heard: string[] }).heard);
      expect(heard.filter((n) => /clue|lock|digit|arrive/.test(n))).toEqual([]);
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
    console.log("MINO full-course: retros complete");
    if (browser.browserType().name() === "chromium") await commander.getByTestId("three-records").screenshot({ path: "test-results/ui-records.png" });
    await fillDraft("[합성] 최종 공동 문장");
    const jointAudit = await new AxeBuilder({ page: commander }).include('[data-testid="joint-record"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(jointAudit.violations.map((v) => ({ id: v.id, impact: v.impact }))).toEqual([]);
    await checkLayout(commander);
    await commander.getByRole("button", { name: "공동 기록에 동의", exact: true }).click();
    const scout = forRole("scout");
    await scout.getByRole("button", { name: "회고 수정", exact: true }).click();
    await scout.getByLabel("개인 회고 본문", { exact: true }).fill("[합성] scout 비공개 회고 수정");
    await scout.getByRole("button", { name: "회고 저장", exact: true }).click();
    await commander.reload();
    await expect(commander.getByTestId("joint-record")).toContainText("기록 버전 2");
    await expect(commander.getByRole("button", { name: "공동 기록에 동의", exact: true })).toBeEnabled();
    // 정찰원 회고 수정으로 기록 버전이 2가 되었다: 각 폰이 새 버전을 받은 뒤에 동의한다(폴링보다 먼저 누르면 예전 버전으로 거절된다)
    for (const role of ROLES) {
      const p = forRole(role);
      await expect(p.getByTestId("joint-record")).toContainText("기록 버전 2");
      await p.getByRole("button", { name: "공동 기록에 동의", exact: true }).click();
    }
    for (const role of ROLES) {
      const p = forRole(role); await expect(p.getByTestId("result-v2")).toContainText("조사 3/3 · 사초 3/3");
      for (const other of ROLES.filter((r) => r !== role)) await expect(p.locator("body")).not.toContainText(`${other} 비공개 회고`);
      await p.reload(); await expect(p.getByTestId("result-v2")).toContainText(jointText);
    }
    console.log("MINO full-course: results restored");
    if (process.env.FULL_CAPTURE === "1") await commander.getByTestId("final-joint-record").screenshot({ path: "../docs/fe/images/full-result-synthetic.png" });
    for (const width of [360, 390, 430]) {
      await commander.setViewportSize({ width, height: 844 });
      expect(await commander.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await expect(commander.getByTestId("final-joint-record")).toBeVisible();
    await checkLayout(commander);
    await call(commander, "get-result");
    await scout.goto("/verify"); await expect(scout.getByTestId("result-v2")).toContainText("scout 비공개 회고 수정");
  } catch (error) {
    // An assertion/locator trace can include a typed real answer. Keep diagnostics structural.
    const message = error instanceof Error ? error.message : "";
    const category = ["Timeout", "not visible", "not enabled", "intercepts", "toEqual", "toBe", "strict mode"].filter((word) => message.includes(word)).join(", ");
    throw new Error(`MINO play check failed at ${activeStep} (${category}); answer-bearing details suppressed`);
  }
  finally { await Promise.allSettled(contexts.map((c) => c.close())); }
});

async function checkLayout(page: Page) {
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of [1, 1.3]) {
      await page.evaluate((scale) => {
        document.getElementById("story-layout-scale")?.remove();
        if (scale === 1) return;
        const style = document.createElement("style"); style.id = "story-layout-scale";
        const rules: string[] = [];
        document.querySelectorAll("[data-scene] p, [data-scene] h1, [data-scene] h2, [data-scene] h3, [data-scene] label, [data-scene] button, [data-scene] input, [data-scene] textarea, [data-scene] select, [data-scene] span, [data-scene] a, [data-scene] li").forEach((el, i) => {
          el.setAttribute("data-story-scale", String(i));
          rules.push(`[data-story-scale="${i}"]{font-size:${parseFloat(getComputedStyle(el).fontSize) * scale}px !important;}`);
        });
        style.textContent = rules.join("\n"); document.head.appendChild(style);
      }, scale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const clipped = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid^=mission-v2-step] h3, [data-testid^=mission-v2-step] label, .next-stop p, [data-testid=tribute] p, [data-testid=joint-record] p, [data-testid=result-v2] p")).filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 0 && el.scrollWidth > el.clientWidth + 2;
      }).length);
      expect(clipped).toBe(0);
    }
  }
  await page.evaluate(() => document.getElementById("story-layout-scale")?.remove());
  await page.setViewportSize({ width: 390, height: 844 });
}

test("MINO prologue and preparation narration follow the room state", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ baseURL, reducedMotion: "reduce", viewport: { width: 390, height: 844 } })));
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const call = async (index: number, data: Record<string, unknown>) => {
      const response = await pages[index].request.post("/api/game", { data: { request_id: crypto.randomUUID(), ...data } });
      expect(response.ok()).toBe(true); return await response.json() as SnapshotV2;
    };
    const created = await call(0, { action: "create-game", nickname: "대본1" });
    for (let i = 1; i < 4; i++) await call(i, { action: "join-game", code: created.game.code, nickname: `대본${i + 1}` });
    await pages[0].goto("/");
    const narration = pages[0].getByRole("dialog", { name: "기록", exact: true });
    await expect(narration).toContainText("끊어진 기록 신호가 도착했다");
    await narration.getByRole("button").click();
    await call(0, { action: "start-game", game_id: created.game.id });
    await expect(narration).toContainText("당신에게만 도착한 단서가 있다");
    await narration.getByRole("button").click();
    await expect(narration).toContainText("도구를 챙겨라");
    await narration.getByRole("button").click();
    await expect(pages[0].locator(".equip-desc")).toContainText("당신은");
    await checkLayout(pages[0]);
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); }
});
