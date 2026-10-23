import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
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
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByText("Tracking time", { exact: true }).waitFor();
    assert.equal(await page.locator(".kanban-board").isVisible(), false);
    await page.locator(".focus-transition > summary").click();
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
        name: "Start break",
        exact: true,
      })
      .click();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("Paused · timer stopped", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page
      .getByRole("heading", { name: "Choose a task", exact: true })
      .waitFor();
    const stopped = await (
      await context.request.get("/api/workspace/focus")
    ).json();
    assert.equal(stopped.active, null);
    assert.ok(
      stopped.history.some(
        (s) => s.task_id === taskId && s.state === "stopped",
      ),
    );
    const bootstrap = await (
      await context.request.get("/api/workspace/bootstrap")
    ).json();
    assert.notEqual(
      bootstrap.tasks.find((t) => t.id === taskId).stage,
      "Done",
      "Stop preserves unfinished work",
    );
    await page.getByLabel("Focus task", { exact: true }).selectOption(taskId);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByText("Tracking time", { exact: true }).waitFor();
    mkdirSync(".data/focus-redesign", { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({ path: `.data/focus-redesign/web-${width}.png` });
    }
    const cancelledHold = page.getByRole("button", {
      name: "Mark task complete",
      exact: true,
    });
    const box = await cancelledHold.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(350);
    await page.mouse.move(box.x + 40, box.y + 10);
    await page.mouse.up();
    assert.equal(
      await page.getByRole("group", { name: "Confirm completion" }).count(),
      0,
      "Moving cancels a hold",
    );
    await cancelledHold.focus();
    await cancelledHold.press("Enter");

    assert.notEqual(
      (await (await context.request.get("/api/workspace/focus")).json()).active,
      null,
      "Tap only asks for confirmation",
    );
    await page
      .getByRole("button", { name: "Cancel completion", exact: true })
      .click();
    const complete = page.getByRole("button", {
      name: "Mark task complete",
      exact: true,
    });
    await complete.hover();
    await page.mouse.down();
    await page.waitForTimeout(1150);
    await page.mouse.up();
    await page
      .getByRole("heading", {
        name: "Choose a task",
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
