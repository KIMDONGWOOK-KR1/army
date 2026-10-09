import { test, expect, type Page } from "@playwright/test";

// 합성 소리 엔진: 첫 누름 전에는 오디오를 만들지 않고, 장면마다 소리를 내며,
// 끄기는 hoguk:sound에 남아 새로고침 뒤에도 이어진다. 실제 스피커 출력은 보지 않고
// 엔진이 낸 소리 이름(hoguk:sound 이벤트)과 AudioContext 상태만 본다.
declare global {
  interface Window {
    __sound: { contexts: AudioContext[]; names: string[] };
    __bgm: { mood: string; style: string }[];
  }
}

const heard = (page: Page) => page.evaluate(() => window.__sound.names.slice());
const state = (page: Page) =>
  page.evaluate(() => window.__sound.contexts[0]?.state ?? "none");

test("sound cues follow the scenes and the mute toggle persists", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__sound = { contexts: [], names: [] };
    window.addEventListener("hoguk:sound", (e) =>
      window.__sound.names.push((e as CustomEvent<string>).detail),
    );
    const Base = window.AudioContext;
    if (Base)
      window.AudioContext = class extends Base {
        constructor(o?: AudioContextOptions) {
          super(o);
          window.__sound.contexts.push(this);
        }
      };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "소리 끄기" })).toBeVisible();
  // 사용자가 누르기 전에는 오디오를 열지 않는다(iOS 자동 재생 규칙)
  expect(await state(page)).toBe("none");

  const demo = page.getByRole("button", { name: "혼자 데모 체험", exact: true });
  await expect(demo).toBeEnabled({ timeout: 30000 });
  await demo.click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await expect.poll(() => state(page)).toBe("running");
  expect(await heard(page)).toContain("tap");

  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  await expect(page.locator(".mission-form")).toBeVisible();
  await expect.poll(() => heard(page)).toContain("arrive");

  // 지휘관: 틀린 답 한 번(부드러운 소리) 뒤 맞는 답
  await page.getByRole("button", { name: "지휘관", exact: true }).click();
  await page.locator(".choices button").first().click();
  await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
  await expect.poll(() => heard(page)).toContain("clue-wrong");
  await page
    .getByRole("button", { name: /학교 출입을 막는 계엄군에 항의하려고/ })
    .click();
  await page.waitForTimeout(1100); // 같은 보직의 연속 보고 제한(1초)
  await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
  await expect(page.locator('[data-scene="report"]')).toBeVisible();
  await expect.poll(() => heard(page)).toContain("clue-correct");
  await expect.poll(() => heard(page)).toContain("digit-reveal");

  for (const [role, fill] of [
    ["정찰원", async () => page.getByPlaceholder("현장에서 찾은 답을 입력하라").fill("1")],
    [
      "통신원",
      async () =>
        page.getByRole("spinbutton", { name: "주파수 직접 입력" }).fill("51.8"),
    ],
    ["암호해독관", async () => page.getByRole("button", { name: /일요일$/ }).click()],
  ] as const) {
    await page.getByRole("button", { name: role, exact: true }).click();
    await expect(page.locator(".mission-form")).toBeVisible();
    await fill();
    await page.getByRole("button", { name: "단서 확인하고 보고" }).click();
    await expect(page.locator('[data-scene="report"]')).toBeVisible();
  }
  await page.getByRole("button", { name: "지휘관", exact: true }).click();
  await page.getByRole("button", { name: "팀 자물쇠로" }).click();
  await expect(page.locator('[data-scene="lock"]')).toBeVisible();
  const before = (await heard(page)).filter((n) => n === "lock-tick").length;
  for (const [i, role] of ["지휘관", "정찰원", "통신원", "암호해독관"].entries())
    await page
      .getByRole("textbox", { name: `${role} 잠금 숫자` })
      .fill(["2", "1", "3", "7"][i]);
  await expect
    .poll(async () => (await heard(page)).filter((n) => n === "lock-tick").length)
    .toBeGreaterThanOrEqual(before + 2);
  await page.getByRole("button", { name: "자물쇠 확인", exact: true }).click();
  await expect(page.locator('[data-scene="sacho"]')).toBeVisible();
  await expect.poll(() => heard(page)).toContain("lock-open");
  await expect.poll(() => heard(page)).toContain("sacho");

  // 끄면 저장되고, 그 뒤로는 아무 소리도 내지 않는다
  await page.getByRole("button", { name: "소리 끄기" }).click();
  await expect(page.getByRole("button", { name: "소리 켜기" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hoguk:sound"))).toBe(
    "off",
  );
  await expect.poll(() => state(page)).toBe("suspended");
  const quiet = (await heard(page)).length;
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "게임으로 돌아가기" }).click();
  expect((await heard(page)).length).toBe(quiet);

  // 새로고침해도 꺼져 있고, 작전 메뉴에서 다시 켤 수 있다
  await page.reload();
  await expect(page.getByRole("button", { name: "소리 켜기" })).toBeVisible();
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await page.getByRole("button", { name: "효과음·배경음 켜기" }).click();
  expect(await page.evaluate(() => localStorage.getItem("hoguk:sound"))).toBe(
    "on",
  );
  await expect(
    page.getByRole("button", { name: "효과음·배경음 끄기" }),
  ).toBeVisible();
  await expect.poll(() => state(page)).toBe("running");
  await expect.poll(() => heard(page)).toContain("confirm");
  expect(errors).toEqual([]);
});

