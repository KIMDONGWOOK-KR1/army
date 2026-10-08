import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { demoV2Input } from "../../supabase/functions/_shared/demo-course-v2";
import {
  type Role,
  ROLE_NAMES,
  ROLES,
  type Step,
  type StepAnswer,
} from "../../supabase/functions/_shared/types";
import type { SnapshotV2 } from "../../supabase/functions/_shared/engine-v2";

// Test-runner-only synthetic input: no actual scenario, fixed salt, or client
// seed endpoint is used. Failed tests do not retain page/network artifacts.
const synthetic = demoV2Input("jnu-demo-dev-ui-test-input");
const gate = synthetic.content.stages.find((stage) => stage.id === "gate")!;
type Reply = SnapshotV2 & { result?: Record<string, unknown> };
type Team = {
  contexts: BrowserContext[];
  pages: Page[];
  roles: Record<Role, Page>;
  id: string;
  hasPrivateConsole: () => boolean;
};

async function clickAction(page: Page, button: Locator, action: string) {
  const response = page.waitForResponse((res) => {
    if (!res.url().endsWith("/api/game") || res.request().method() !== "POST") {
      return false;
    }
    return res.request().postDataJSON()?.action === action;
  });
  await button.click();
  const result = await response;
  expect(result.status(), `${action} HTTP status`).toBe(200);
  return (await result.json()) as Reply;
}

