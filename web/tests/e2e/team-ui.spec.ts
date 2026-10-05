import { test, expect } from "@playwright/test";
test("four browser windows complete the team flow and both sites", async ({
  browser,
}) => {
  const contexts = await Promise.all(
      Array.from({ length: 4 }, () =>
        browser.newContext({ viewport: { width: 390, height: 844 } }),
      ),
    ),
    pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("호출명", { exact: true }).fill("동욱");
    await pages[0]
      .getByRole("button", { name: "새 작전 만들기", exact: true })
      .click();
    await expect(pages[0].locator(".join-code")).toBeVisible();
    const code = (await pages[0].locator(".join-code").textContent())!;
    for (const [i, p] of pages.slice(1).entries()) {
      await p.goto(`/j/${code}`);
      await p
        .getByLabel("호출명", { exact: true })
        .fill(["환희", "민호", "종연"][i]);
      await p
        .getByRole("button", { name: "작전에 합류하기", exact: true })
        .click();
    }
    await expect(
      pages[0].getByRole("button", { name: "보직 공개 시작" }),
    ).toBeEnabled();
    await pages[0].getByRole("button", { name: "보직 공개 시작" }).click();
    await Promise.all(
      pages.map((p) =>
        expect(p.locator(".dog-tag")).toBeVisible({ timeout: 8000 }),
      ),
    );
    const roles = await Promise.all(
      pages.map((p) => p.locator(".dog-tag .role-badge").innerText()),
    );
    expect(new Set(roles).size).toBe(4);
    await Promise.all(
      pages.map((p) =>
        p.getByRole("button", { name: "위치 없이 준비 완료" }).click(),
      ),
    );
    const commander = pages[roles.indexOf("지휘관")];
    await expect(
      commander.getByRole("button", { name: "작전 출발", exact: true }),
    ).toBeEnabled();
    await commander
      .getByRole("button", { name: "작전 출발", exact: true })
      .click();
    for (const site of ["gate", "yongbong"]) {
      const arrival = commander.getByRole("button", {
        name: "수동 도착 확인",
        exact: true,
      });
      await expect(arrival).toBeEnabled({ timeout: 35000 });
      await arrival.click();
      for (const [i, p] of pages.entries()) {
        await expect(p.locator(".mission-form")).toBeVisible();
        const role = roles[i];
        if (role === "지휘관")
          await p
            .getByRole("button", {
              name:
                site === "gate"
                  ? /서로의 관찰과 기록을 나눈다/
                  : /시대별 기록과 그곳의 사람들/,
            })
            .click();
        if (role === "정찰원")
          await p
            .getByPlaceholder("현장에서 찾은 답을 입력하라")
            .fill(site === "gate" ? "1" : "용봉관");
        if (role === "통신원")
          await p
            .getByRole("spinbutton", { name: "주파수 직접 입력" })
            .fill(site === "gate" ? "51.8" : "19.9");
        if (role === "암호해독관")
          await p
            .getByRole("button", { name: site === "gate" ? /일요일$/ : /鳳$/ })
            .click();
        await p.getByRole("button", { name: "단서 확인하고 보고" }).click();
        await expect(p.locator(".private-digit")).toBeVisible();
      }
      await expect(commander.locator(".report-progress")).toContainText(
        "4 / 4",
      );
      for (const [i, role] of [
        "지휘관",
        "정찰원",
        "통신원",
        "암호해독관",
      ].entries())
        await commander
          .getByRole("textbox", { name: `${role} 잠금 숫자` })
          .fill(
            (site === "gate" ? ["2", "1", "3", "7"] : ["3", "4", "6", "8"])[i],
          );
      await commander
        .getByRole("button", { name: "자물쇠 확인", exact: true })
        .click();
      if (site === "gate") {
        await expect(
          commander.getByRole("button", { name: "다음 거점으로 출발" }),
        ).toBeVisible();
        await commander
          .getByRole("button", { name: "다음 거점으로 출발" })
          .click();
      }
    }
    await Promise.all(
      pages.map((p) => expect(p.locator(".completion")).toBeVisible()),
    );
    for (const p of pages)
      await expect(p.locator(".collected-seals>span")).toHaveCount(2);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
