import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("100 tasks remain in bounded quadrants and open full editable details", async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  const ids = [];
  const title = "Compact QA " + randomUUID();
  try {
    assert.equal(
      (
        await context.request.post("/api/auth/demo", {
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    for (let i = 0; i < 1; i++) {
      const r = await context.request.post("/api/workspace/tasks", {
        data: {
          title: title + " " + i,
          important: true,
          urgent: true,
          dueDate: "",
          assignee: "",
        },
      });
      assert.equal(r.status(), 200);
      ids.push((await r.json()).id);
    }
    const seedDb = database();
    for (let i = 1; i < 100; i++) {
      const id = randomUUID();
      await seedDb
        .prepare(
          "INSERT INTO tasks(id,tenant_id,title,important,urgent,assignee) SELECT ?,tenant_id,?,important,urgent,assignee FROM tasks WHERE id=?",
        )
        .run(id, title + " " + i, ids[0]);
      ids.push(id);
    }
    await seedDb.close();
    const page = await context.newPage();
    await page.goto("/workspace/tasks");
    await page
      .getByRole("button", { name: "Priority matrix", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open task: " + title + " 0", exact: true })
      .waitFor();
    const metrics = await page
      .locator(".quadrant-task-list")
      .first()
      .evaluate((e) => ({ height: e.clientHeight, scroll: e.scrollHeight }));
    assert.ok(metrics.height <= 402);
    assert.ok(metrics.scroll > metrics.height);
    await page
      .getByRole("button", { name: "Open task: " + title + " 0", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /Change importance/ })
        .isVisible(),
      true,
    );
    assert.equal(
      await page
        .getByRole("dialog")
        .getByLabel("Stage for " + title + " 0")
        .isVisible(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
  } finally {
    await context.close();
    await browser.close();
    const d = database();
    for (const id of ids) {
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
    }
    await d.close();
  }
});
