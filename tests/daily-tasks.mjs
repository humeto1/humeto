import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL;
test("daily is a normal task property; Today tracks completion without resetting the next day", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      timezoneId: "Asia/Karachi",
      extraHTTPHeaders: { Origin: base },
    });
    assert.equal(
      (
        await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    const p = await c.newPage();
    await p.goto("/workspace/progress");
    assert.equal(
      await p.getByRole("button", { name: "Routines", exact: true }).count(),
      0,
    );
    assert.equal(
      await p
        .getByLabel("Add plan", { exact: true })
        .locator("option[value=routines]")
        .count(),
      0,
    );
    await p.goto("/workspace");
    const daily = p.getByRole("region", { name: "Daily task tracking" });
    await daily.waitFor();
    await daily.getByRole("button", { name: "Add task from Today" }).click();
    const dialog = p.getByRole("dialog");
    const title = "Daily checklist " + randomUUID();
    await dialog.getByLabel("Task title", { exact: true }).fill(title);
    await dialog.getByLabel("Repeat", { exact: true }).selectOption("daily");
    await dialog.getByLabel("Important", { exact: true }).check();
    await dialog
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await daily
      .getByRole("button", { name: "Mark " + title + " done", exact: true })
      .waitFor();
    let state = await (await c.request.get("/api/mobile")).json();
    const task = state.tasks.find((t) => t.title === title);
    assert.ok(task);
    assert.equal(task.important, 1);
    await daily
      .getByRole("button", { name: "Mark " + title + " done", exact: true })
      .click();
    await daily.locator(".daily-done").filter({ hasText: title }).waitFor();
    const report = await (
      await c.request.get("/api/workspace/planning?timezone=Asia%2FKarachi")
    ).json();
    const series = report.routines.find((r) => r.title === title);
    assert.ok(series);
    assert.equal(
      report.occurrences.find((o) => o.task_id === task.id).state,
      "done",
    );
    await daily.getByRole("button", { name: "Next task day" }).click();
    await daily.locator(".daily-upcoming").filter({ hasText: title }).waitFor();
    await daily.getByRole("button", { name: "Previous task day" }).click();
    await daily.locator(".daily-done").filter({ hasText: title }).waitFor();
    assert.ok(await daily.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
    await p.getByRole("button", { name: "Calendar", exact: true }).click();
    await p.getByLabel("Calendar status").selectOption("Done");
    await p.getByRole("button", { name: "Calendar " + report.today, exact: true }).click();
    await p.locator(".planning-row").filter({ hasText: title }).getByText("Task · Uncategorized · Done", { exact: true }).waitFor();
    await p.getByLabel("Calendar status").selectOption("Upcoming");
    const tomorrow = new Date(report.today + "T12:00:00Z");
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const nextDay = tomorrow.toISOString().slice(0, 10);
    await p.locator('.planning-controls input[type="month"]').fill(nextDay.slice(0, 7));
    await p.getByRole("button", { name: "Calendar " + nextDay, exact: true }).click();
    await p.locator(".planning-row").filter({ hasText: title }).waitFor();
    await p.screenshot({path: ".data/mobile-qa/home-calendar.png", fullPage: true});
    const bad = await c.request.post("/api/workspace/planning", {
      data: {
        action: "routine",
        title: "Invalid repeat",
        kind: "operations",
        frequency: "daily",
        firstDay: report.today,
        time: "00:00",
        timezone: "Asia/Karachi",
        personId: "foreign-person",
      },
    });
    assert.equal(bad.status(), 404);
  } finally {
    await browser.close();
  }
});
