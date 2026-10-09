import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3016";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "gps-arrival.spec.ts", workers: 1,
  timeout: 150000, expect: { timeout: 15000 }, reporter: "list", preserveOutput: "never",
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3016",
    url: baseURL, reuseExistingServer: false, timeout: 120000,
    env: { NEXT_PUBLIC_BACKEND: "local", LOCAL_V2_PRESET: "v1-gate-gps",
      LOCAL_V2_COURSE_ID: `jnu-demo-dev-gps-${randomUUID().slice(0, 16)}`,
      ANSWER_SALT: randomBytes(32).toString("hex") },
  },
});
