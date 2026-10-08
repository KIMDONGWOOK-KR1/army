import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/verify-v2.spec.ts", "**/integrated-v2*.spec.ts", "**/legacy-gate-v2.spec.ts"],
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
