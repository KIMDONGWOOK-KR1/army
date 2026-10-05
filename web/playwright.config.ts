import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 10000,
  },
  webServer: {
    command: "npm run dev -- --port " + (new URL(baseURL).port || "3000"),
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
