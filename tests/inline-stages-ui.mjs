import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("owner edits task stages directly on board; deletion migrates cards and retains completion behavior", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  let taskId = "";
  let original;
  try {
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    original = (
      await (await context.request.get("/api/workspace/pipelines")).json()
    ).tasks;
    const page = await context.newPage();
    await page.goto("/workspace/tasks");
    await page.getByRole("button", { name: "To do", exact: true }).click();
    await page.getByLabel("Stage name", { exact: true }).fill("Next actions");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("button", { name: "Next actions", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Add stage", exact: true }).click();
    const name = "Stage QA " + randomUUID();
    await page.getByLabel("Stage name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).waitFor();
    let config = (
      await (await context.request.get("/api/workspace/pipelines")).json()
    ).tasks;
    const key = config.stages.find((s) => s.title === name).key;
    const r = await context.request.post("/api/workspace/tasks", {
      data: { title: "Inline stage task", dueDate: "", assignee: "", important: false, urgent: false },
    });
    assert.equal(r.status(), 200);
    taskId = (await r.json()).id;
    assert.equal(
      (
        await context.request.patch("/api/workspace/tasks/" + taskId, {
          data: { stage: key, revision: 1 },
        })
      ).status(),
      200,
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Options for " + name, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete stage", exact: true })
      .click();
    await page.getByLabel("Move cards to").selectOption("Done");
    await page
      .getByRole("button", { name: "Move cards & delete", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Options for " + name, exact: true })
      .waitFor({ state: "detached" });
    const d = database();
    const task = await d
      .prepare("SELECT stage,completed_at FROM tasks WHERE id=?")
      .get(taskId);
    assert.equal(task.stage, "Done");
    assert.ok(task.completed_at);
    await d.close();
    config = (
      await (await context.request.get("/api/workspace/pipelines")).json()
    ).tasks;
    assert.equal(
      (
        await context.request.post("/api/workspace/pipelines", {
          data: {
            kind: "tasks",
            revision: config.revision,
            stages: config.stages.filter((s) => s.key !== "Done"),
            replacements: { Done: "To do" },
          },
        })
      ).status(),
      400,
    );
    await page.goto("/workspace/applications");
    assert.ok(
      await page
        .getByRole("button", { name: "Add stage", exact: true })
        .isVisible(),
    );
    await page.goto("/workspace/students");
    assert.ok(
      await page
        .getByRole("button", { name: "Add stage", exact: true })
        .isVisible(),
    );
    await page.goto("/workspace/leads");
    assert.ok(
      await page
        .getByRole("button", { name: "Add stage", exact: true })
        .isVisible(),
    );
  } finally {
    if (original) {
      const config = (
        await (await context.request.get("/api/workspace/pipelines")).json()
      ).tasks;
      await context.request.post("/api/workspace/pipelines", {
        data: {
          kind: "tasks",
          revision: config.revision,
          stages: original.stages,
        },
      });
    }
    await context.close();
    await browser.close();
    if (taskId) {
      const d = database();
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(taskId);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(taskId);
      await d.close();
    }
  }
});
