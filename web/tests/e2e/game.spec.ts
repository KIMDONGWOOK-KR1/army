import { test, expect, type APIRequestContext } from "@playwright/test";
const call = async (
  api: APIRequestContext,
  action: string,
  data: Record<string, unknown> = {},
) => {
  const res = await api.post("/api/game", {
    data: { action, request_id: crypto.randomUUID(), ...data },
  });
  return { status: res.status(), body: await res.json() };
};
test("four independent sessions complete both sites with isolated clues and persistent lock state", async ({
  playwright,
}) => {
  const clients = await Promise.all(
    Array.from({ length: 5 }, () =>
      playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      }),
    ),
  );
  try {
    const created = await call(clients[0], "create-game", { nickname: "동욱" });
    expect(created.status).toBe(200);
    const id = created.body.game.id,
      code = created.body.game.code;
    const joins = await Promise.all(
      clients.slice(1).map((c, i) =>
        call(c, "join-game", {
          code,
          nickname: ["환희", "민호", "종연", "초과"][i],
        }),
      ),
    );
    expect(joins.filter((x) => x.status === 200)).toHaveLength(3);
    expect(joins.find((x) => x.status !== 200)?.body.code).toBe("ROOM_FULL");
    const active = [
      clients[0],
      ...clients.slice(1).filter((_, i) => joins[i].status === 200),
    ];
    await call(active[0], "start-game", { game_id: id });
    await new Promise((r) => setTimeout(r, 3100));
    await Promise.all(active.map((c) => call(c, "set-ready", { game_id: id })));
    const views = await Promise.all(
      active.map((c) => call(c, "get-game", { game_id: id })),
    );
    const commander = views.findIndex((x) => x.body.self.role === "commander");
    expect(new Set(views.map((x) => x.body.self.role)).size).toBe(4);
    expect(views.every((x) => x.body.self.clue === null)).toBe(true);
    await call(active[commander], "begin-operation", { game_id: id });
    for (const site of ["gate", "yongbong"]) {
      const early = await call(active[commander], "report-arrival", {
        game_id: id,
        site_id: site,
        manual: true,
      });
      expect(early.body.code).toBe("COOLDOWN");
      await new Promise((r) => setTimeout(r, 30100));
      await call(active[commander], "report-arrival", {
        game_id: id,
        site_id: site,
        manual: true,
      });
      const answers: Record<string, string> =
        site === "gate"
          ? { commander: "2", scout: "1", signal: "51.8", cipher: "일요일" }
          : { commander: "3", scout: "용봉관", signal: "19.9", cipher: "8" };
      for (let i = 0; i < active.length; i++) {
        const view = (await call(active[i], "get-game", { game_id: id })).body;
        expect(view.self.clue).toBeTruthy();
        expect(JSON.stringify(view.game)).not.toContain("digit");
        const role = view.self.role;
        await call(active[i], "submit-report", {
          game_id: id,
          site_id: site,
          role,
          answer: answers[role],
        });
      }
      const digits = site === "gate" ? [2, 1, 3, 7] : [3, 4, 6, 8];
      if (site === "gate") {
        const request_id = crypto.randomUUID();
        const payload = {
          game_id: id,
          site_id: site,
          digits: [2, 0, 0, 0],
          request_id,
        };
        const duplicate = await Promise.all([
          call(active[commander], "open-lock", payload),
          call(active[commander], "open-lock", payload),
        ]);
        expect(duplicate.every((x) => x.body.game.score === 90)).toBe(true);
        const recovered = (
          await call(active[commander], "get-game", { game_id: id })
        ).body;
        expect(recovered.self.lock.digits).toEqual([2, null, null, null]);
        expect(recovered.game.attempts_left).toBe(2);
      }
      const opened = await call(active[commander], "open-lock", {
        game_id: id,
        site_id: site,
        digits,
      });
      expect(opened.body.result.ok).toBe(true);
      if (site === "gate")
        await call(active[commander], "depart-next-site", {
          game_id: id,
          site_id: site,
        });
    }
    const end = (await call(active[commander], "get-game", { game_id: id }))
      .body;
    expect(end.game.status).toBe("done");
    expect(end.game.acquired_sites).toHaveLength(2);
    expect(end.game.score).toBe(90);
    const late = await call(active[commander], "depart-next-site", {
      game_id: id,
      site_id: "yongbong",
    });
    expect(late.body.code).toBe("WRONG_STAGE");
  } finally {
    await Promise.all(clients.map((c) => c.dispose()));
  }
});