async function current(page: Page, id: string) {
  const response = await page.request.post("/api/game", {
    data: { action: "get-stage", game_id: id, stage_id: "gate" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Reply;
}

async function createTeam(browser: Browser, baseURL: string): Promise<Team> {
  const contexts = await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let privateConsole = false;
  for (const page of pages) {
    page.on("console", (message) => {
      const text = message.text();
      if (
        [
          "[합성]",
          "answerHash",
          "transfer_clue",
          '"answer":',
          String(synthetic.privateInput.stages.gate.steps["G-03.freq"].answer),
        ].some((marker) => text.includes(marker))
      ) {
        privateConsole = true;
      }
    });
  }
  try {
    await Promise.all(pages.map((page) => page.goto("/verify")));
    await pages[0].getByLabel("호출명", { exact: true }).fill("연습1");
    const created = await clickAction(
      pages[0],
      pages[0].getByRole("button", { name: "새 v2 방 만들기", exact: true }),
      "create-game",
    );
    expect(created.stage.schema_version).toBe(2);
    const id = created.game.id;
    await expect(pages[0].getByTestId("verify-code")).toContainText(
      created.game.code,
    );
    for (let i = 1; i < pages.length; i++) {
      await pages[i].getByLabel("호출명", { exact: true }).fill(`연습${i + 1}`);
      await pages[i].getByLabel("입장 코드", { exact: true }).fill(
        created.game.code,
      );
      await clickAction(
        pages[i],
        pages[i].getByRole("button", { name: "코드로 합류", exact: true }),
        "join-game",
      );
    }
    const start = pages[0].getByRole("button", {
      name: "보직 공개 시작",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await clickAction(pages[0], start, "start-game");
    const roles = {} as Record<Role, Page>;
    for (const page of pages) {
      const ready = page.getByRole("button", {
        name: "준비 완료",
        exact: true,
      });
      await expect(ready).toBeEnabled();
      const view = await clickAction(page, ready, "set-ready");
      expect(view.self.role !== null).toBe(true);
      const role = view.self.role!;
      roles[role] = page;
      await expect(page.getByTestId("verify-role")).toContainText(
        ROLE_NAMES[role],
      );
    }
    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort());
    const departure = roles.commander.getByRole("button", {
      name: "작전 출발",
      exact: true,
    });
    await expect(departure).toBeEnabled();
    await clickAction(roles.commander, departure, "begin-operation");
    for (const page of pages) {
      const arrival = page.getByRole("button", {
        name: "본인 모의 도착 확인",
        exact: true,
      });
      await expect(arrival).toBeEnabled();
      await clickAction(page, arrival, "report-arrival");
    }
    for (const role of ROLES) {
      await expect(
        roles[role].getByTestId(`verify-step-${gate.roles[role]!.steps[0].id}`),
      ).toBeVisible();
    }
    return {
      contexts,
      pages,
      roles,
      id,
      hasPrivateConsole: () => privateConsole,
    };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()));
    throw error;
  }
}

async function fillAnswer(form: Locator, step: Step, answer: StepAnswer) {
  if (step.type === "truefalse" || step.type === "order") {
    for (const [index, value] of (answer as string[]).entries()) {
      await form.getByRole("combobox").nth(index).selectOption(value);
    }
  } else if (step.type === "match") {
    for (const field of step.fields!) {
      await form.getByLabel(field.label, { exact: true }).selectOption(
        (answer as Record<string, string>)[field.id],
      );
    }
  } else if (step.type === "words") {
    for (const [index, value] of (answer as string[]).entries()) {
      await form.getByLabel(`낱말 ${index + 1}`, { exact: true }).fill(value);
    }
  } else if (step.grading === "set-hash") {
    for (const value of answer as string[]) {
      await form.getByRole("checkbox").nth(Number(value) - 1).check();
    }
  } else if (step.fields?.length) {
    for (const field of step.fields) {
      await form.getByLabel(`${field.label} (필수)`, { exact: true }).fill(
        (answer as Record<string, string>)[field.id],
      );
    }
  } else {
    await form.getByLabel(
      step.type === "frequency"
        ? "주파수 (소수점 한 자리 이하)"
        : "답안 또는 기록",
      { exact: true },
    ).fill(answer as string);
  }
}

async function report(page: Page) {
  const button = page.getByRole("button", {
    name: "조사 결과 보고",
    exact: true,
  });
  await expect(button).toBeEnabled();
  const view = await clickAction(page, button, "submit-report");
  expect(view.self.reported).toBe(true);
  expect(Number.isInteger(view.self.digit)).toBe(true);
  return view;
}

async function solve(team: Team, role: Role) {
  const page = team.roles[role];
  for (const step of gate.roles[role]!.steps) {
    const form = page.getByTestId(`verify-step-${step.id}`);
    const answer = synthetic.privateInput.stages.gate.steps[step.id].answer ??
      Object.fromEntries(
        step.fields!.map((field) => [field.id, `[합성] ${field.id} 확인 기록`]),
      );
    await expect(form.getByRole("button", { name: "문제 제출", exact: true }))
      .toBeEnabled();
    await fillAnswer(form, step, answer);
    await form.getByLabel("확인 방식", { exact: true }).selectOption(
      "simulated",
    );
    await form.getByLabel("확인한 출처 (필수)", { exact: true }).fill(
      "[합성] 연습 자료에서 확인",
    );
    const view = await clickAction(
      page,
      form.getByRole("button", { name: "문제 제출", exact: true }),
      "submit-step",
    );
    expect(view.result?.accepted).toBe(true);
    expect(view.self.step_progress[step.id].status).toBe("done");
    // Solving a problem must not automatically send the separate oral report.
    expect(view.self.reported).toBe(false);
    expect(view.self.digit === null).toBe(true);
  }
  return report(page);
}

async function verifyPrivacy(team: Team) {
  for (const role of ROLES) {
    const page = team.roles[role];
    const view = await current(page, team.id);
    const ownIds = gate.roles[role]!.steps.map((step) => step.id).sort();
    expect(Object.keys(view.self.step_progress).sort()).toEqual(ownIds);
    expect(view.self.mission!.steps.map((step) => step.id).sort()).toEqual(
      ownIds,
    );
    expect("transfer_clue" in view.self).toBe(role === "commander");
    await expect(page.getByTestId("verify-transfer-clue")).toHaveCount(
      role === "commander" ? 1 : 0,
    );
    const publicText = JSON.stringify({
      game: view.game,
      stage: view.stage,
      course: view.course,
    });
    expect(/answerHash|transfer_clue|"digit"\s*:/.test(publicText)).toBe(false);
    for (const other of ROLES.filter((candidate) => candidate !== role)) {
      expect(view.self.mission!.intro.text.includes(`${other} 개인 안내`)).toBe(
        false,
      );
      await expect(
        page.getByTestId(`verify-step-${gate.roles[other]!.steps[0].id}`),
      ).toHaveCount(0);
    }
  }
  await verifyStorage(team);
}

async function verifyStorage(team: Team) {
  for (const page of team.pages) {
    const stored = await page.evaluate((id) => ({
      onlyGameId: Object.keys(localStorage).length === 1 &&
        localStorage.getItem("hoguk-v2-game") === id,
      noPendingAnswer: sessionStorage.length === 0,
    }), team.id);
    expect(stored.onlyGameId).toBe(true);
    expect(stored.noPendingAnswer).toBe(true);
  }
  expect(team.hasPrivateConsole()).toBe(false);
}

async function hintWithLostResponse(team: Team, button: Locator) {
  const page = team.roles.commander;
  const before = await current(page, team.id);
  const ids: string[] = [];
  const handler = async (route: import("@playwright/test").Route) => {
    const request = route.request().postDataJSON();
    if (
      request?.action !== "request-hint" || request.target_role !== "signal" ||
      request.level !== 2
    ) {
      await route.continue();
      return;
    }
    ids.push(request.request_id);
    if (ids.length === 1) {
      // Commit the action on the real server, then lose only its HTTP response.
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route("**/api/game", handler);
  try {
    await button.click();
    await expect(page.getByTestId("verify-error")).toBeVisible();
    const applied = await current(page, team.id);
    expect(applied.game.hint_level.signal).toBe(2);
    expect(applied.game.score).toBe(
      before.game.score - gate.scoring.hintPenalty[2]!,
    );
    await verifyStorage(team);
    const retried = await clickAction(
      page,
      page.getByRole("button", { name: "다시 연결", exact: true }),
      "request-hint",
    );
    expect(ids).toHaveLength(2);
    expect(ids[0] === ids[1]).toBe(true);
    expect(retried.game.score).toBe(applied.game.score);
    expect(retried.game.hint_level.signal).toBe(2);
    await expect(page.getByTestId("verify-error")).toHaveCount(0);
  } finally {
    await page.unroute("**/api/game", handler);
  }
}

async function fillLock(page: Page, digits: number[]) {
  for (const [index, role] of ROLES.entries()) {
    await page.getByRole("textbox", {
      name: `${ROLE_NAMES[role]} 잠금 숫자`,
      exact: true,
    }).fill(String(digits[index]));
  }
}

test("four v2 browser sessions solve and report separately, recover a partial lock, and complete the gate", async ({ browser, baseURL }) => {
  const team = await createTeam(browser, baseURL!);
  try {
    await verifyPrivacy(team);
    const digits = {} as Record<Role, number>;
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      const view = await solve(team, role);
      digits[role] = view.self.digit!;
    }
    const commander = team.roles.commander;
    const target = ROLES.map((role) => digits[role]);
    await fillLock(
      commander,
      target.map((digit, index) => index === 0 ? digit : (digit + 1) % 10),
    );
    const failed = await clickAction(
      commander,
      commander.getByRole("button", { name: "자물쇠 확인", exact: true }),
      "open-lock",
    );
    expect(failed.result?.ok).toBe(false);
    expect(failed.game.attempts_left).toBe(2);
    await Promise.all([commander.reload(), team.roles.scout.reload()]);
    const recovered = await current(commander, team.id);
    expect(recovered.game.attempts_left).toBe(2);
    expect(recovered.game.score).toBe(failed.game.score);
    expect(recovered.self.lock!.digits[0] === target[0]).toBe(true);
    expect(
      recovered.self.lock!.digits.slice(1).every((digit) => digit === null),
    ).toBe(true);
    const scout = await current(team.roles.scout, team.id);
    expect(scout.self.reported).toBe(true);
    expect(scout.self.digit === digits.scout).toBe(true);
    await expect(
      commander.getByRole("textbox", { name: "지휘관 잠금 숫자", exact: true }),
    ).toBeDisabled();
    // The locked first cell stays restored; participants communicate other
    // digits outside the app, represented here by separate self responses.
    for (let i = 1; i < ROLES.length; i++) {
      await commander.getByRole("textbox", {
        name: `${ROLE_NAMES[ROLES[i]]} 잠금 숫자`,
        exact: true,
      }).fill(String(target[i]));
    }
    const opened = await clickAction(
      commander,
      commander.getByRole("button", { name: "자물쇠 확인", exact: true }),
      "open-lock",
    );
    expect(opened.result?.ok).toBe(true);
    expect(opened.game.stage_phase).toBe("done");
    expect(opened.game.status).toBe("playing");
    expect(opened.game.site_phase).toBe("cleared");
    await Promise.all(
      team.pages.map((page) =>
        expect(
          page.getByRole("heading", { name: "정문 확인 완료", exact: true }),
        ).toBeVisible()
      ),
    );
    await verifyStorage(team);
  } finally {
    await Promise.all(team.contexts.map((context) => context.close()));
  }
});

test("third-level role hints keep private explanations isolated and require all confirmations before separate restoration", async ({ browser, baseURL }) => {
  const team = await createTeam(browser, baseURL!);
  try {
    const commander = team.roles.commander;
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) {
        const button = commander.getByRole("button", {
          name: `${ROLE_NAMES[role]} ${level}단계 힌트`,
          exact: true,
        });
        await expect(button).toBeEnabled();
        if (role === "signal" && level === 2) {
          await hintWithLostResponse(team, button);
        } else await clickAction(commander, button, "request-hint");
      }
      const view = await current(team.roles[role], team.id);
      expect(view.self.hint_level).toBe(3);
      expect(
        Object.values(view.self.step_progress).every((progress) =>
          progress.status === "explained"
        ),
      ).toBe(true);
      expect(Object.keys(view.self.rewards)).toHaveLength(0);
      expect(Object.keys(view.self.explanations).sort()).toEqual(
        gate.roles[role]!.steps.map((step) => step.id).sort(),
      );
      const other = await current(
        team.roles[role === "commander" ? "scout" : "commander"],
        team.id,
      );
      expect(
        Object.keys(other.self.explanations).some((id) =>
          gate.roles[role]!.steps.some((step) => step.id === id)
        ),
      ).toBe(false);
      await report(team.roles[role]);
    }
    await verifyPrivacy(team);
    const restore = commander.getByRole("button", {
      name: "해설 확인 후 복원",
      exact: true,
    });
    await expect(restore).toBeDisabled();
    for (const role of ["commander", "scout", "signal"] as const) {
      await clickAction(
        team.roles[role],
        team.roles[role].getByRole("button", {
          name: "내 해설 읽음 확인",
          exact: true,
        }),
        "confirm-explanation",
      );
    }
    await expect(restore).toBeDisabled();
    const premature = await commander.request.post("/api/game", {
      data: {
        action: "open-after-explanation",
        game_id: team.id,
        stage_id: "gate",
        request_id: crypto.randomUUID(),
      },
    });
    expect(premature.status()).toBe(409);
    expect((await premature.json()).code).toBe("EXPLANATION_REQUIRED");
    await clickAction(
      team.roles.cipher,
      team.roles.cipher.getByRole("button", {
        name: "내 해설 읽음 확인",
        exact: true,
      }),
      "confirm-explanation",
    );
    await expect(restore).toBeEnabled();
    const before = await current(commander, team.id);
    const opened = await clickAction(
      commander,
      restore,
      "open-after-explanation",
    );
    expect(opened.result?.method).toBe("explained");
    expect(opened.result?.label).toBe("해설 확인 후 복원");
    expect(opened.game.score).toBe(before.game.score);
    expect(opened.game.attempts_left).toBe(before.game.attempts_left);
    await Promise.all(
      team.pages.map((page) =>
        expect(
          page.getByRole("heading", { name: "정문 확인 완료", exact: true }),
        ).toBeVisible()
      ),
    );
    await commander.reload();
    await expect(
      commander.getByRole("heading", { name: "정문 확인 완료", exact: true }),
    ).toBeVisible();
    expect((await current(commander, team.id)).game.confirm_mask.every(Boolean))
      .toBe(true);
    await verifyStorage(team);
  } finally {
    await Promise.all(team.contexts.map((context) => context.close()));
  }
});
