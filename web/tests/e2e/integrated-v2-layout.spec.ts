import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import type { V2Response } from "../../lib/game-snapshot";
import {
  type Role,
  type Step,
  ROLE_NAMES,
  ROLES,
} from "../../supabase/functions/_shared/types";

// Public documentation fixtures only. These layout tests never import a seed,
// contact a deployed backend, or submit an answer to the engine.
function publicFixture(role: Role): V2Response {
  return JSON.parse(readFileSync(
    new URL(
      `../../../docs/be/fixtures/get-stage.gate.${role}.before-hint.json`,
      import.meta.url,
    ),
    "utf8",
  )) as V2Response;
}

function legacyPublicFixture(role: Role): V2Response {
  const fixture = publicFixture(role);
  const mission = fixture.self.mission!;
  const types: Record<Role, Step["type"]> = {
    commander: "choice",
    scout: "observation",
    signal: "frequency",
    cipher: "choice",
  };
  const step: (typeof mission.steps)[number] = {
    id: `G-0${ROLES.indexOf(role) + 1}.legacy`,
    type: types[role],
    grading: "hash",
    confirmed: false,
    prompt: mission.steps[0].prompt,
    sourceRequired: false,
    maxLen: 300,
    ...(types[role] === "choice"
      ? {
        choices: Array.from(
          { length: role === "cipher" ? 7 : 3 },
          (_, index) => `[합성] 화면 연습 선택지 ${index + 1}`,
        ),
      }
      : {}),
  };
  fixture.course.demo = true;
  fixture.game.demo = true;
  mission.steps = [step];
  fixture.self.step_progress = { [step.id]: { status: "open", attempts: 0 } };
  fixture.self.clue = null;
  delete fixture.self.transfer_clue;
  fixture.self.hints = [];
  fixture.self.explanations = {};
  fixture.self.rewards = {};
  return fixture;
}

type Surface = Page | FrameLocator;
const PHONE_SCREEN = 'iframe[title="호국실록 폰 화면"]';

async function renderFixture(page: Page, fixture: V2Response) {
  const actions: string[] = [];
  await page.context().route("**/api/game", async (route) => {
    const command = route.request().postDataJSON() as { action?: string };
    actions.push(command.action ?? "");
    if (command.action === "get-game" || command.action === "get-stage") {
      await route.fulfill({ status: 200, json: fixture });
    } else {
      await route.fulfill({
        status: 405,
        json: {
          code: "READ_ONLY_MOCK",
          message: "공개 화면 예시는 조회만 지원한다.",
        },
      });
    }
  });
  await page.addInitScript(({ gameId }) => {
    localStorage.setItem("hoguk-game", gameId);
    localStorage.setItem("hoguk:narration", "off");
    localStorage.setItem("hoguk:stop", "off");
    localStorage.setItem("hoguk:sound", "off");
  }, { gameId: fixture.game.id });
  await page.goto("/");
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await expect(page.locator(".mission-header .role-badge")).toHaveText(
    ROLE_NAMES[fixture.self.role!],
  );
  return actions;
}

