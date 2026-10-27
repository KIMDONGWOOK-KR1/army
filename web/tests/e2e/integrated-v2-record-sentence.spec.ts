import { expect, test } from "@playwright/test";
import { fullTeam } from "../helpers/full-v2";
import type { Command } from "../../supabase/functions/_shared/types";

// The route uses only an in-memory synthetic engine; it never seeds a database.
for (const fixed of [true, false]) {
  test(`shared record ${fixed ? "fixed sentence" : "free prose"} restores and edits at mobile widths`, async ({ page }) => {
    const team = await fullTeam(); await team.arrive(); await team.wallReady();
    const template = team.course.stages.find((stage) => stage.id === "wall")!.recordTemplate!;
    template.wordChoices = ["구름", "바람", "질문"];
    if (fixed) template.sentenceParts = ["[합성] ", "·", "·", "를 차례로 확인한다."];
    await page.addInitScript((id) => localStorage.setItem("hoguk-game", id), team.game.id);
    const submitted: Command[] = [];
    await page.route("**/api/game", async (route) => {
      const command = route.request().postDataJSON() as Command;
      if (!["get-game", "get-stage"].includes(command.action)) {
        submitted.push(command);
        await team.call("commander", command);
      }
      await route.fulfill({ status: 200, json: team.view("commander") });
    });
    await page.goto("/");
    const panel = page.getByTestId("memorial-record");
    await panel.getByRole("button", { name: "공동 기록 작성", exact: true }).click({ noWaitAfter: true });
    if (fixed) {
      await expect(panel.getByLabel("공동 문장", { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("공동 문장 미리보기")).toContainText("[낱말 1]");
    }
    for (const [index, word] of ["질문", "구름", "질문"].entries()) await panel.getByLabel(`낱말 ${index + 1}`).selectOption(word);
    const text = fixed ? "[합성] 질문·구름·질문를 차례로 확인한다." : "[합성] 내가 작성한 자유 문장";
    if (fixed) await expect(panel.getByLabel("공동 문장 미리보기")).toHaveText(text);
    else await panel.getByLabel("공동 문장", { exact: true }).fill(text);
    await panel.getByLabel("공동 근거", { exact: true }).fill("[합성] 처음 선택한 근거");
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await panel.getByRole("button", { name: "공동 기록 저장", exact: true }).click({ noWaitAfter: true });
    await expect(panel).toContainText("기록 버전 1");
    expect(submitted.at(-1)).toMatchObject({ text, words: ["질문", "구름", "질문"], draft_version: 0 });
    await team.call("scout", { action: "confirm-stage", draft_version: 1 });
    await page.reload();
    await expect(panel).toContainText("정찰원 · 확인 완료");
    await expect(panel.locator("blockquote")).toHaveText(text);
    await panel.getByRole("button", { name: "공동 기록 수정", exact: true }).click({ noWaitAfter: true });
    await expect(panel.getByLabel("낱말 1")).toHaveValue("질문");
    await expect(panel.getByLabel("공동 근거", { exact: true })).toHaveValue("[합성] 처음 선택한 근거");
    if (fixed) {
      await expect(panel.getByLabel("공동 문장", { exact: true })).toHaveCount(0);
      await expect(panel.getByLabel("공동 문장 미리보기")).toHaveText(text);
      await panel.getByLabel("낱말 2").selectOption("바람");
    } else {
      await expect(panel.getByLabel("공동 문장", { exact: true })).toHaveValue(text);
      await panel.getByLabel("공동 문장", { exact: true }).fill("[합성] 수정한 자유 문장");
    }
    await panel.getByRole("button", { name: "공동 기록 저장", exact: true }).click({ noWaitAfter: true });
    await expect(panel).toContainText("기록 버전 2");
    await expect(panel).toContainText("정찰원 · 확인 대기");
    await page.reload();
    await expect(panel.locator("blockquote")).toHaveText(fixed ? "[합성] 질문·바람·질문를 차례로 확인한다." : "[합성] 수정한 자유 문장");
  });
}
