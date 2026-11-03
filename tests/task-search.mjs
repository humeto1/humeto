import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { taskSearchScore, taskSimilarityScore } from "../shared/task-search.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
const base = process.env.HUMETO_TEST_URL;

test("task search matches reordered keywords, prefixes, spelling mistakes, accents and reviewed aliases", () => {
  const task = {
    id: "1",
    title: "Review café invoices",
    project_title: "London visa",
    goals: [{ title: "Grow consultancy" }],
  };
  for (const query of [
    "invoices review",
    "revie cafe",
    "reveiw invoices",
    "cafe",
    "londn visa",
    "consultancy",
    "invoice review",
    "please review the invoices",
  ])
    assert.ok(taskSearchScore(task, query) > 0, query);
  for (const query of ["fitness", "visa refund", "no invoice", "la"])
    assert.equal(taskSearchScore(task, query), 0, query);
  assert.equal(
    taskSearchScore({ id: "date", title: "Invoice 2026" }, "invoice 2027"),
    0,
  );
  assert.ok(
    taskSearchScore({ id: "2", title: "Buy laptop" }, "purchase laptop") > 0,
  );
  assert.ok(
    taskSearchScore({ id: "3", title: "ویزہ درخواست" }, "درخواست ویزہ") > 0,
  );
  assert.ok(
    taskSearchScore(
      { id: "4", title: "Send report", display_title: "Share weekly summary" },
      "weekly summary",
    ) > 0,
  );
  assert.ok(
    taskSearchScore({ id: "1", title: "Review invoices" }, "review invoices") >
      taskSearchScore(task, "review invoices"),
  );
  assert.ok(
    taskSimilarityScore(
      { id: "5", title: "Review visa application" },
      "review visa documents",
    ) > 0,
  );
  assert.equal(
    taskSimilarityScore(
      { id: "5", title: "Review visa application" },
      "review budget documents",
    ),
    0,
  );
});

test("search offers reviewed creation and checks filtered, completed, archived and binned tasks", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 390, height: 844 },
    });
    assert.equal(
      (
        await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } })
      ).status(),
      200,
    );
    const suffix = randomUUID().slice(0, 8);
    const titles = [
      "Archive telescope " + suffix,
      "Complete telescope " + suffix,
      "Bin telescope " + suffix,
    ];
    const made = [];
    for (const title of titles) {
      const r = await c.request.post("/api/workspace/tasks", {
        data: { title, important: true, urgent: false },
      });
      assert.equal(r.status(), 200, await r.text());
    }
    let data = await (await c.request.get("/api/mobile")).json();
    for (const title of titles)
      made.push(data.tasks.find((t) => t.title === title));
    assert.equal(
      (
        await c.request.post("/api/workspace/task-storage/" + made[0].id, {
          data: { action: "archive", revision: made[0].revision },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await c.request.patch("/api/workspace/tasks/" + made[1].id, {
          data: { stage: "Done", revision: made[1].revision },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await c.request.post("/api/workspace/task-storage/" + made[2].id, {
          data: { action: "bin", revision: made[2].revision },
        })
      ).status(),
      200,
    );
    const page = await c.newPage();
    await page.goto("/workspace/tasks");
    const search = page.locator("#global-search");
    const unknown = "Novel observatory " + suffix;
    await search.fill(unknown);
    const feedback = page.getByRole("region", {
      name: "Task search suggestions",
    });
    const add = feedback.getByRole("button", {
      name: "+ Add “" + unknown + "” as a new task",
      exact: true,
    });
    await add.waitFor();
    mkdirSync(".data/task-search", { recursive: true });
    await page.screenshot({
      path: ".data/task-search/no-match-phone.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await add.click();
    const dialog = page.getByRole("dialog");
    assert.equal(
      await dialog.getByLabel("Task title", { exact: true }).inputValue(),
      unknown,
    );
    const before = (await (await c.request.get("/api/mobile")).json()).tasks;
    assert.ok(
      !before.some((t) => t.title === unknown),
      "opening create must not create a record",
    );
    await page.keyboard.press("Escape");
    await search.fill(titles[0]);
    await feedback.getByText(titles[0], { exact: true }).waitFor();
    const duplicateAdd = feedback.getByRole("button", {
      name: /as a new task/,
    });
    assert.equal(await duplicateAdd.isDisabled(), true);
    await feedback
      .getByRole("button", { name: "Restore task", exact: true })
      .first()
      .click();
    await feedback.waitFor({ state: "hidden" });
    data = await (await c.request.get("/api/mobile")).json();
    assert.ok(data.tasks.some((t) => t.id === made[0].id));
    await search.fill(titles[2]);
    await feedback.getByText("Bin", { exact: true }).waitFor();
    assert.equal(
      (await feedback.getByRole("button", { name: "Restore task" }).count()) >=
        1,
      true,
    );
    // A pending-only filter must not make a completed task look new.
    await page.goto("/workspace/tasks");
    const focusSearch = page.getByLabel("Search focus tasks", { exact: true });
    await focusSearch.fill(titles[1]);
    const completed = page
      .getByRole("region", { name: "Task search suggestions" })
      .filter({ hasText: titles[1] });
    await completed.getByText("Completed", { exact: true }).waitFor();
    assert.equal(
      await completed
        .getByRole("button", { name: /as a new task/ })
        .isDisabled(),
      true,
    );
    await search.fill("unmatched " + suffix);
    await page.route("**/api/workspace/task-storage", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unavailable" }),
      }),
    );
    await search.fill("Unavailable archive " + suffix);
    const unavailable = page
      .getByRole("region", { name: "Task search suggestions" })
      .filter({ hasText: "Archive and Bin could not be checked" });
    await unavailable.waitFor();
    assert.equal(
      await unavailable
        .getByRole("button", { name: /as a new task/ })
        .isDisabled(),
      true,
    );
    // Do not leave a binned fixture that another retention test can legitimately purge.
    const retained = await (
      await c.request.get("/api/workspace/task-storage")
    ).json();
    for (const task of retained.items.filter((item) =>
      made.some((created) => created.id === item.id),
    )) {
      assert.equal(
        (
          await c.request.post("/api/workspace/task-storage/" + task.id, {
            data: { action: "restore", revision: task.revision },
          })
        ).status(),
        200,
      );
    }
    await c.close();
  } finally {
    await browser.close();
  }
});