async function expectNoHorizontalOverflow(surface: Surface) {
  const geometry = await surface.locator("html").evaluate((root) => ({
    width: window.innerWidth,
    documentWidth: root.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    panels: [
      ...document.querySelectorAll<HTMLElement>(".mission-stage, .lock-stage"),
    ]
      .map((panel) => ({
        width: panel.clientWidth,
        contentWidth: panel.scrollWidth,
      })),
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.width + 1);
  for (const panel of geometry.panels) {
    expect(panel.contentWidth).toBeLessThanOrEqual(panel.width + 1);
  }
}

test.use({
  reducedMotion: "reduce",
  trace: "off",
  screenshot: "off",
  video: "off",
});

for (const role of ROLES) {
  test(`공개 ${role} 미션을 360·390·430px에서 읽고 조작 영역까지 스크롤한다`, async ({ page }) => {
    const fixture = publicFixture(role);
    expect(fixture.self.digit).toBeNull();
    await page.setViewportSize({ width: 360, height: 844 });
    const actions = await renderFixture(page, fixture);
    const mission = fixture.self.mission!;

    for (const width of [360, 390, 430]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 844 });
        for (const step of mission.steps) {
          const card = page.getByTestId(`mission-v2-step-${step.id}`);
          const heading = card.getByRole("heading", {
            name: step.prompt,
            exact: true,
          });
          await heading.scrollIntoViewIfNeeded();
          await expect(heading).toBeInViewport();
          const submit = card.getByRole("button", {
            name: "문제 제출",
            exact: true,
          });
          await submit.scrollIntoViewIfNeeded();
          await expect(submit).toBeInViewport();
        }
        const report = page.getByRole("button", {
          name: "조사 결과 보고",
          exact: true,
        });
        await report.scrollIntoViewIfNeeded();
        await expect(report).toBeInViewport();
        const confirmation = page.getByRole("button", {
          name: "내 해설 읽음 확인",
          exact: true,
        });
        await confirmation.scrollIntoViewIfNeeded();
        await expect(confirmation).toBeInViewport();
        await expectNoHorizontalOverflow(page);
        await expect(page.getByTestId("mission-v2-private-digit")).toHaveCount(
          0,
        );

        if (role === "commander") {
          expect(fixture.self.lock?.digits).toEqual([null, null, null, null]);
          await page.getByRole("button", { name: "팀 자물쇠로", exact: true })
            .click();
          await expect(page.locator('[data-scene="lock"]')).toBeVisible();
          for (const target of ROLES) {
            const input = page.getByRole("textbox", {
              name: `${ROLE_NAMES[target]} 잠금 숫자`,
              exact: true,
            });
            await input.scrollIntoViewIfNeeded();
            await expect(input).toBeInViewport();
            await expect(input).toHaveValue("");
          }
          await expectNoHorizontalOverflow(page);
          await page.getByRole("button", {
            name: "내 조사와 해설 확인",
            exact: true,
          }).click();
          await expect(page.locator('[data-scene="mission"]')).toBeVisible();
        }

        if (
          process.env.CAPTURE_PUBLIC_FIXTURE === "1" && role === "commander" &&
          width === 390
        ) {
          // Only public synthetic prose and omitted values appear in this optional image.
          await page.locator(".mission-stage").evaluate((panel) => {
            panel.scrollTop = 0;
          });
          const folder = new URL("../../.demo-data/", import.meta.url);
          mkdirSync(folder, { recursive: true });
          await page.screenshot({
            path: fileURLToPath(new URL("ui-integration-preview.png", folder)),
            animations: "disabled",
          });
        }
      });
    }
    expect(actions).toContain("get-stage");
    expect(
      actions.every((action) =>
        action === "get-game" || action === "get-stage"
      ),
    ).toBe(true);
  });
}

