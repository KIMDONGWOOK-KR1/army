import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ROLES, type Role } from "../../supabase/functions/_shared/types";

// 시연 방 코스(LOCAL_V2_PRESET=full-course-v1)의 용봉관: hh v1 시연 문항을 네 사람이 화면에서 직접 푼다.
// 정답 값은 화면·응답·서버 기록 어디에도 나오지 않는다(통신원 주파수는 지휘관 전달 단서로만).
test("four sessions solve the v1 Yongbong questions on screen without leaking answers", async ({ browser }) => {
  const contexts = await Promise.all(ROLES.map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
  try {
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const bodies = new Map<Page, string[]>();
    let gameId = "", stageId = "gate";
    const call = async (page: Page, action: string, extra: Record<string, unknown> = {}) => {
      const r = await page.request.post("/api/game", { data: { action, game_id: gameId || undefined, stage_id: stageId,
        request_id: crypto.randomUUID(), ...extra } });
      expect(r.status(), action).toBe(200);
      const text = await r.text(); bodies.get(page)?.push(text);
      return JSON.parse(text);
    };
    const created = await call(pages[0], "create-game", { nickname: "시험1" }); gameId = created.game.id;
    for (let i = 1; i < 4; i++) await call(pages[i], "join-game", { code: created.game.code, nickname: `시험${i + 1}` });
    await call(pages[0], "start-game");
    await expect.poll(async () => (await call(pages[0], "get-game")).game.status).toBe("equip");
    const ready = await Promise.all(pages.map((p) => call(p, "set-ready")));
    const forRole = (role: Role) => pages[ready.findIndex((s: { self: { role: Role } }) => s.self.role === role)];
    const commander = forRole("commander"); await call(commander, "begin-operation");
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    for (const role of ["scout", "signal", "cipher", "commander"] as const) {
      for (const level of [1, 2, 3]) await call(commander, "request-hint", { target_role: role, level });
      await call(forRole(role), "submit-report"); await call(forRole(role), "confirm-explanation");
    }
    await call(commander, "open-after-explanation"); await call(commander, "depart-next-site"); stageId = "yongbong";
    for (const p of pages) await call(p, "report-arrival", { method: "simulated" });
    const probe = await call(forRole("scout"), "get-stage");
    test.skip(probe.self.mission?.steps?.[0]?.id !== "Y-02.legacy", "서버가 full-course-v1 코스가 아님");
    for (const p of pages) {
      bodies.set(p, []);
      p.on("response", async (res) => { if (res.url().includes("/api/game")) bodies.get(p)!.push(await res.text().catch(() => "")); });
    }
    const solve: Record<Role, (p: Page) => Promise<void>> = {
      commander: (p) => p.getByRole("button", { name: /대학의 역사와 오월의 기록/ }).click(),
      scout: (p) => p.getByPlaceholder("현장에서 찾은 답을 입력하라").fill("용봉관"),
      signal: (p) => p.locator("[data-frequency-input]").first().fill("19.9"),
      cipher: (p) => p.getByRole("button", { name: /鳳/ }).click(),
    };
    for (const role of ROLES) {
      const p = forRole(role); await p.goto("/");
      await expect(p.locator('[data-scene="mission"]')).toBeVisible();
      // 현장 조사·외부 대체 안내와 '연습 문항' 꼬리표가 없다
      await expect(p.getByTestId("visit-mode")).toHaveCount(0);
      await expect(p.locator(".practice-tag")).toHaveCount(0);
      if (role !== "commander") await expect(p.locator("body")).not.toContainText("19.9");
      await solve[role](p);
      await p.getByRole("button", { name: "문제 제출" }).click();
      await expect(p.getByText("조사를 기록했다.")).toBeVisible();
    }
    for (const role of ["scout", "signal", "cipher", "commander"] as const) await call(forRole(role), "submit-report");
    const order: Role[] = ["commander", "scout", "signal", "cipher"];
    const digits = await Promise.all(order.map(async (r) => (await call(forRole(r), "get-stage")).self.digit));
    await call(commander, "open-lock", { digits });
    for (const p of pages) {
      await expect(p.getByTestId("stage-v2-completed")).toContainText("겹친 시간의 사초");
      await expect(p.getByTestId("stage-v2-completed")).toContainText("흩어진 자료를 네 사람이 맞춰");
    }
    // 응답: 정답 해시·정답 필드 없음, 주파수는 지휘관 응답에만
    for (const [p, list] of bodies) {
      const all = list.join("\n");
      expect(all).not.toMatch(/answerHash|"answer":/);
      if (p !== commander) expect(all).not.toContain("19.9");
    }
    // 서버 기록(로컬 상태 파일의 이 게임 이벤트)에도 정답 값이 없다
    const state = JSON.parse(readFileSync(".demo-data/state.json", "utf8"));
    const events = JSON.stringify(state.events?.[gameId] ?? []);
    expect(events).toContain("open-lock");
    for (const value of ["19.9", "\"용봉관\"", "\"answer\"", "鳳"]) expect(events).not.toContain(value);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
