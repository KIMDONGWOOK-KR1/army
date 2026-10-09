import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

// A fresh local server and course revision prevent existing sessions/salts from
// being reused. This configuration never calls a deployed Supabase project.
const baseURL = "http://127.0.0.1:3012";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "verify-v2.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: "list",
  preserveOutput: "never",
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    actionTimeout: 10000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --webpack --port 3012",
    url: `${baseURL}/verify`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_BACKEND: "local",
      LOCAL_V2_COURSE_ID: `jnu-demo-dev-ui-${randomUUID().slice(0, 20)}`,
      ANSWER_SALT: randomBytes(32).toString("hex"),
    },
  },
});