// 배경음 갈래: 기본은 산책(a), 주소의 ?bgm=a|b|c로 바꿔 들어 볼 수 있고 틀린 값은 무시한다.
// 엔진이 새 분위기를 시작할 때 알리는 hoguk:bgm 이벤트로 확인한다(경우마다 새 브라우저 상태).
for (const [query, style] of [
  ["?bgm=c", "c"],
  ["?bgm=B", "b"],
  ["?bgm=zzz", "a"],
  ["", "a"],
] as const)
  test(`BGM style for "${query || "no query"}" is ${style}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__bgm = [];
      window.addEventListener("hoguk:bgm", (e) =>
        window.__bgm.push(
          (e as CustomEvent<{ mood: string; style: string }>).detail,
        ),
      );
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/" + query);
    const demo = page.getByRole("button", { name: "혼자 데모 체험", exact: true });
    await expect(demo).toBeEnabled({ timeout: 30000 });
    await demo.click();
    await expect(page.locator('[data-scene="travel"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__bgm.slice()))
      .toContainEqual({ mood: "field", style });
    const all = await page.evaluate(() => window.__bgm.map((d) => d.style));
    expect(all.every((s) => s === style)).toBe(true);
    expect(errors).toEqual([]);
  });

// 5·18 조용한 구역: 첫 거점(정문, 추모 거점) 둘레 조용한 구역(50m)에 들어서면 아직 도착 전(이동 장면)인데도
// 박 있는 이동 배경음이 북·가락 없는 추모 숨결로 바뀌고, 도착한 뒤에도 그대로 이어진다.
// 시연 이동은 느린 그래픽에서 오래 걸리므로 위치(정문 북쪽 약 40m, 도착 반경 30m 밖)를 준다.
test("BGM hushes to the memorial breath inside the 5·18 quiet zone before arrival", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.1729167 + 0.00036, longitude: 126.9050828, accuracy: 5 });
  await page.addInitScript(() => {
    window.__bgm = [];
    window.addEventListener("hoguk:bgm", (e) =>
      window.__bgm.push((e as CustomEvent<{ mood: string; style: string }>).detail),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const demo = page.getByRole("button", { name: "혼자 데모 체험", exact: true });
  await expect(demo).toBeEnabled({ timeout: 30000 });
  await demo.click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  const moods = () => page.evaluate(() => window.__bgm.map((d) => d.mood));
  await expect.poll(moods).toContain("field");
  // WebGL을 못 쓰는 환경에서는 지도(위치 판정)가 없으므로 건너뛴다
  const hasField = await page
    .locator(".field-3d canvas")
    .first()
    .waitFor({ state: "attached", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasField, "WebGL 필드가 뜨지 않는 환경");
  await page.getByRole("button", { name: "위치 확인" }).click();
  await expect
    .poll(async () => (await moods()).slice((await moods()).indexOf("field")), {
      timeout: 60000,
    })
    .toContain("memorial");
  await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  await page.getByRole("button", { name: "시연 거점에 도착" }).click();
  await expect(page.locator(".mission-form")).toBeVisible();
  await page.waitForTimeout(500);
  // 도착해도 숨결이 이어진다(다시 박 있는 분위기로 돌아가지 않는다)
  const after = await moods();
  expect(after[after.length - 1]).toBe("memorial");
  expect(errors).toEqual([]);
});
