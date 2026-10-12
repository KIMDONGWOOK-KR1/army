import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const baseURL = "http://127.0.0.1:3014";
// Recheck the original v2 main/verify clients against the simplified input contract.
export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["integrated-v2.spec.ts", "verify-v2.spec.ts"],
  workers: 1, timeout: 180000, expect: { timeout: 10000 }, preserveOutput: "never",
  outputDir: "test-results/compat",
  use: { baseURL, channel: "chrome", viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
    actionTimeout: 10000, trace: "off", screenshot: "off", video: "off" },
  webServer: { command: "npm run start -- --port 3014", url: baseURL, reuseExistingServer: false,
    env: { NEXT_PUBLIC_BACKEND: "local", LOCAL_V2_PRESET: "synthetic", LOCAL_V2_COURSE_ID: `jnu-demo-dev-current-${Date.now()}`,
      ANSWER_SALT: randomBytes(32).toString("hex"), LOCAL_GAME_DATA_DIR: mkdtempSync(join(tmpdir(), "hoguk-current-compat-")) } },
});
