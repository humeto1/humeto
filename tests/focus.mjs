import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  tasks = [],
  prefix = "Focus QA " + randomUUID();
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
async function create(c) {
  const r = await c.post("/api/workspace/tasks", {
    data: {
      title: prefix,
      important: true,
      urgent: false,
      dueDate: "",
      assignee: "Ayesha Khan",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  tasks.push(id);
  return (await (await c.get("/api/workspace/bootstrap")).json()).tasks.find(
    (t) => t.id === id,
  );
}
const read = async (c) => (await c.get("/api/workspace/focus")).json();
const send = (c, v) => c.post("/api/workspace/focus", { data: v });
async function command(c, action, extra = {}) {
  const a = (await read(c)).active;
  return send(c, {
    action,
    sessionId: a?.id,
    revision: a?.revision,
    taskRevision: a?.task_revision,
    ...extra,
  });
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const t of tasks) {
    await d.prepare("DELETE FROM focus_sessions WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(t);
  }
  await d.close();
});
test("focus saves time, pauses, records blockers and completes the linked task", async () => {
  const c = await ctx("ayesha"),
    t = await create(c);
  let r = await send(c, {
    action: "start",
    taskId: t.id,
    taskRevision: t.revision,
    minutes: 25,
  });
  assert.equal(r.status(), 200, await r.text());
  let a = (await read(c)).active;
  assert.equal(a.state, "running");
  assert.ok(a.check_in_at);
  const d = database();
  await d
    .prepare(
      "UPDATE focus_sessions SET running_since=clock_timestamp()-interval '90 seconds' WHERE id=?",
    )
    .run(a.id);
  assert.equal((await command(c, "pause")).status(), 200);
  a = (await read(c)).active;
  assert.equal(a.state, "paused");
  assert.ok(a.total_seconds >= 90);
  assert.equal(a.check_in_at, null);
  assert.equal(
    (
      await command(c, "blocked", { note: "Waiting for the offer letter" })
    ).status(),
    200,
  );
  a = (await read(c)).active;
  assert.equal(a.state, "blocked");
  assert.equal(a.note, "Waiting for the offer letter");
  assert.equal((await command(c, "resume", { minutes: 10 })).status(), 200);
  assert.equal((await command(c, "complete")).status(), 200);
  const snapshot = await read(c);
  assert.equal(snapshot.active, null);
  const h = snapshot.history.find((s) => s.task_id === t.id);
  assert.equal(h.state, "completed");
  assert.equal(h.task_stage, "Done");
  assert.ok(h.ended_at);
  assert.ok(snapshot.events.some((e) => e.event === "blocked"));
});
test("focus permits one active session and rejects stale updates and invalid duration", async () => {
  const c = await ctx("ayesha"),
    t = await create(c);
  assert.equal(
    (
      await send(c, {
        action: "start",
        taskId: t.id,
        taskRevision: t.revision,
        minutes: 0,
      })
    ).status(),
    400,
  );
  const results = await Promise.all([
    send(c, {
      action: "start",
      taskId: t.id,
      taskRevision: t.revision,
      minutes: 5,
    }),
    send(c, {
      action: "start",
      taskId: t.id,
      taskRevision: t.revision,
      minutes: 5,
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status()).sort(), [200, 409]);
  const a = (await read(c)).active;
  assert.equal((await command(c, "pause")).status(), 200);
  assert.equal(
    (
      await send(c, { action: "resume", sessionId: a.id, revision: a.revision })
    ).status(),
    409,
  );
  assert.equal((await command(c, "stop")).status(), 200);
  assert.equal((await read(c)).active, null);
});
test("focus is private to each member and task board completion stops the timer", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("consultant"),
    student = await ctx("amira"),
    t = await create(c);
  assert.equal(
    (
      await send(c, {
        action: "start",
        taskId: t.id,
        taskRevision: t.revision,
        minutes: 2,
      })
    ).status(),
    200,
  );
  const a = (await read(c)).active;
  assert.equal((await read(other)).active, null);
  assert.equal(
    (
      await send(other, {
        action: "stop",
        sessionId: a.id,
        revision: a.revision,
      })
    ).status(),
    409,
  );
  assert.equal((await student.get("/api/workspace/focus")).status(), 403);
  let r = await c.patch("/api/workspace/tasks/" + t.id, {
    data: { stage: "Done", revision: a.task_revision },
  });
  assert.equal(r.status(), 200, await r.text());
  const snapshot = await read(c);
  assert.equal(snapshot.active, null);
  assert.equal(
    snapshot.history.find((s) => s.task_id === t.id).state,
    "completed",
  );
});
