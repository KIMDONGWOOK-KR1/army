import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PHOTO_PREVIEW_BASE_URL ?? "http://127.0.0.1:3016";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "scout-photo-preview.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "./test-results/scout-photo",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    permissions: ["camera"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PHOTO_PREVIEW_BASE_URL ? undefined : {
    command: "npm run dev -- --webpack --port 3016",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
