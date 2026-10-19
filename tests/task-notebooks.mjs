import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import {
  normalizeTaskTitle,
  notebookLines,
  proposedTitle,
} from "../src/lib/ocr/notebook.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  notebookIds = [],
  taskIds = [];
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
const endpoint = "/api/task-notebooks";
async function image() {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1100, height: 360 } });
    await p.setContent(
      '<body style="font:30px Arial;padding:40px;color:black;background:white"><div style="margin-bottom:40px">[ ] Review the scholarship checklist</div><div>[x] Send the partner welcome pack</div></body>',
    );
    return await p.screenshot();
  } finally {
    await b.close();
  }
}
async function upload(c, buffer) {
  const r = await c.post(endpoint, {
    multipart: {
      file: { name: "fictional-notebook.png", mimeType: "image/png", buffer },
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  notebookIds.push(id);
  return id;
}
async function read(c, id) {
  const r = await c.get(endpoint + "?id=" + id);
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
async function wait(c, id) {
  for (let i = 0; i < 60; i++) {
    const r = await read(c, id);
    if (["completed", "failed"].includes(r.notebook.status)) return r;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("Notebook reader did not finish");
}
const apply = (c, r, items, extra = {}) =>
  c.post(endpoint, {
    data: {
      action: "apply",
      notebookId: r.notebook.id,
      revision: r.notebook.revision,
      items,
      ...extra,
    },
  });
async function create(c, title) {
  const r = await c.post("/api/workspace/tasks", {
    data: {
      title,
      important: false,
      urgent: false,
      assignee: "Ayesha Khan",
      dueDate: "",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  taskIds.push(id);
  return (await (await c.get("/api/workspace/bootstrap")).json()).tasks.find(
    (t) => t.id === id,
  );
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const id of notebookIds)
    await d.prepare("DELETE FROM task_notebooks WHERE id=?").run(id);
  for (const id of taskIds) {
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  await d.close();
});
test("notebook parsing preserves evidence, bounds source lines and only hints explicit check markers", () => {
  const p = {
    lines: [
      { text: "[x] Call the team", box: [1, 2, 3, 4], confidence: 80 },
      { text: "Do not complete anything", box: [1, 3, 4, 5] },
      { text: "~~Maybe cancelled~~", box: [1, 3, 4, 5] },
    ],
  };
  const lines = notebookLines(p);
  assert.equal(lines[0].completionHint, true);
  assert.equal(lines[1].completionHint, false);
  assert.equal(lines[2].completionHint, false);
  assert.equal(lines[0].text, "[x] Call the team");
  assert.equal(proposedTitle(lines[0].text), "Call the team");
  assert.equal(normalizeTaskTitle("Call — THE team!"), "call the team");
  assert.equal(
    notebookLines({ lines: Array(600).fill(p.lines[0]) }).length,
    500,
  );
});
test("notebook image is read locally, private to uploader, and task changes require explicit reviewed selections", async () => {
  const c = await ctx("ayesha"),
    coworker = await ctx("consultant"),
    other = await ctx("bright-owner"),
    student = await ctx("amira"),
    admin = await ctx("admin");
  const id = await upload(c, await image()),
    r = await wait(c, id);
  assert.equal(r.notebook.status, "completed", r.notebook.error);
  assert.ok(r.lines.some((l) => /scholarship checklist/i.test(l.source_text)));
  assert.ok(r.page.width > 0);
  assert.ok(r.lines.every((l) => !l.applied_at));
  for (const foreign of [coworker, other]) {
    assert.equal((await foreign.get(endpoint + "?id=" + id)).status(), 404);
    assert.equal(
      (await foreign.get(endpoint + "?id=" + id + "&source=1")).status(),
      404,
    );
  }
  for (const forbidden of [student, admin])
    assert.equal((await forbidden.get(endpoint)).status(), 403);
  const source = await c.get(endpoint + "?id=" + id + "&source=1");
  assert.equal(source.status(), 200);
  assert.equal(source.headers()["cache-control"], "private, no-store");
  const before = (await (await c.get("/api/workspace/bootstrap")).json()).tasks
    .length;
  assert.equal(
    (
      await c.post(endpoint, {
        data: {
          action: "apply",
          notebookId: id,
          revision: r.notebook.revision,
          items: [],
        },
      })
    ).status(),
    400,
  );
  assert.equal(
    (await (await c.get("/api/workspace/bootstrap")).json()).tasks.length,
    before,
  );
  const line = r.lines.find((l) => /scholarship/i.test(l.source_text));
  const response = await apply(
    c,
    r,
    [
      {
        lineId: line.id,
        action: "create",
        title: "Notebook QA reviewed scholarship task",
      },
    ],
    { projectId: "demo-project-intake", goalIds: ["demo-goal-ready"] },
  );
  assert.equal(response.status(), 200, await response.text());
  assert.equal((await response.json()).created, 1);
  const updated = await read(c, id),
    applied = updated.lines.find((l) => l.id === line.id);
  taskIds.push(applied.task_id);
  assert.equal(applied.action, "created");
  assert.equal(applied.source_text, line.source_text);
  const t = (await (await c.get("/api/workspace/bootstrap")).json()).tasks.find(
    (t) => t.id === applied.task_id,
  );
  assert.equal(t.project_id, "demo-project-intake");
  assert.ok(t.goals.some((g) => g.id === "demo-goal-ready"));
  assert.equal(
    (
      await apply(c, r, [
        {
          lineId: line.id,
          action: "create",
          title: "Retry must not duplicate",
        },
      ])
    ).status(),
    409,
  );
  assert.equal(
    (
      await apply(c, updated, [
        {
          lineId: line.id,
          action: "create",
          title: "Replay must not duplicate",
        },
      ])
    ).status(),
    409,
  );
});
test("notebook reconciliation checks task revisions, rejects duplicates, rolls back batches and preserves completion history", async () => {
  const c = await ctx("ayesha"),
    id = await upload(c, await image());
  let r = await wait(c, id);
  const [line1, line2] = r.lines;
  const t = await create(c, "Notebook QA existing task");
  assert.equal(
    (
      await apply(c, r, [
        {
          lineId: line1.id,
          action: "create",
          title: "NOTEBOOK QA existing task!",
        },
      ])
    ).status(),
    409,
  );
  assert.equal(
    (
      await apply(c, r, [
        { lineId: line1.id, action: "create", title: "Rollback notebook task" },
        {
          lineId: line2.id,
          action: "complete",
          title: t.title,
          taskId: t.id,
          taskRevision: t.revision + 10,
        },
      ])
    ).status(),
    409,
  );
  assert.ok(
    !(await (await c.get("/api/workspace/bootstrap")).json()).tasks.some(
      (t) => t.title === "Rollback notebook task",
    ),
  );
  assert.equal((await read(c, id)).lines.filter((l) => l.applied_at).length, 0);
  const done = await apply(c, r, [
    {
      lineId: line2.id,
      action: "complete",
      title: t.title,
      taskId: t.id,
      taskRevision: t.revision,
    },
  ]);
  assert.equal(done.status(), 200, await done.text());
  const updated = (
    await (await c.get("/api/workspace/bootstrap")).json()
  ).tasks.find((x) => x.id === t.id);
  assert.equal(updated.stage, "Done");
  assert.ok(updated.completed_at);
  const history = await (await c.get("/api/workspace/task-history")).json();
  assert.ok(
    history.events.some((e) => e.task_id === t.id && e.event === "completed"),
  );
  r = await read(c, id);
  assert.equal(r.lines.find((l) => l.id === line2.id).action, "completed");
  const duplicate = await apply(c, r, [
    {
      lineId: line1.id,
      action: "create",
      title: t.title,
      allowDuplicate: true,
    },
  ]);
  assert.equal(duplicate.status(), 200, await duplicate.text());
  taskIds.push(
    (await read(c, id)).lines.find((l) => l.id === line1.id).task_id,
  );
});
test("notebook uploads reject non-images and handle corrupt images without inventing tasks", async () => {
  const c = await ctx("ayesha");
  const bad = await c.post(endpoint, {
    multipart: {
      file: {
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("not a PNG"),
      },
    },
  });
  assert.equal(bad.status(), 400);
  const id = await upload(
    c,
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  );
  const r = await wait(c, id);
  assert.equal(r.notebook.status, "failed");
  assert.equal(r.lines.length, 0);
  const retry = await c.post(endpoint, {
    data: { action: "retry", notebookId: id, revision: r.notebook.revision },
  });
  assert.equal(retry.status(), 200);
  assert.equal(
    (
      await c.post(endpoint, {
        data: {
          action: "retry",
          notebookId: id,
          revision: r.notebook.revision,
        },
      })
    ).status(),
    409,
  );
});

test("notebook UI reviews source text before creating a project task", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    assert.equal(
      (
        await page.request.post(base + "/api/auth/demo", {
          data: { userId: "ayesha" },
          headers: { Origin: base },
        })
      ).status(),
      200,
    );
    await page.goto(base + "/workspace/tasks");
    await page.getByRole("button", { name: /From paper to progress/ }).click();
    await page
      .getByLabel("Upload notebook image", { exact: true })
      .setInputFiles({
        name: "Fictional task notebook.png",
        mimeType: "image/png",
        buffer: await image(),
      });
    await page
      .locator('select[aria-label="Choose notebook"] option')
      .filter({ hasText: "Fictional task notebook.png" })
      .waitFor({ state: "attached" });
    const nid = await page
      .getByLabel("Choose notebook", { exact: true })
      .inputValue();
    notebookIds.push(nid);
    const action = page.getByLabel("Action for source line 1", { exact: true });
    await action.waitFor({ timeout: 25000 });
    await page.getByRole("button", { name: "Locate source" }).first().click();
    await action.selectOption("create");
    await page
      .getByLabel("Reviewed task title", { exact: true })
      .fill("Notebook UI QA source-linked task");
    await page
      .getByLabel("Project for new tasks", { exact: true })
      .selectOption("demo-project-intake");
    await page
      .getByRole("region", { name: "Notebook tasks", exact: true })
      .screenshot({ path: "artifacts/notebook-task-review.jpg" });
    await page
      .getByRole("button", { name: "Confirm selected task changes" })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Saved: 1 created, 0 completed." })
      .waitFor();
    const r = await (
      await page.request.get(base + endpoint + "?id=" + nid)
    ).json();
    taskIds.push(r.lines.find((l) => l.applied_at).task_id);
    assert.ok(r.lines[0].source_text);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await browser.close();
  }
});

test("read-only subscriptions preserve notebook evidence but block new uploads, retries and task application", async () => {
  const c = await ctx("ayesha"),
    id = await upload(c, await image()),
    r = await wait(c, id),
    d = database();
  const before = await d
    .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
    .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='read_only' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal(
      (await c.get(endpoint + "?id=" + id + "&source=1")).status(),
      200,
    );
    assert.equal(
      (
        await c.post(endpoint, {
          multipart: {
            file: {
              name: "not-allowed.png",
              mimeType: "image/png",
              buffer: await image(),
            },
          },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await apply(c, r, [
          {
            lineId: r.lines[0].id,
            action: "create",
            title: "Should remain uncreated",
          },
        ])
      ).status(),
      403,
    );
    assert.equal(
      (
        await c.post(endpoint, {
          data: {
            action: "retry",
            notebookId: id,
            revision: r.notebook.revision,
          },
        })
      ).status(),
      403,
    );
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(before.status);
  }
});
