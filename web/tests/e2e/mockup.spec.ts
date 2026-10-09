import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// 폰 목업 보기: 노트북·발표 화면에서 실제 앱을 폰 모양 틀(같은 출처 iframe 390×844)에 담아 본다.
const SCREEN = 'iframe[title="호국실록 폰 화면"]';
const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem("hoguk:mockup"));

test("?mockup=1은 폰 틀 안에 첫 화면을 띄우고, 틀 안 메뉴로 지금 화면으로 돌아온다", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 바깥 문서의 게임 요청(틀 안 앱의 요청과 나눠 센다)
  let hostApi = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/") && r.frame() === page.mainFrame()) hostApi++;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // 저장된 선택도 켜 두어, 틀 안의 끄기가 저장값을 실제로 지우는지 본다
  await page.goto("/?mockup=0");
  // 이 문서의 게임이 첫 요청을 마친 뒤에 센다
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => localStorage.setItem("hoguk:mockup", "on"));
  hostApi = 0;
  await page.goto("/?mockup=1");
  await expect(page.locator("[data-phone-mockup]")).toBeVisible();
  const app = page.frameLocator(SCREEN);
  await expect(app.locator('[data-scene="title"]')).toBeVisible();
  await expect(
    app.getByRole("button", { name: "혼자 데모 체험", exact: true }),
  ).toBeEnabled();
  // 바깥 문서는 서버가 그린 앱을 감춰 둘 뿐 게임을 돌리지 않는다(틀만 그린다)
  await expect(page.locator(".game-canvas")).toBeHidden();
  expect(hostApi).toBe(0);
  // '본문으로 건너뛰기'는 폰 화면으로 간다
  expect(
    await page.evaluate(() => document.getElementById("main-content")?.tagName),
  ).toBe("IFRAME");
  // 틀 안 앱은 폰과 같은 390×844 화면을 본다
  expect(
    await app
      .locator("html")
      .evaluate(() => [window.innerWidth, window.innerHeight]),
  ).toEqual([390, 844]);
  // 폰이 창 높이의 88%쯤을 채우고 가운데에 선다
  const phone = (await page.locator(SCREEN).boundingBox())!;
  expect(phone.width).toBeGreaterThan(300);
  expect(Math.abs(phone.x + phone.width / 2 - 720)).toBeLessThan(2);
  // 키보드 초점은 폰 화면 안에 있다
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .toBe("IFRAME");
  await page.evaluate(() => document.fonts.ready);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  // 줄어든 틀 위에서 누른 자리가 틀 안 단추에 그대로 닿는다
  const scale = phone.width / 390;
  const menu = await app
    .getByRole("button", { name: "메뉴 열기" })
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  await page.mouse.click(phone.x + menu.x * scale, phone.y + menu.y * scale);
  await expect(app.getByRole("dialog")).toBeVisible();
  await expect(
    app.getByRole("button", { name: "폰 목업으로 보기" }),
  ).toHaveCount(0);
  await app.getByRole("button", { name: "폰 목업 끄기" }).click();
  await expect(page.locator(SCREEN)).toHaveCount(0);
  await expect(page.locator(".game-canvas")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await stored(page)).toBeNull();
  expect(errors).toEqual([]);
});

test("지금 화면의 메뉴로 목업을 켜면 새로 고쳐도 이어지고, 폰 크기 창에는 메뉴가 없다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험", exact: true }),
  ).toBeEnabled();
  // 창을 폰 폭으로 줄이면 메뉴에서 목업 단추가 빠지고, 다시 넓히면 돌아온다
  const menuItems = async () => {
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const n = await page
      .getByRole("button", { name: "폰 목업으로 보기" })
      .count();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return n;
  };
  await page.setViewportSize({ width: 650, height: 900 });
  expect(await menuItems()).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await menuItems()).toBe(1);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "폰 목업으로 보기" }).click();
  await expect(page.locator(SCREEN)).toBeVisible();
  await expect(page.locator(".game-canvas")).toHaveCount(0);
  expect(await stored(page)).toBe("on");
  await page.reload();
  const app = page.frameLocator(SCREEN);
  await expect(app.locator('[data-scene="title"]')).toBeVisible();
  // 바깥의 끄기 단추도 지금 화면으로 돌린다
  await page.getByRole("button", { name: "목업 끄기", exact: true }).click();
  await expect(page.locator(SCREEN)).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  // ?mockup=0은 저장된 선택보다 앞선다
  await page.evaluate(() => localStorage.setItem("hoguk:mockup", "on"));
  await page.goto("/?mockup=0");
  await expect(page.locator(".game-canvas")).toBeVisible();
  await expect(page.locator(SCREEN)).toHaveCount(0);
  // 폰 크기 창: 저장값이 있어도 그냥 앱을 열고, 메뉴에 목업 단추가 없다
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "혼자 데모 체험", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(SCREEN)).toHaveCount(0);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "전체 화면" })).toBeVisible();
  await expect(page.getByRole("button", { name: /폰 목업/ })).toHaveCount(0);
});

