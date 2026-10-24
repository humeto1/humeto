import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL;
async function ctx(user = "ayesha") {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  await c.post("/api/auth/demo", { data: { userId: user } });
  return c;
}
async function create(c) {
  const r = await c.post("/api/workspace/tasks", {
    data: {
      title: "Storage " + randomUUID(),
      important: false,
      urgent: false,
      dueDate: "",
      assignee: "",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  return (await r.json()).id;
}
async function boot(c) {
  return (await c.get("/api/mobile")).json();
}
async function stored(c) {
  return (await c.get("/api/workspace/task-storage")).json();
}
test("archive/bin restore preserve task data, enforce scopes and stop work without completing tasks", async () => {
  const c = await ctx(),
    other = await ctx("bright-owner"),
    student = await ctx("amira");
  try {
    const id = await create(c);
    let t = (await boot(c)).tasks.find((t) => t.id === id);
    const path = "/api/workspace/task-storage/" + id;
    const send = (client, action, revision) =>
      client.post(path, { data: { action, revision } });
    assert.equal((await send(other, "bin", t.revision)).status(), 404);
    assert.equal((await send(student, "bin", t.revision)).status(), 403);
    await c.post("/api/workspace/focus", {
      data: {
        action: "start",
        taskId: id,
        taskRevision: t.revision,
        targetMinutes: 25,
      },
    });
    t = (await boot(c)).tasks.find((t) => t.id === id);
    const previousStage = t.stage;
    let r = await send(c, "archive", t.revision);
    assert.equal(r.status(), 200, await r.text());
    assert.equal(
      (await boot(c)).tasks.some((t) => t.id === id),
      false,
    );
    t = (await stored(c)).items.find((t) => t.id === id);
    assert.equal(t.storage_state, "archive");
    assert.equal(t.purge_after, null);
    assert.equal(t.stage, previousStage);
    assert.equal((await send(c, "restore", 1)).status(), 409);
    assert.equal(
      (
        await c.patch("/api/workspace/tasks/" + id, {
          data: { stage: "Done", revision: t.revision },
        })
      ).status(),
      409,
    );
    r = await send(c, "restore", t.revision);
    assert.equal(r.status(), 200, await r.text());
    t = (await boot(c)).tasks.find((t) => t.id === id);
    assert.ok(t);
    r = await send(c, "bin", t.revision);
    assert.equal(r.status(), 200, await r.text());
    t = (await stored(c)).items.find((t) => t.id === id);
    assert.ok(
      Math.abs(
        new Date(t.purge_after) - new Date(t.stored_at) - 30 * 86400000,
      ) < 2000,
    );
    assert.equal((await send(c, "restore", t.revision)).status(), 200);
  } finally {
    await c.dispose();
    await other.dispose();
    await student.dispose();
  }
});
test("30-day purge removes dependent records, never archive, and blocks late restoration", async () => {
  const c = await ctx();
  const d = database();
  try {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await create(c));
    let b = await boot(c);
    for (let i = 0; i < 3; i++) {
      const t = b.tasks.find((t) => t.id === ids[i]);
      const r = await c.post("/api/workspace/task-storage/" + t.id, {
        data: { action: i === 2 ? "archive" : "bin", revision: t.revision },
      });
      assert.equal(r.status(), 200, await r.text());
    }
    const due = await d.query("SELECT purge_after FROM tasks WHERE id=$1", [
      ids[0],
    ]);
    const now = new Date(due.rows[0].purge_after);
    let r = await d.query("SELECT humeto_purge_task_bin($1) AS n", [
      new Date(now.getTime() - 1000).toISOString(),
    ]);
    assert.equal(r.rows[0].n, 0);
    r = await d.query("SELECT humeto_purge_task_bin($1) AS n", [
      new Date(now.getTime() + 1000).toISOString(),
    ]);
    assert.equal(r.rows[0].n, 2);
    assert.equal(
      (await d.query("SELECT id FROM tasks WHERE id=$1", [ids[2]])).rows.length,
      1,
    );
    assert.equal((await c.get("/api/cron/task-bin")).status(), 401);
  } finally {
    await c.dispose();
    await d.close();
  }
});
test("web task menu replaces Move button; archive/bin tabs restore the same task", async () => {
  const browser = await chromium.launch();
  const c = await ctx();
  try {
    const id = await create(c);
    const t = (await boot(c)).tasks.find((t) => t.id === id);
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies((await c.storageState()).cookies);
    const p = await context.newPage();
    await p.goto("/workspace/tasks");
    assert.equal(
      await p.getByRole("button", { name: /Move task:/ }).count(),
      0,
    );
    await p.getByLabel("Task options: " + t.title, { exact: true }).click();
    await p
      .getByRole("group", { name: "Task actions" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await p
      .getByRole("group", { name: "Task locations" })
      .getByRole("button", { name: /Archive/ })
      .click();
    const archive = p.getByRole("region", { name: "Task Archive" });
    await archive.getByText(t.title, { exact: true }).waitFor();
    await archive
      .locator("article")
      .filter({ hasText: t.title })
      .getByRole("button", { name: "Move to Bin" })
      .click();
    await p
      .getByRole("group", { name: "Task locations" })
      .getByRole("button", { name: /Bin/ })
      .click();
    const bin = p.getByRole("region", { name: "Task Bin" });
    await bin.getByText(t.title, { exact: true }).waitFor();
    await bin
      .locator("article")
      .filter({ hasText: t.title })
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await p
      .getByRole("group", { name: "Task locations" })
      .getByRole("button", { name: "Active tasks", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Open task: " + t.title, exact: true })
      .waitFor();
  } finally {
    await browser.close();
    await c.dispose();
  }
});
