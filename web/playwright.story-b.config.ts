import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const baseURL = process.env.PLAYWRIGHT_STORY_B_URL ?? "http://127.0.0.1:3013";
// A test run must not write into the user's saved rehearsal rooms or a synced Desktop.
const gameDataDir = mkdtempSync(join(tmpdir(), "hoguk-story-b-e2e-"));
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["story-auto-demo.spec.ts", "story-b.spec.ts", "story-b-solo.spec.ts", "story-motion.spec.ts", "full-course.spec.ts"],
  workers: 1, timeout: 300000, expect: { timeout: 15000 }, preserveOutput: "never",
  use: { baseURL, trace: "off", screenshot: "off", actionTimeout: 15000 },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { command: `npm run start -- --port ${new URL(baseURL).port || "3013"}`, url: baseURL, reuseExistingServer: false, timeout: 120000,
    env: { NEXT_PUBLIC_BACKEND: "local", LOCAL_GAME_DATA_DIR: gameDataDir, LOCAL_V2_PRESET: "story-b", LOCAL_V2_COURSE_ID: `jnu-demo-dev-story-b-${Date.now()}`, ANSWER_SALT: randomBytes(32).toString("hex") } },
});
