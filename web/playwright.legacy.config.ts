import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3015";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Fresh local v1-gate preset only. No deployed service or existing salt is used.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "legacy-gate-v2.spec.ts",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: "list",
  preserveOutput: "never",
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    actionTimeout: 10000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --webpack --port 3015",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_BACKEND: "local",
      LOCAL_V2_PRESET: "v1-gate",
      LOCAL_V2_COURSE_ID: `jnu-demo-dev-v1-${randomUUID().slice(0, 16)}`,
      ANSWER_SALT: randomBytes(32).toString("hex"),
    },
  },
});
