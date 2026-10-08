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
      const answer = input.privateInput.stages[gate.id].steps[step.id].answer;
      expect(typeof answer === "string").toBe(true);
      await privateInput(() => step.type === "choice"
        ? form.getByRole("combobox", { name: "선택 항목", exact: true }).selectOption(answer as string)
        : form.getByLabel(step.type === "frequency"
          ? "주파수 (소수점 한 자리 이하)" : "답안 또는 기록", { exact: true }).fill(answer as string));
      await form.getByLabel("확인 방식", { exact: true }).selectOption("simulated");
      const solved = await clickAction(page, form.getByRole("button", {
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
