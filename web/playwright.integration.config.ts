import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3014";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Only the local synthetic engine is exercised; no existing dev project or
// secret is used. Private responses must not become saved browser artifacts.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "integrated-v2*.spec.ts",
  workers: 1,
  timeout: 120000,
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
    storageState: {
      cookies: [],
      origins: [{
        origin: baseURL,
        localStorage: [
          { name: "hoguk:narration", value: "off" },
          { name: "hoguk:stop", value: "off" },
          { name: "hoguk:sound", value: "off" },
        ],
      }],
    },
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3014",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_BACKEND: "local",
      LOCAL_V2_COURSE_ID: `jnu-demo-dev-ui-${randomUUID().slice(0, 20)}`,
      ANSWER_SALT: randomBytes(32).toString("hex"),
    },
  },
});
