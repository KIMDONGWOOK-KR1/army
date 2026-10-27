import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Set PLAYWRIGHT_CHROMIUM_CHANNEL=chrome to use an installed Chrome for 3D verification.
export default defineConfig(base, {
  testMatch: ["**/ui.spec.ts", "**/ui-type-polish.spec.ts", "**/coop-expedition.spec.ts", "**/final-polish.spec.ts", "**/full-course.spec.ts", "**/yongbong-v1.spec.ts"],
  timeout:180000,
  expect:{timeout:20000},
  use:{...base.use, actionTimeout:30000},
  projects:[
    {name:"chromium",use:{browserName:"chromium",channel:process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined}},
    {name:"webkit",use:{browserName:"webkit"}},
  ],
});
