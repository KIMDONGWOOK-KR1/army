import { expect, test, type Locator, type Page } from "@playwright/test";
import { legacyDemoV2Input } from "../../supabase/functions/_shared/legacy-demo-course-v2";
import { ROLE_NAMES, ROLES, type Role } from "../../supabase/functions/_shared/types";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";

// Test-runner-only factory data. Do not copy scenario prose, answers or digits
// into this test, and do not save private response/page artifacts on failure.
const input = legacyDemoV2Input("jnu-demo-dev-v1-test-input");
const gate = input.content.stages[0];
type Reply = SnapshotV2 & { result?: Record<string, unknown> };

async function clickAction(page: Page, button: Locator, action: string) {
  await page.bringToFront();
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/game") &&
      candidate.request().method() === "POST" &&
      candidate.request().postDataJSON()?.action === action
    ),
    button.click({ noWaitAfter: true }),
  ]);
  expect(response.status() === 200, `${action} succeeded`).toBe(true);
  return await response.json() as Reply;
}

async function privateInput(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    // Locator fill/select diagnostics can echo their private argument.
    throw new Error("시연 답안 입력 UI를 조작하지 못했다.");
  }
}

async function fitsPhoneWidths(page: Page, form: Locator, role: Role) {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const fits = await form.evaluate((element) => {
      const controls = element.querySelectorAll(
        "input, button, select, textarea, .choices, .calendar, [role=slider]",
      );
      return document.documentElement.scrollWidth <= innerWidth + 1 &&
        Array.from(controls).every((control) => {
          const box = control.getBoundingClientRect();
          return !box.width || (box.left >= -1 && box.right <= innerWidth + 1);
        });
    });
    expect(fits, `${role} controls fit ${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function checkFrequencyControls(page: Page, form: Locator, answer: string) {
  const lcd = form.getByLabel("주파수 직접 입력", { exact: true });
  const slider = form.getByRole("slider", { name: "주파수 조절", exact: true });
  const plus = form.getByRole("button", { name: "주파수 0.1 높이기", exact: true });
  const minus = form.getByRole("button", { name: "주파수 0.1 낮추기", exact: true });
  const min = Number(await slider.getAttribute("aria-valuemin"));
  const max = Number(await slider.getAttribute("aria-valuemax"));
  const middle = Math.round((min + max) * 5);
  await privateInput(() => lcd.fill((middle / 10).toFixed(1)));
  await plus.click({ noWaitAfter: true });
  expect(Math.round(Number(await lcd.inputValue()) * 10) === middle + 1).toBe(true);
  await minus.click({ noWaitAfter: true });
  expect(Math.round(Number(await lcd.inputValue()) * 10) === middle).toBe(true);
  await slider.focus();
  await slider.press("ArrowRight");
  expect(Math.round(Number(await lcd.inputValue()) * 10) === middle + 1).toBe(true);
  await slider.press("ArrowLeft");
  expect(Math.round(Number(await lcd.inputValue()) * 10) === middle).toBe(true);

  // Preserve the invalid raw input; the UI must never round it into an answer.
  const invalid = Number(answer).toFixed(2);
  await privateInput(() => lcd.fill(invalid));
  await form.getByLabel("확인 방식", { exact: true }).focus();
  expect((await lcd.inputValue()) === invalid).toBe(true);
  expect(await lcd.evaluate((element) => !(element as HTMLInputElement).validity.valid)).toBe(true);
  await expect(lcd).toHaveAttribute("aria-invalid", "true");
  let submitted = false;
  const observe = (request: import("@playwright/test").Request) => {
    if (request.url().endsWith("/api/game") && request.method() === "POST" &&
      request.postDataJSON()?.action === "submit-step") submitted = true;
  };
  page.on("request", observe);
  try {
    await form.getByRole("button", { name: "문제 제출", exact: true }).click({ noWaitAfter: true });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(submitted, "invalid frequency does not dispatch a submission").toBe(false);
  } finally {
    page.off("request", observe);
  }
  await privateInput(() => lcd.fill(answer));
}

async function submitFrequencyWhileCheckingBusy(page: Page, form: Locator, stepId: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let began!: () => void;
  const started = new Promise<void>((resolve) => { began = resolve; });
  const routeHandler = async (route: import("@playwright/test").Route) => {
    const request = route.request();
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (body?.action === "submit-step" && body.step_id === stepId) {
      began();
      // Hold before the commit, so polling cannot remove the form during checks.
      await held;
    }
    await route.continue();
  };
  await page.route("**/api/game", routeHandler);
  const pending = clickAction(page, form.getByRole("button", {
    name: "문제 제출", exact: true,
  }), "submit-step").then(
    (reply) => ({ reply, error: null }),
    (error: unknown) => ({ reply: null, error }),
  );
  try {
    await Promise.race([
      started,
      pending.then(() => { throw new Error("주파수 제출 요청을 보류하지 못했다."); }),
    ]);
    const lcd = form.getByLabel("주파수 직접 입력", { exact: true });
    const slider = form.getByRole("slider", { name: "주파수 조절", exact: true });
    await expect(lcd).toBeDisabled();
    await expect(form.getByRole("button", { name: "주파수 0.1 높이기", exact: true })).toBeDisabled();
    await expect(form.getByRole("button", { name: "주파수 0.1 낮추기", exact: true })).toBeDisabled();
    await expect(slider).toHaveAttribute("aria-disabled", "true");
    await expect(slider).toHaveAttribute("tabindex", "-1");
    const before = await lcd.inputValue();
    // A custom slider must guard its handlers as well as declare aria-disabled.
    await slider.dispatchEvent("keydown", { key: "ArrowRight", bubbles: true });
    await slider.dispatchEvent("wheel", { deltaY: 100, bubbles: true });
    await slider.dispatchEvent("pointerdown", {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 10, clientY: 10,
    });
    await slider.dispatchEvent("pointermove", {
      pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 100,
    });
    expect((await lcd.inputValue()) === before, "busy frequency controls preserve input").toBe(true);
    release();
    const result = await pending;
    if (result.error || !result.reply) throw new Error("주파수 제출 응답을 받지 못했다.");
    return result.reply;
  } finally {
    release();
    await pending;
    await page.unroute("**/api/game", routeHandler);
  }
}

test("four sessions complete the migrated v1 gate through v2 solve, separate report and lock", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL!).origin,
        localStorage: [
          { name: "hoguk:narration", value: "off" },
          { name: "hoguk:stop", value: "off" },
          { name: "hoguk:sound", value: "off" },
        ],
      }],
    },
  })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let failedPage = false;
  const pageErrorKinds = new Set<string>();
  let privateLog = false;
  for (const page of pages) {
    page.on("pageerror", (error) => {
      failedPage = true;
      pageErrorKinds.add(error.name);
    });
    page.on("console", (message) => {
      if (/answerHash|transfer_clue|"answer"\s*:|ANSWER_SALT/.test(message.text())) {
        privateLog = true;
      }
    });
  }

  try {
    await pages[0].goto("/");
    await pages[0].getByRole("button", { name: "작전 시작", exact: true }).click();
    await pages[0].getByLabel("호출명", { exact: true }).fill("임시1");
    const created = await clickAction(pages[0], pages[0].getByRole("button", {
      name: "새 작전 만들기", exact: true,
    }), "create-game");
    expect(created.stage.schema_version === 2).toBe(true);
    expect(created.stage.id === gate.id).toBe(true);
    expect(created.course.sites.length === 1).toBe(true);
    const gameId = created.game.id;
    for (let i = 1; i < pages.length; i++) {
      await pages[i].goto(`/j/${created.game.code}`);
      await pages[i].getByLabel("호출명", { exact: true }).fill(`임시${i + 1}`);
      await pages[i].getByLabel("입장 코드", { exact: true }).fill(created.game.code);
      await clickAction(pages[i], pages[i].getByRole("button", {
        name: "작전에 합류하기", exact: true,
      }), "join-game");
    }
    const start = pages[0].getByRole("button", { name: "보직 공개 시작", exact: true });
    await expect(start).toBeEnabled();
    await clickAction(pages[0], start, "start-game");

    const participants = {} as Record<Role, Page>;
    for (const page of pages) {
      await page.bringToFront();
      const ready = page.getByRole("button", { name: "위치 없이 준비 완료", exact: true });
      await expect(ready).toBeEnabled();
      const result = await clickAction(page, ready, "set-ready");
      expect(result.self.role !== null).toBe(true);
      participants[result.self.role!] = page;
    }
    expect(ROLES.every((role) => !!participants[role])).toBe(true);
    const commander = participants.commander;
    const depart = commander.getByRole("button", { name: "작전 출발", exact: true });
    await expect(depart).toBeEnabled();
    const departed = await clickAction(commander, depart, "begin-operation");
    expect(departed.game.status === "playing" && departed.game.site_phase === "travel").toBe(true);

    for (const [index, page] of pages.entries()) {
      await page.bringToFront();
      try {
        await expect(page.locator(".hud-distance")).toBeVisible();
      } catch {
        const state = await page.evaluate(() => ({
          scene: document.querySelector("[data-scene]")?.getAttribute("data-scene") ?? "none",
          boundary: !!document.querySelector("main.fallback"),
          alert: !!document.querySelector(".error-banner"),
        }));
        throw new Error(`Arrival view unavailable: page=${index}, scene=${state.scene}, boundary=${state.boundary}, alert=${state.alert}, errorKinds=${[...pageErrorKinds].join(",")}`);
      }
      await expect(page.locator(".hud-distance")).not.toContainText("지도 불러오는 중", { timeout: 30000 });
    }
    for (const page of pages) {
      const arrive = page.getByRole("button", { name: "본인 모의 도착 확인", exact: true });
      await expect(arrive).toBeEnabled();
      await clickAction(page, arrive, "report-arrival");
    }

    const digits = {} as Record<Role, number>;
    for (const role of ROLES) {
      const page = participants[role];
      await page.bringToFront();
      const steps = gate.roles[role]!.steps;
      expect(steps.length === 1).toBe(true);
      const step = steps[0];
      const form = page.getByTestId(`mission-v2-step-${step.id}`);
      await expect(form).toBeVisible();
      await expect(page.locator('[data-testid^="mission-v2-step-"]')).toHaveCount(1);
      await expect(page.getByTestId("mission-v2-transfer-clue")).toHaveCount(role === "commander" ? 1 : 0);
      await fitsPhoneWidths(page, form, role);
      const answer = input.privateInput.stages[gate.id].steps[step.id].answer;
      expect(typeof answer === "string").toBe(true);
      await form.getByLabel("확인 방식", { exact: true }).selectOption("simulated");
      if (step.type === "choice") {
        const choices = form.locator(".choices button");
        await expect(choices).toHaveCount(step.choices?.length ?? 0);
        if (role === "cipher") {
          await expect(form.locator(".calendar")).toBeVisible();
          await expect(form.locator(".calendar-grid")).toBeVisible();
        }
        await privateInput(() => choices.nth(Number(answer) - 1).click({ noWaitAfter: true }));
        expect(await choices.evaluateAll((buttons) => buttons.filter((button) =>
          button.getAttribute("aria-pressed") === "true").length === 1)).toBe(true);
      } else if (step.type === "frequency") {
        await checkFrequencyControls(page, form, answer as string);
      } else {
        await privateInput(() => form.getByLabel("찾은 단서의 답", { exact: true }).fill(answer as string));
      }
      const solved = step.type === "frequency"
        ? await submitFrequencyWhileCheckingBusy(page, form, step.id)
        : await clickAction(page, form.getByRole("button", {
          name: "문제 제출", exact: true,
        }), "submit-step");
      expect(solved.result?.accepted === true).toBe(true);
      expect(solved.self.step_progress[step.id]?.status === "done").toBe(true);
      expect(solved.self.reported === false && solved.self.digit === null).toBe(true);
      const report = page.getByRole("button", { name: "조사 결과 보고", exact: true });
      await expect(report).toBeEnabled();
      const reported = await clickAction(page, report, "submit-report");
      expect(reported.self.reported === true && Number.isInteger(reported.self.digit)).toBe(true);
      digits[role] = reported.self.digit!;
      const publicText = JSON.stringify({ game: reported.game, stage: reported.stage, course: reported.course });
      expect(/answerHash|transfer_clue|"digit"\s*:/.test(publicText)).toBe(false);
    }

    await commander.bringToFront();
    await commander.getByRole("button", { name: "팀 자물쇠로", exact: true }).click({ noWaitAfter: true });
    expect(gate.completion.type === "lock").toBe(true);
    const order = gate.completion.type === "lock" ? gate.completion.order : ROLES;
    for (const role of order) {
      await privateInput(() => commander.getByRole("textbox", {
        name: `${ROLE_NAMES[role]} 잠금 숫자`, exact: true,
      }).fill(String(digits[role])));
    }
    const lock = commander.getByRole("button", { name: "자물쇠 확인", exact: true });
    await expect(lock).toBeEnabled();
    const completed = await clickAction(commander, lock, "open-lock");
    expect(completed.result?.opened === true).toBe(true);
    expect(completed.game.stage_phase === "done" && completed.game.site_phase === "cleared").toBe(true);
    expect(completed.game.status === "playing" && completed.game.acquired_sites.length === 1).toBe(true);
    for (const page of pages) {
      await expect(page.getByTestId("stage-v2-completed")).toBeVisible();
      await expect(page.getByRole("button", { name: "다음 거점으로 출발", exact: true })).toHaveCount(0);
      const safe = await page.evaluate((id) => {
        const settings = ["hoguk:narration", "hoguk:stop", "hoguk:sound"];
        return localStorage.getItem("hoguk-game") === id &&
          Object.keys(localStorage).every((key) => key === "hoguk-game" || settings.includes(key)) &&
          Object.keys(sessionStorage).every((key) =>
            key === `hoguk:reveal-seen:${id}` && sessionStorage.getItem(key) === "1");
      }, gameId);
      expect(safe).toBe(true);
    }
    await commander.reload();
    await expect(commander.getByTestId("stage-v2-completed")).toBeVisible();
    expect(failedPage || privateLog).toBe(false);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
