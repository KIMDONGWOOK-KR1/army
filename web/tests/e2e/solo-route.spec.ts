import { expect, test } from "@playwright/test";
import { ROLES, type Role } from "../../supabase/functions/_shared/types";

// 혼자 데모 체험(hh 2026-10-27): 한 기기가 네 자리를 맡아 4인 방과 같은 네 곳(정문 → 용봉관 → 추모의 벽 → 봉지)을 끝까지 간다.
// 문제는 해설 경로로 빠르게 넘기고(서버 규칙 그대로), 이동·지도·헌화·공동 기록·결과는 화면으로 확인한다.
const NAMES: Record<Role, string> = { commander: "지휘관", scout: "정찰원", signal: "통신원", cipher: "암호해독관" };
// 정찰원 '사진으로 찾기'는 가짜 카메라(초록 시험 화면)로 찍는다. 판정은 화면의 시연 판정(모의)으로 고른다.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
const fresh = () => {
  localStorage.setItem("hoguk:narration", "off");
  localStorage.setItem("hoguk:stop", "off");
  localStorage.setItem("hoguk:sound", "off");
  // 다른 시험이 켜 둔 예전 두 곳 시연·사진 찾기 끄기 스위치를 지운다
  localStorage.removeItem("hoguk:demo-course");
  localStorage.removeItem("hoguk:photo-gate");
};

test("solo demo walks all four places with role switching, a map button and the departure dock", async ({ page }) => {
  await page.addInitScript(fresh);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "혼자 데모 체험", exact: true }).click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible({ timeout: 30000 });
  const solo = await page.evaluate(() => JSON.parse(localStorage.getItem("hoguk:solo") ?? "null")) as
    { game: string; seats: Record<Role, number>; role: Role };
  expect(Object.keys(solo.seats).sort()).toEqual([...ROLES].sort());
  const bar = page.locator(".demo-role-bar");
  await expect(bar.getByRole("button", { name: "지휘관", exact: true })).toHaveAttribute("aria-pressed", "true");

  let stage = "gate";
  const call = async (role: Role, action: string, extra: Record<string, unknown> = {}) => {
    const response = await page.request.post("/api/game/solo", { data: { seat: solo.seats[role],
      command: { action, game_id: solo.game, stage_id: stage, request_id: crypto.randomUUID(), ...extra } } });
    expect(response.status(), `${role} ${action}`).toBe(200);
    return await response.json();
  };
  const asRole = async (role: Role) => {
    await bar.getByRole("button", { name: NAMES[role], exact: true }).click();
    await expect(bar.getByRole("button", { name: NAMES[role], exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-scene]").first()).toBeVisible();
  };
  const arrive = async () => {
    await page.getByRole("button", { name: "시연 팀 함께 도착" }).click();
    await expect(page.locator('[data-scene="travel"]')).toHaveCount(0);
  };
  const departAndContinue = async (to: string) => {
    const depart = page.getByTestId("depart-next-stage");
    // 기록을 읽는 중에도 지휘관의 출발 단추가 화면 안에 있다
    await expect(depart).toBeInViewport();
    await depart.click();
    const card = page.getByTestId("depart-card");
    await expect(card).toContainText(to);
    await card.getByRole("button", { name: /지도에서 길 보기/ }).click();
    await expect(page.locator('[data-scene="travel"]')).toBeVisible();
  };

  // 정문: 네 자리가 함께 도착하고, 보직을 바꾸면 그 보직의 문제 화면이 보인다. 지도는 갔다가 돌아온다.
  await arrive();
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await asRole("scout");
  await expect(page.locator(".mission-header h1")).toContainText("정찰원");
  // 정찰원: 불꽃을 사진으로 찾아야 표지석 글 문제가 열린다. 한 번 틀리면 실루엣이 선명해지고 힌트가 나온다.
  const scan = page.getByTestId("scout-scan");
  await expect(scan).toContainText("실패 0 / 3");
  await expect(page.getByTestId("mission-v2-quest")).toContainText("0 / 2");
  await expect(page.getByTestId("scout-scan-locked")).toBeVisible();
  // 빠른 시작처럼 동그라미에 맞춰 멈추면 알아서 확인한다. 가짜 카메라 화면은 계속 움직여서 '지금 확인'으로 찍는다.
  const shoot = async () => {
    await scan.getByRole("button", { name: /카메라로 비추기|다시 비추기/ }).click();
    await expect(scan.locator("video")).toBeVisible();
    await page.waitForFunction(() => (document.querySelector('[data-testid="scout-scan"] video') as HTMLVideoElement | null)?.videoWidth);
    await expect(scan).toContainText("불꽃을 동그라미 안에 맞춰요");
    await scan.getByRole("button", { name: /지금 확인/ }).click();
  };
  await scan.getByLabel("다르게").check();
  await shoot();
  await expect(scan).toContainText("실패 1 / 3");
  await expect(scan).toContainText("힌트 1");
  await scan.getByLabel("맞게").check();
  await shoot();
  await expect(scan).toContainText("찾았어요!");
  await expect(page.getByTestId("scout-scan-result")).toContainText("사진으로 찾음");
  await expect(page.getByTestId("scout-scan-locked")).toHaveCount(0);
  await expect(page.locator('[data-testid^="mission-v2-step-"]').first()).toBeVisible();
  await expect(page.getByTestId("mission-v2-quest")).toContainText("1 / 2");
  await page.getByTestId("map-fab").click();
  await expect(page.getByTestId("map-peek")).toContainText("시연 중이라 거점 앞에 서 있어요");
  await page.getByTestId("map-peek").getByRole("button", { name: "돌아가기" }).click();
  await expect(page.getByTestId("map-peek")).toHaveCount(0);
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await asRole("commander");
  for (const [i, id] of ["gate", "yongbong"].entries()) {
    stage = id;
    if (i) await arrive();
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await call("commander", "request-hint", { target_role: role, level });
      await call(role, "submit-report");
      await call(role, "confirm-explanation");
    }
    await call("commander", "open-after-explanation");
    await expect(page.locator('[data-scene="sacho"]')).toBeVisible();
    await departAndContinue(i ? "추모의 벽" : "용봉관");
  }

  // 추모의 벽: 묵념 뒤 네 보직이 차례로 국화를 올린다
  stage = "wall";
  await arrive();
  const finish = page.getByRole("button", { name: "묵념 마치기", exact: true });
  if (await finish.isVisible()) await finish.click().catch(() => undefined);
  await expect(page.locator('[data-scene="mission"]')).toBeVisible();
  await expect(page.getByTestId("map-fab")).toBeVisible();
  for (const role of ["scout", "signal", "cipher", "commander"] as const) {
    await asRole(role);
    await page.getByRole("button", { name: "국화 올리기", exact: true }).click();
  }
  await expect(page.getByTestId("stage-v2-completed")).toBeVisible();
  await departAndContinue("봉지");

  // 봉지: 회고 넷, 지휘관의 공동 기록, 네 사람 동의 → 결과
  stage = "bongji";
  await arrive();
  for (const role of ROLES) await call(role, "submit-retro", { text: `[시연] ${NAMES[role]} 회고` });
  await page.getByRole("button", { name: "공동 기록 작성", exact: true }).click();
  for (let k = 1; k <= 3; k++) await page.getByLabel(`낱말 ${k}`, { exact: true }).selectOption({ index: k });
  await page.getByLabel("공동 문장", { exact: true }).fill("[시연] 공동 문장");
  await page.getByLabel("공동 근거", { exact: true }).fill("[시연] 공동 근거");
  await page.getByRole("button", { name: "공동 기록 저장", exact: true }).click();
  await expect(page.getByTestId("joint-record")).toContainText("기록 버전 1");
  const draft = await call("commander", "get-game");
  for (const role of ROLES) await call(role, "consent-joint-record", { draft_version: draft.self.joint_record.draft_version });
  await expect(page.getByTestId("result-v2")).toBeVisible();
  await expect(page.getByTestId("result-v2")).toContainText("4/4");
});