for (const role of ROLES) {
  test(`공개 legacy ${role} 입력 UI는 360·390·430px에서 넘치지 않는다`, async ({ page }) => {
    const fixture = legacyPublicFixture(role);
    const step = fixture.self.mission!.steps[0];
    expect(fixture.self.digit).toBeNull();
    expect(fixture.self.transfer_clue).toBeUndefined();
    await page.setViewportSize({ width: 360, height: 844 });
    const actions = await renderFixture(page, fixture);
    const card = page.getByTestId(`mission-v2-step-${step.id}`);

    for (const width of [360, 390, 430]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 844 });
        const input = role === "signal"
          ? card.locator(".radio-panel")
          : role === "scout"
          ? card.locator(".field-label input")
          : card.locator(".choices");
        await input.scrollIntoViewIfNeeded();
        await expect(input).toBeVisible();
        await expect(input).toBeInViewport();
        await expect(card.locator(".calendar")).toHaveCount(
          role === "cipher" ? 1 : 0,
        );
        await expect(card.locator(".radio-panel")).toHaveCount(
          role === "signal" ? 1 : 0,
        );
        if (role === "commander" || role === "cipher") {
          const choices = card.locator(".choices button");
          await expect(choices).toHaveCount(step.choices!.length);
          for (const choice of await choices.all()) {
            await expect(choice).toHaveAttribute("type", "button");
          }
          await choices.first().click();
          await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
        }
        if (role === "signal") {
          await expect(card.getByRole("slider")).toBeVisible();
          await expect(card.getByRole("textbox", {
            name: "주파수 직접 입력",
            exact: true,
          })).toBeVisible();
        }
        if (role === "cipher") {
          await card.locator(".calendar").scrollIntoViewIfNeeded();
          await expect(card.locator(".calendar")).toBeInViewport();
        }
        await expectNoHorizontalOverflow(page);
        await expect(page.getByTestId("mission-v2-private-digit")).toHaveCount(0);
        await expect(page.getByTestId("mission-v2-transfer-clue")).toHaveCount(0);

        if (
          process.env.CAPTURE_PUBLIC_FIXTURE === "1" && width === 390 &&
          (role === "signal" || role === "cipher")
        ) {
          const folder = new URL("../../.demo-data/", import.meta.url);
          mkdirSync(folder, { recursive: true });
          await page.screenshot({
            path: fileURLToPath(new URL(
              role === "signal"
                ? "legacy-radio-public.png"
                : "legacy-calendar-public.png",
              folder,
            )),
            animations: "disabled",
          });
        }

        const submit = card.getByRole("button", {
          name: "문제 제출",
          exact: true,
        });
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeInViewport();
        const report = page.getByRole("button", {
          name: "조사 결과 보고",
          exact: true,
        });
        await report.scrollIntoViewIfNeeded();
        await expect(report).toBeInViewport();
        await expectNoHorizontalOverflow(page);
      });
    }
    expect(actions).toContain("get-stage");
    expect(
      actions.every((action) => action === "get-game" || action === "get-stage"),
    ).toBe(true);
  });
}

test("지휘관 목업 전환은 화면 위치만 이어 받고 입력한 숫자는 저장하지 않는다", async ({ page }) => {
  const fixture = publicFixture("commander");
  await page.setViewportSize({ width: 1440, height: 900 });
  const actions = await renderFixture(page, fixture);
  await page.getByRole("button", { name: "팀 자물쇠로", exact: true }).click();
  const firstDigit = page.getByRole("textbox", {
    name: "지휘관 잠금 숫자",
    exact: true,
  });
  await expect(firstDigit).toHaveValue("");
  // Arbitrary unsent draft, not an answer; the public fixture has no digit values.
  await firstDigit.fill("4");
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "폰 목업으로 보기", exact: true })
    .click();
  const app = page.frameLocator(PHONE_SCREEN);
  await expect(app.locator('[data-scene="lock"]')).toBeVisible();
  await expect(
    app.getByRole("textbox", { name: "지휘관 잠금 숫자", exact: true }),
  ).toHaveValue("");
  await expectNoHorizontalOverflow(app);
  await expect.poll(() =>
    page.evaluate(() => {
      const handoff = sessionStorage.getItem("hoguk:view-handoff");
      return handoff ? JSON.parse(handoff).lock : "missing";
    })
  ).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("hoguk-pending")))
    .toBeNull();

  await app.getByRole("textbox", { name: "지휘관 잠금 숫자", exact: true })
    .fill("7");
  await app.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await app.getByRole("button", { name: "폰 목업 끄기", exact: true }).click();
  await expect(page.locator(PHONE_SCREEN)).toHaveCount(0);
  await expect(page.locator('[data-scene="lock"]')).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "지휘관 잠금 숫자", exact: true }),
  ).toHaveValue("");
  await expect(page.getByTestId("mission-v2-private-digit")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(
    actions.every((action) => action === "get-game" || action === "get-stage"),
  ).toBe(true);
});
