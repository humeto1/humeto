import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.HUMETO_TEST_URL;
test("Plans contains Projects and Goals; Home shows productivity instead of duplicate task controls", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
  try {
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage();
    await page.goto(base + "/workspace/progress");
    const tabs = page.locator(".task-progress > .filter-bar .segmented button");
    assert.deepEqual((await tabs.allTextContents()).slice(0, 2), [
      "Projects",
      "Goals",
    ]);
    assert.equal(
      await page
        .getByText("How to structure your work", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Routines & operations", exact: true })
        .count(),
      0,
    );
    await page
      .locator("summary")
      .filter({ hasText: "Plans without a deadline" })
      .waitFor();
    const add = page.getByLabel("Add plan", { exact: true });
    assert.deepEqual(
      await add
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value)),
      ["", "projects", "goals"],
    );
    await add.selectOption("projects");
    await page
      .getByRole("heading", { name: "New project", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("input[name=targetDate]").getAttribute("required"),
      null,
    );
    await page
      .locator("input[name=title]")
      .fill("Ongoing dashboard QA project");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "New project", exact: true })
      .waitFor({ state: "hidden" });
    const state = await (await context.request.get("/api/mobile")).json();
    assert.equal(
      state.projects.find((p) => p.title === "Ongoing dashboard QA project")
        .target_date,
      "",
    );

    await add.selectOption("goals");
    await page
      .getByRole("heading", { name: "New goal", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "Calendar", exact: true }).count(),
      0,
    );
    await page.goto(base + "/workspace");
    await page
      .getByRole("heading", { name: "Make your time count." })
      .waitFor();
    assert.equal(await page.locator(".home-task-views").count(), 0);
    await page.goto(base + "/workspace/tasks");
    await page
      .getByText("Daily tasks & plan calendar", { exact: true })
      .click();
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.locator(".planning-calendar").waitFor();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByText("Chat · Humeto AI", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Humeto assistant", exact: true })
        .count(),
      0,
    );
  } finally {
    await context.close();
    await browser.close();
  }
});