test("three failed photo checks pass only the photo step and keep the question", async ({ page }) => {
  await page.addInitScript(fresh);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "혼자 데모 체험", exact: true }).click();
  await expect(page.locator('[data-scene="travel"]')).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "시연 팀 함께 도착" }).click();
  await page.locator(".demo-role-bar").getByRole("button", { name: "정찰원", exact: true }).click();
  const scan = page.getByTestId("scout-scan");
  for (const n of [1, 2, 3]) {
    await scan.getByRole("button", { name: /촬영할 수 없어요/ }).click();
    await scan.getByRole("button", { name: "알리기" }).click();
    if (n < 3) await expect(scan).toContainText(`실패 ${n} / 3`);
  }
  const result = page.getByTestId("scout-scan-result");
  await expect(result).toContainText("사진 검증 실패 후 통과");
  await expect(result).toHaveAttribute("data-verified", "false");
  await expect(page.locator('[data-testid^="mission-v2-step-"]').first()).toBeVisible();
});

test("solo seats cannot create or join other rooms", async ({ page }) => {
  await page.goto("/");
  const post = (data: Record<string, unknown>) => page.request.post("/api/game/solo", { data });
  expect((await post({ seat: 1, command: { action: "join-game", code: "ABCD", nickname: "x", request_id: "x1" } })).status()).toBe(403);
  expect((await post({ seat: 1, command: { action: "create-game", nickname: "x", request_id: "x2" } })).status()).toBe(403);
  expect((await post({ seat: 9, command: { action: "get-game" } })).status()).toBe(400);
});
