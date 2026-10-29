import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { roleStepsComplete } from "../lib/hint-availability";
import { StorySupport } from "../components/story-support";
import { VerifyMission } from "../components/verify-mission";
import type { V2Response } from "../lib/game-snapshot";

const fixture = () => JSON.parse(readFileSync(new URL(
  "../../docs/be/fixtures/get-stage.gate.commander.before-hint.json", import.meta.url,
), "utf8")) as V2Response;

describe("hint availability uses public role counts", () => {
  it("disables a completed teammate's hint before their report and keeps unfinished roles available", () => {
    const snapshot = fixture();
    snapshot.game.step_total_count = { commander: 2, scout: 2, signal: 1, cipher: 2 };
    snapshot.game.step_done_count = { commander: 0, scout: 2, signal: 0, cipher: 1 };
    snapshot.game.report_mask = [false, false, false, false];
    snapshot.game.hint_level = { commander: 0, scout: 0, signal: 0, cipher: 0 };
    expect(roleStepsComplete(snapshot, "scout")).toBe(true);
    expect(roleStepsComplete(snapshot, "cipher")).toBe(false);
    const screens = [
      createElement(StorySupport, { snapshot, busy: false, send: async () => null }),
      createElement(VerifyMission, { snapshot, busy: false, now: 0, send: async () => null }),
    ];
    for (const screen of screens) {
      const html = renderToStaticMarkup(screen);
      const scout = html.match(/<button[^>]*>정찰원 1단계 힌트<\/button>/)?.[0];
      const cipher = html.match(/<button[^>]*>암호해독관 1단계 힌트<\/button>/)?.[0];
      expect(scout).toBeDefined();
      expect(cipher).toBeDefined();
      expect(scout).toContain('disabled=""');
      expect(cipher).not.toContain('disabled=""');
    }
  });

  it("supports older responses without guessing other roles' private mission sizes", () => {
    const snapshot = fixture();
    delete snapshot.game.step_total_count;
    snapshot.game.step_done_count.commander = snapshot.self.mission!.steps.length;
    snapshot.game.step_done_count.scout = 20;
    expect(roleStepsComplete(snapshot, "commander")).toBe(true);
    expect(roleStepsComplete(snapshot, "scout")).toBe(false);
  });

  it("matches the server's completed empty-role behavior", () => {
    const snapshot = fixture();
    snapshot.game.step_total_count = { commander: 2, scout: 0, signal: 1, cipher: 2 };
    snapshot.game.step_done_count.scout = 0;
    expect(roleStepsComplete(snapshot, "scout")).toBe(true);
  });
});
