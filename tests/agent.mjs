import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
const zone = "Asia/Karachi",
  threads = new Set(),
  taskIds = new Set(),
  agentProjects = new Set(),
  contexts = [];
async function context(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  if (user)
    assert.equal(
      (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
      200,
    );
  return c;
}
async function message(c, text, threadId, clientKey = randomUUID()) {
  const r = await c.post("/api/agent", {
    data: {
      operation: "message",
      message: text,
      timezone: zone,
      clientKey,
      ...(threadId ? { threadId } : {}),
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const d = await r.json();
  threads.add(d.threadId);
  return d;
}
const lastAction = (d) =>
  [...d.messages].reverse().find((m) => m.result.action)?.result.action;
async function action(c, card, decision = "apply") {
  const r = await c.post("/api/agent", {
    data: { operation: "action", actionId: card.id, decision, timezone: zone },
  });
  if (r.ok()) {
    const d = await r.json();
    const applied = lastAction(d);
    if (applied?.taskId) taskIds.add(applied.taskId);
    return { r, d };
  }
  return { r };
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const db = database();
  for (const t of threads) {
    await db.prepare("DELETE FROM agent_actions WHERE thread_id=?").run(t);
    await db.prepare("DELETE FROM agent_messages WHERE thread_id=?").run(t);
    await db.prepare("DELETE FROM agent_threads WHERE id=?").run(t);
  }
  for (const t of taskIds) {
    await db.prepare("DELETE FROM task_reminders WHERE task_id=?").run(t);
    await db
      .prepare("DELETE FROM audit WHERE entity_type='task' AND entity_id=?")
      .run(t);
    await db.prepare("DELETE FROM task_goals WHERE task_id=?").run(t);
    await db.prepare("DELETE FROM task_events WHERE task_id=?").run(t);
    await db.prepare("DELETE FROM tasks WHERE id=?").run(t);
  }
  for (const pid of agentProjects) {
    await db
      .prepare("DELETE FROM audit WHERE entity_type='project' AND entity_id=?")
      .run(pid);
    await db.prepare("DELETE FROM projects WHERE id=?").run(pid);
  }
  await db.close();
});
test("assistant creates a reviewed task/reminder once and answers saved priority counts", async () => {
  const c = await context("ayesha");
  const before = await (await c.get("/api/workspace/bootstrap")).json();
  const key = randomUUID();
  let d = await message(
    c,
    "Create an important task to create a group with the new prospect team and remind me tomorrow",
    undefined,
    key,
  );
  assert.equal(d.engine, "Local command testing");
  assert.equal(d.modelConfigured, false);
  let card = lastAction(d);
  assert.equal(card.payload.title, "create a group with the new prospect team");
  assert.equal(card.payload.important, true);
  assert.equal(card.payload.urgent, false);
  assert(card.payload.reminderAt.endsWith("T04:00:00.000Z"));
  assert.equal(card.payload.timezone, zone);
  assert.equal(
    (await (await c.get("/api/workspace/bootstrap")).json()).tasks.length,
    before.tasks.length,
    "proposal must not create a task",
  );
  const repeated = await message(
    c,
    "Create an important task to create a group with the new prospect team and remind me tomorrow",
    undefined,
    key,
  );
  assert.equal(repeated.threadId, d.threadId);
  assert.equal(repeated.messages.length, 2);
  const applied = await action(c, card);
  assert.equal(applied.r.status(), 200);
  d = applied.d;
  card = lastAction(d);
  const tid = card.taskId;
  assert(tid);
  assert.equal(card.status, "applied");
  assert(d.reminders.some((r) => r.task_id === tid));
  await action(c, card);
  const saved = await (await c.get("/api/workspace/bootstrap")).json();
  assert.equal(saved.tasks.length, before.tasks.length + 1);
  assert.equal(saved.tasks.find((t) => t.id === tid).title, card.payload.title);
  const reload = await (
    await c.get(`/api/agent?threadId=${d.threadId}&timezone=${zone}`)
  ).json();
  assert.equal(lastAction(reload).status, "applied");
  d = await message(c, "How many important tasks are pending?", d.threadId);
  const expected = saved.tasks.filter(
    (t) => t.assignee === "Ayesha Khan" && t.important && t.stage !== "Done",
  ).length;
  assert.equal(d.messages.at(-1).result.total, expected);
  assert(
    d.messages.at(-1).content.includes(`${expected} important pending tasks`),
  );
  d = await message(c, `Mark "${tid}" done`, d.threadId);
  card = lastAction(d);
  assert.equal(card.payload.kind, "update");
  assert.equal(card.payload.stage, "Done");
  assert.equal(card.payload.important, true);
  await action(c, card);
  const completedHistory = await (
    await c.get("/api/workspace/task-history")
  ).json();
  assert.equal(
    completedHistory.events.filter(
      (e) => e.task_id === tid && e.event === "completed",
    ).length,
    1,
  );
  const finished = await (
    await c.get(`/api/agent?threadId=${d.threadId}&timezone=${zone}`)
  ).json();
  assert(
    !finished.reminders.some((r) => r.task_id === tid),
    "completed tasks stop surfacing reminders",
  );
});
test("private threads, action ownership, tenant and role boundaries are enforced", async () => {
  const owner = await context("ayesha"),
    staff = await context("consultant"),
    other = await context("bright-owner"),
    student = await context("amira"),
    platform = await context("admin"),
    anon = await context();
  assert.equal((await anon.get("/api/agent")).status(), 401);
  assert.equal((await student.get("/api/agent")).status(), 403);
  assert.equal((await platform.get("/api/agent")).status(), 403);
  const d = await message(owner, "Create a task to verify partner scope");
  const card = lastAction(d);
  for (const c of [staff, other]) {
    assert.equal(
      (await c.get("/api/agent?threadId=" + d.threadId)).status(),
      404,
    );
    assert.equal((await action(c, card)).r.status(), 404);
  }
  const denied = await owner.post("/api/agent", {
    headers: { Origin: "https://untrusted.example" },
    data: {
      operation: "action",
      actionId: card.id,
      decision: "apply",
      timezone: zone,
    },
  });
  assert.equal(denied.status(), 403);
  const cancelled = await action(owner, card, "cancel");
  assert.equal(lastAction(cancelled.d).status, "cancelled");
  assert.equal(
    (await action(owner, card)).d.messages.length,
    cancelled.d.messages.length,
  );
  const badZone = await owner.get("/api/agent?timezone=Not%2FAZone");
  assert.equal(badZone.status(), 400);
  const staffData = await (await staff.get("/api/agent")).json();
  assert(!staffData.threads.some((t) => t.id === d.threadId));
});
test("ambiguous matches, changed revisions and invalid reminder dates never silently change tasks", async () => {
  const c = await context("ayesha");
  let d = await message(c, "Create a task to QA duplicate matching alpha");
  let applied = await action(c, lastAction(d));
  const first = lastAction(applied.d).taskId;
  d = await message(
    c,
    "Create a task to QA duplicate matching beta",
    d.threadId,
  );
  await action(c, lastAction(d));
  d = await message(c, "Mark QA duplicate matching important", d.threadId);
  assert(d.messages.at(-1).content.startsWith("More than one task"));
  assert.equal(d.messages.at(-1).result.tasks.length, 2);
  assert(!d.messages.at(-1).result.action);
  d = await message(c, `Make "${first}" important`, d.threadId);
  const card = lastAction(d);
  const saved = (
    await (await c.get("/api/workspace/bootstrap")).json()
  ).tasks.find((t) => t.id === first);
  const edit = await c.patch("/api/workspace/tasks/" + first, {
    data: { stage: "Waiting", revision: saved.revision },
  });
  assert.equal(edit.status(), 200);
  const conflict = await action(c, card);
  assert.equal(conflict.r.status(), 409);
  const bad = await c.post("/api/agent", {
    data: {
      operation: "message",
      message: "Create a task to check missing date and remind me next Friday",
      threadId: d.threadId,
      clientKey: randomUUID(),
      timezone: zone,
    },
  });
  assert.equal(bad.status(), 400);
  const invalid = await c.post("/api/agent", {
    data: {
      operation: "message",
      message: "Create a task to check date and remind me 2026-02-30",
      threadId: d.threadId,
      clientKey: randomUUID(),
      timezone: zone,
    },
  });
  assert.equal(invalid.status(), 400);
});
test("due reminders survive reload, remain user-scoped and can be dismissed", async () => {
  const c = await context("consultant");
  let d = await message(
    c,
    "Remind me to QA reminder notification in 2 minutes",
  );
  const applied = await action(c, lastAction(d));
  const tid = lastAction(applied.d).taskId;
  const db = database();
  await db
    .prepare("UPDATE task_reminders SET remind_at=? WHERE task_id=?")
    .run(new Date(Date.now() - 60000).toISOString(), tid);
  await db.close();
  d = await (await c.get("/api/agent?timezone=" + zone)).json();
  const reminder = d.reminders.find((r) => r.task_id === tid);
  assert(reminder.due);
  const r = await c.post("/api/agent", {
    data: { operation: "dismiss", reminderId: reminder.id, timezone: zone },
  });
  assert.equal(r.status(), 200);
  assert(!(await r.json()).reminders.some((x) => x.id === reminder.id));
});
test("quadrant queries keep urgency independent and summary polling omits private history", async () => {
  const c = await context("ayesha");
  const all = (await (await c.get("/api/workspace/bootstrap")).json()).tasks;
  const state = await message(c, "Show my important not urgent pending tasks");
  const expected = all.filter(
    (t) =>
      t.assignee === "Ayesha Khan" &&
      t.stage !== "Done" &&
      t.important &&
      !t.urgent,
  );
  assert.equal(state.messages.at(-1).result.total, expected.length);
  assert(
    state.messages.at(-1).result.tasks.every((t) => t.important && !t.urgent),
  );
  const summary = await (await c.get("/api/agent?summary=1")).json();
  assert.equal(summary.threadId, null);
  assert.deepEqual(summary.messages, []);
  assert.deepEqual(summary.threads, []);
  assert.equal(
    summary.counts.important,
    all.filter(
      (t) => t.assignee === "Ayesha Khan" && t.stage !== "Done" && t.important,
    ).length,
  );
});
test("read-only subscriptions preserve assistant summaries but block messages and action application", async () => {
  const c = await context("ayesha");
  const state = await message(c, "Create a task to QA read only assistant");
  const card = lastAction(state);
  const db = database();
  const previous = (
    await db
      .prepare("SELECT status FROM subscriptions WHERE tenant_id=?")
      .get("northstar")
  ).status;
  try {
    await db
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id=?")
      .run("read-only", "northstar");
    assert.equal((await c.get("/api/agent?summary=1")).status(), 200);
    assert.equal((await action(c, card)).r.status(), 403);
    const r = await c.post("/api/agent", {
      data: {
        operation: "message",
        message: "Create a task to deny writes",
        clientKey: randomUUID(),
        timezone: zone,
      },
    });
    assert.equal(r.status(), 403);
  } finally {
    await db
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id=?")
      .run(previous, "northstar");
    await db.close();
  }
});

test("Natural-language task preview creates and links an explicitly reviewed project only on apply", async () => {
  const c = await context("ayesha"),
    d = database(),
    name = "Study abroad QA " + randomUUID();
  const before = await d
    .prepare("SELECT count(*) AS n FROM projects WHERE tenant_id=? AND title=?")
    .get("northstar", name);
  assert.equal(before.n, 0);
  let s = await message(
    c,
    `submit Faiza's visa application by 23 Oct 2030. Project is ${name}`,
  );
  let card = lastAction(s);
  assert.ok(card);
  assert.equal(card.payload.title, "submit Faiza's visa application");
  assert.equal(card.payload.dueDate, "2030-10-23");
  assert.equal(card.payload.projectTitle, name);
  assert.equal(card.payload.createProject, true);
  assert.equal(
    (
      await d
        .prepare(
          "SELECT count(*) AS n FROM projects WHERE tenant_id=? AND title=?",
        )
        .get("northstar", name)
    ).n,
    0,
  );
  const result = await action(c, card);
  assert.equal(result.r.status(), 200);
  const task = await d
    .prepare("SELECT * FROM tasks WHERE id=?")
    .get(lastAction(result.d).taskId);
  assert.ok(task.project_id);
  const project = await d
    .prepare("SELECT * FROM projects WHERE id=?")
    .get(task.project_id);
  assert.equal(project.tenant_id, "northstar");
  assert.equal(project.title, name);
  s = await message(
    c,
    `prepare documents by 24 Oct 2030. Project: ${name.toUpperCase()}`,
  );
  card = lastAction(s);
  assert.equal(card.payload.projectId, project.id);
  assert.equal(card.payload.createProject, false);
  await action(c, card, "cancel");
  // Project cleanup is deferred until task cleanup, via the test file's after hook.
  agentProjects.add(project.id);
});

test("assistant history uses bounded, owned cursor pages without gaps or duplicates", async () => {
  const c = await context("ayesha");
  const initial = await message(c, "Show my pending tasks");
  const db = database();
  const thread = await db
    .prepare("SELECT tenant_id FROM agent_threads WHERE id=?")
    .get(initial.threadId);
  const ids = [];
  for (let i = 0; i < 65; i++) {
    const id = randomUUID();
    ids.push(id);
    await db
      .prepare(
        "INSERT INTO agent_messages (id,thread_id,tenant_id,role,content,result,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        initial.threadId,
        thread.tenant_id,
        "user",
        `History fixture ${i}`,
        "{}",
        new Date().toISOString(),
      );
  }
  let page = await (
    await c.get(`/api/agent?threadId=${initial.threadId}`)
  ).json();
  assert.equal(page.messages.length, 30);
  assert.equal(page.messages.at(-1).id, ids.at(-1));
  const all = [...page.messages];
  while (page.history.hasOlder) {
    const response = await c.get(
      `/api/agent?threadId=${initial.threadId}&before=${page.history.before}`,
    );
    assert.equal(response.status(), 200);
    page = await response.json();
    assert.ok(page.messages.length <= 30);
    all.unshift(...page.messages);
  }
  assert.deepEqual(
    all.map((m) => m.id),
    [...initial.messages.map((m) => m.id), ...ids],
  );
  assert.equal(new Set(all.map((m) => m.id)).size, all.length);
  await db
    .prepare("UPDATE agent_threads SET updated_at=?,title=? WHERE id=?")
    .run("2099-01-01 00:00:00", "History pagination fixture", initial.threadId);
  const browser = await chromium.launch();
  try {
    const browserContext = await browser.newContext({
      storageState: await c.storageState(),
    });
    const page = await browserContext.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(base + "/workspace/assistant");
    const scroller = page.getByLabel("Conversation messages", { exact: true });
    await scroller
      .getByText("History fixture 64", { exact: true })
      .waitFor({ timeout: 8000 })
      .catch(async (e) => {
        throw Error(
          e.message +
            " UI: " +
            (await page.locator("body").innerText()).slice(-3000) +
            " Errors: " +
            errors.join(" | "),
        );
      });
    assert.equal(await scroller.locator("article").count(), 30);
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await scroller.getByText("History fixture 5", { exact: true }).waitFor();
    assert.equal(await scroller.locator("article").count(), 60);
    assert.ok(
      await scroller.evaluate((el) => el.scrollTop > 0),
      "Prepending preserves the visible message anchor",
    );
  } finally {
    await browser.close();
  }
  const other = { threadId: randomUUID() };
  threads.add(other.threadId);
  await db
    .prepare(
      "INSERT INTO agent_threads (id,tenant_id,user_id,title) VALUES (?,?,?,?)",
    )
    .run(other.threadId, thread.tenant_id, "ayesha", "Other history fixture");
  assert.equal(
    (
      await c.get(`/api/agent?threadId=${other.threadId}&before=${ids[0]}`)
    ).status(),
    404,
  );
  assert.equal(
    (
      await c.get(`/api/agent?threadId=${initial.threadId}&before=bad`)
    ).status(),
    400,
  );
  const partner = await context("bright-owner");
  assert.notEqual(
    (
      await partner.get(
        `/api/agent?threadId=${initial.threadId}&before=${ids[0]}`,
      )
    ).status(),
    200,
  );
});