test("합류 링크(/j/코드)도 경로를 지킨 채 목업 안에서 열린다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/j/abcd?mockup=1");
  await expect(page.locator(SCREEN)).toHaveAttribute("src", "/j/abcd");
  const app = page.frameLocator(SCREEN);
  await expect(app.locator('[data-scene="enroll"]')).toBeVisible();
  await expect(app.locator(".code-input")).toHaveValue("ABCD");
  await expect(page.locator(".game-canvas")).toBeHidden();
});

test("서버가 그린 첫 화면은 그대로이고, 다른 사이트의 틀에는 담기지 않는다", async ({
  page,
  request,
  baseURL,
}) => {
  // 폰에서 JS가 오기 전에도 첫 화면이 보이게 서버 HTML에 앱이 들어 있다(목업 여부는 첫 그림 전 스크립트가 정한다)
  const html = await (await request.get("/")).text();
  expect(html).toContain('data-scene="title"');
  expect(html).toContain("__hogukMockup");
  const join = await (await request.get("/j/abcd")).text();
  expect(join).toContain('data-scene="enroll"');
  // 같은 출처 틀만 허용한다
  const response = (await page.goto("/"))!;
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self'",
  );
  const api = await request.post("/api/game", {
    data: { action: "get-game" },
  });
  expect(api.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  // 다른 출처 문서가 앱을 iframe에 담으면 앱이 뜨지 않는다
  await page.route("http://other-site.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe src="${baseURL}/" width="390" height="844" data-phone-screen></iframe>`,
    }),
  );
  await page.goto("http://other-site.test/");
  await page.waitForLoadState("load");
  await page.waitForTimeout(1500);
  const child = page.frames().find((f) => f !== page.mainFrame());
  expect(child).toBeTruthy();
  expect(await child!.locator("[data-scene]").count()).toBe(0);
});

test("목업 안에서 고른 전체 화면·대화 상자는 바깥 틀이 받고, 다른 곳에서 온 메시지는 듣지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mockup=1");
  const app = page.frameLocator(SCREEN);
  await expect(
    app.getByRole("button", { name: "혼자 데모 체험", exact: true }),
  ).toBeEnabled();
  // 바깥 문서 자신이 보낸 끄기 메시지는 무시한다(틀 안 iframe에서 온 것만 듣는다)
  await page.evaluate(() =>
    window.postMessage(
      { type: "hoguk:mockup", action: "exit" },
      window.location.origin,
    ),
  );
  await page.waitForTimeout(500);
  await expect(page.locator(SCREEN)).toHaveCount(1);
  // 틀 안 대화 상자가 열리면 바깥 상태·홈 표시줄도 같은 막으로 어두워진다
  const screen = page.locator("[data-phone-mockup] [data-dim]");
  await expect(screen).toHaveCount(0);
  await app.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(app.getByRole("dialog")).toBeVisible();
  await expect(screen).toHaveCount(1);
  // 틀 안 '전체 화면'은 폰 틀째로(바깥 문서를) 띄운다
  await app.getByRole("button", { name: "전체 화면" }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.tagName))
    .toBe("HTML");
  await expect(screen).toHaveCount(0);
  await page.evaluate(() => document.exitFullscreen());
});

test("자동 시연 중에 보기를 바꿔도 시연이 끊기거나 처음부터 다시 시작하지 않는다", async ({
  page,
}) => {
  let creates = 0;
  page.on("request", (r) => {
    if (
      r.url().includes("/api/game") &&
      /"create-demo"/.test(r.postData() ?? "")
    )
      creates++;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const autoButton = page.getByRole("button", {
    name: "자동 시연",
    exact: true,
  });
  await expect(autoButton).toBeEnabled();
  await autoButton.click();
  // 첫 시연 작전 만들기는 개발 서버에서 몇 초 걸릴 수 있다
  await expect(page.locator('[data-scene="lobby"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "폰 목업으로 보기" }).click();
  const app = page.frameLocator(SCREEN);
  await expect(app.locator(".hud-auto")).toBeVisible({ timeout: 30_000 });
  await expect(app.getByRole("button", { name: "시연 정지" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // 같은 시연 작전의 모이기·보직 공개에서 이어 간다(첫 화면으로 돌아가지 않는다)
  await expect(
    app.locator('[data-scene="lobby"], [data-scene="briefing"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "목업 끄기", exact: true }).click();
  await expect(page.locator(".hud-auto")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "시연 정지" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator(
      '[data-scene="lobby"], [data-scene="briefing"], [data-scene="equip"], [data-scene="travel"]',
    ),
  ).toBeVisible();
  expect(creates).toBe(1);
  // 그냥 새로 고침하면 지금처럼 처음 화면에서 시작한다(넘겨받기는 보기를 바꿀 때만)
  await page.reload();
  await expect(autoButton).toBeEnabled();
});
