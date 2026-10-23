import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("focus UI hides the board, restores a paused timer and completes the chosen task", async () => {
  const browser = await chromium.launch({ headless: true }),
    context = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
  let taskId = "";
  try {
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    const r = await context.request.post("/api/workspace/tasks", {
      data: {
        title: "UI Focus QA " + randomUUID(),
        important: true,
        urgent: false,
        dueDate: "",
        assignee: "",
      },
    });
    assert.equal(r.status(), 200);
    taskId = (await r.json()).id;
    const page = await context.newPage();
    await page.goto(base + "/workspace/tasks");
    await page.getByRole("button", { name: /Pick a random task/ }).click();
    await page
      .getByRole("button", { name: "Choose this task", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].find(
          (b) => b.textContent === "Choose this task",
        )?.disabled,
    );
    const beforePick = await (
      await context.request.get("/api/workspace/focus")
    ).json();
    assert.equal(
      beforePick.active,
      null,
      "A random suggestion never starts a timer",
    );
    await page
      .getByRole("button", { name: "Choose this task", exact: true })
      .click();
    await page.getByLabel("Focus task", { exact: true }).selectOption(taskId);
    await page
      .getByRole("button", { name: "Let’s begin", exact: true })
      .click();
    await page.getByText("Tracking time", { exact: true }).waitFor();
    assert.equal(await page.locator(".kanban-board").isVisible(), false);
    await page
      .getByRole("button", { name: "Take a 10-second reset", exact: true })
      .click();
    await page.getByRole("timer").waitFor();
    const afterReset = await (
      await context.request.get("/api/workspace/focus")
    ).json();
    assert.equal(
      afterReset.active.state,
      "running",
      "Reset does not silently pause or switch the task",
    );
    await page
      .locator(".focus-rest summary")
      .filter({ hasText: "Take a break" })
      .click();
    await page
      .getByRole("button", {
        name: "Start break · pause work timer",
        exact: true,
      })
      .click();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Mark task complete", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "What would you like to move forward first?",
      })
      .waitFor();
    assert.equal(await page.locator(".kanban-board").isVisible(), true);
    await page.goto(base + "/workspace/finance");
    await page
      .getByRole("heading", { name: "Know where you stand." })
      .waitFor();
    assert.equal(
      await page.getByText("Net profit / loss", { exact: true }).isVisible(),
      true,
    );
  } finally {
    await context.close();
    await browser.close();
    if (taskId) {
      const d = database();
      await d.prepare("DELETE FROM focus_sessions WHERE task_id=?").run(taskId);
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(taskId);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(taskId);
      await d.close();
    }
  }
});
