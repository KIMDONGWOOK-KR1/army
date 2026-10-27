import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/verify-v2.spec.ts", "**/integrated-v2*.spec.ts", "**/legacy-gate-v2.spec.ts", "**/restored-scenes-v2.spec.ts"],
  workers: 1,
  timeout: 120000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 10000,
    // 타자 나레이션은 narration.spec.ts에서만, 거점 원판 화면은
    // narration.spec.ts와 stop-screen.spec.ts에서만 켠다.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            { name: "hoguk:narration", value: "off" },
            { name: "hoguk:stop", value: "off" },
            // 혼자 데모 체험은 네 곳 코스가 기본이다. 예전 두 곳 혼자 시연을 다루는 시험은 이 스위치로 고른다.
            { name: "hoguk:demo-course", value: "v1" },
            // 정찰원 '사진으로 찾기'(모의 판정)는 solo-route.spec.ts에서만 켠다
            { name: "hoguk:photo-gate", value: "off" },
          ],
        },
      ],
    },
  },
  webServer: {
    command: "npm run dev -- --webpack --port " + (new URL(baseURL).port || "3000"),
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
