import { test as base, expect, type Page } from "@playwright/test";

type CameraProbe = Window & {
  __photoStreams: MediaStream[];
  __photoRequestIds: string[];
};

const test = base.extend<{ gameRequests: string[] }>({
  gameRequests: async ({ page }, use) => {
    const requests: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const realGameRequest = url.hostname.endsWith(".supabase.co")
        || /^\/(functions|auth|rest|storage)\/v1\//.test(url.pathname)
        || /^\/api\/(game|photo)(\/|$)/.test(url.pathname);
      if (realGameRequest) {
        requests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await use(requests);
    expect(requests, "The isolated preview must not call a real game or Supabase API").toEqual([]);
  },
});

test.beforeEach(async ({ page, gameRequests }) => {
  expect(gameRequests).toEqual([]);
  await page.addInitScript(() => {
    const probe = window as unknown as CameraProbe;
    probe.__photoStreams = [];
    probe.__photoRequestIds = [];
    const originalCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await originalCamera(constraints);
      probe.__photoStreams.push(stream);
      return stream;
    };
    const originalUuid = crypto.randomUUID.bind(crypto);
    crypto.randomUUID = () => {
      const id = originalUuid() as `${string}-${string}-${string}-${string}-${string}`;
      probe.__photoRequestIds.push(id);
      return id;
    };
  });
  await page.goto("/dev/scout-photo");
  await expect(page.getByRole("button", { name: "카메라 켜기", exact: true })).toBeVisible();
});

async function capture(page: Page) {
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  const video = page.getByLabel("촬영 중인 카메라");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "사진 촬영", exact: true }).click();
  const preview = page.getByRole("img", { name: "방금 촬영한 사진 미리보기" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => page.evaluate(() => (window as unknown as CameraProbe).__photoStreams
    .every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
}

test("synthetic camera capture unlocks the quiz, then completes without real API traffic", async ({ page }) => {
  await expect(page.getByLabel("사진 모의 판정")).toHaveValue("match");
  await expect(page.getByRole("button", { name: "답안 제출", exact: true })).toHaveCount(0);
  await capture(page);
  await page.getByRole("button", { name: "사진 제출", exact: true }).click();
  await expect(page.getByRole("heading", { name: "사진 검증 통과", exact: true })).toBeVisible();
  const submitChoice = page.getByRole("button", { name: "답안 제출", exact: true });
  await expect(submitChoice).toBeDisabled();
  await page.getByRole("radio", { name: "빛을 모은 모양" }).check();
  await submitChoice.click();
  await expect(page.getByRole("heading", { name: "개인 미션 시연 완료" })).toBeVisible();
  await expect(page.getByText("실제 방의 보고·숫자·자물쇠에는 반영되지 않습니다.")).toBeVisible();
  await expect(page.getByRole("img", { name: "방금 촬영한 사진 미리보기" })).toHaveCount(0);
});

test("three no-match captures pass only the photo stage without claiming verified success", async ({ page }) => {
  await page.getByLabel("사진 모의 판정").selectOption("no_match");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await capture(page);
    await page.getByRole("button", { name: "사진 제출", exact: true }).click();
    if (attempt < 3) {
      await expect(page.getByText(`실패 ${attempt} / 3`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "답안 제출", exact: true })).toHaveCount(0);
    }
  }
  await expect(page.getByRole("heading", { name: "사진 검증 실패 후 통과", exact: true })).toBeVisible();
  await expect(page.getByText("사진 검증 성공으로 기록되지 않습니다. 다음 객관식 문제를 풀어 주세요.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "사진 검증 통과", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "개인 미션 시연 완료" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "답안 제출", exact: true })).toBeDisabled();
});

test("a service outage does not consume a failure and retry reuses the existing request ID", async ({ page }) => {
  await page.getByLabel("사진 모의 판정").selectOption("service_error");
  await capture(page);
  const beforeSubmit = await page.evaluate(() => (window as unknown as CameraProbe).__photoRequestIds.length);
  await page.getByRole("button", { name: "사진 제출", exact: true }).click();
  const retry = page.getByRole("button", { name: "같은 요청으로 다시 시도", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText("실패 0 / 3", { exact: true })).toBeVisible();
  const firstIds = await page.evaluate(() => (window as unknown as CameraProbe).__photoRequestIds.slice());
  expect(firstIds.length).toBe(beforeSubmit + 1);
  await page.getByLabel("사진 모의 판정").selectOption("match");
  await retry.click();
  await expect(page.getByRole("heading", { name: "사진 검증 통과", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as CameraProbe).__photoRequestIds.slice())).toEqual(firstIds);
  await expect(retry).toHaveCount(0);
});

test("unavailable capture remains usable at 360px and other roles hide the personal mission", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByRole("button", { name: "촬영 불가", exact: true }).click();
    await page.getByRole("radio", { name: "촬영 금지 장소" }).check();
    await page.getByRole("button", { name: "촬영 불가 제출", exact: true }).click();
    if (attempt < 3) await expect(page.getByText(`실패 ${attempt} / 3`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "사진 검증 실패 후 통과", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "답안 제출", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as CameraProbe).__photoStreams.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const role of ["commander", "signal", "cipher"]) {
    await page.getByLabel("미리 볼 역할").selectOption(role);
    await expect(page.getByText("이 역할에는 정찰원의 이미지·단서·문항을 표시하지 않습니다.")).toBeVisible();
    await expect(page.getByRole("img", { name: "상징 이미지 준비 중" })).toHaveCount(0);
    await expect(page.getByText("나는 날개가 없어도 바람의 방향을 이야기한다.", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "카메라 켜기", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("switching away from the scout view stops an open camera", async ({ page }) => {
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect(page.getByLabel("촬영 중인 카메라")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as CameraProbe).__photoStreams
    .some((stream) => stream.getTracks().some((track) => track.readyState === "live")))).toBe(true);
  await page.getByLabel("미리 볼 역할").selectOption("commander");
  await expect(page.getByText("이 역할에는 정찰원의 이미지·단서·문항을 표시하지 않습니다.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as CameraProbe).__photoStreams
    .every((stream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
});
