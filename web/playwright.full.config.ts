import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
const port = process.env.PLAYWRIGHT_PORT ?? "3018";
const baseURL = `http://127.0.0.1:${port}`;
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["full-course.spec.ts", "solo-route.spec.ts"], workers: 1,
  timeout: 240000, expect: { timeout: 20000 }, reporter: "list", preserveOutput: "never",
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL, actionTimeout: 15000, navigationTimeout: 30000, trace: "off", screenshot: "off", video: "off" },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port ${port}`,
    url: baseURL, reuseExistingServer: false, timeout: 120000,
    env: { NEXT_PUBLIC_BACKEND: "local", LOCAL_V2_PRESET: "full-course",
      LOCAL_GAME_DATA_DIR: mkdtempSync(join(tmpdir(), "mino-tribute-e2e-")),
      LOCAL_V2_COURSE_ID: `jnu-demo-dev-full-${randomUUID().slice(0, 12)}`, ANSWER_SALT: randomBytes(32).toString("hex") },
  },
});
