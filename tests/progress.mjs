import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  ep = "/api/workspace/",
  contexts = [],
  taskIds = [],
  planIds = [],
  leadIds = [];
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
async function post(c, path, data) {
  const r = await c.post(ep + path, { data });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
async function boot(c) {
  return (await c.get(ep + "bootstrap")).json();
}
async function task(c, id) {
  return (await boot(c)).tasks.find((t) => t.id === id);
}
async function plan(c, kind, title) {
  const v = await post(c, kind, {
    title,
    ...(kind === "goals" ? { targetDate: "2027-12-31" } : {}),
  });
  planIds.push([kind, v.id]);
  return v.id;
}
async function create(c, personId = "") {
  const v = await post(c, "tasks", {
    title: "Progress QA " + randomUUID(),
    personId,
    important: true,
    urgent: false,
    dueDate: "2026-10-25",
    assignee: "Ayesha Khan",
  });
  taskIds.push(v.id);
  return v.id;
}
async function stage(c, id, value) {
  const t = await task(c, id);
  const r = await c.patch(ep + "tasks/" + id, {
    data: { stage: value, revision: t.revision },
  });
  assert.equal(r.status(), 200, await r.text());
}
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const t of taskIds) {
    await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM task_goals WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM lead_followups WHERE task_id=?").run(t);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(t);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(t);
  }
  for (const [kind, id] of planIds) {
    await d.prepare("DELETE FROM " + kind + " WHERE id=?").run(id);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(id);
  }
  for (const l of leadIds) {
    await d.prepare("DELETE FROM leads WHERE id=?").run(l);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(l);
  }
  await d.close();
});
test("completion and reopening events survive relinking and repeated Done saves", async () => {
  const c = await ctx("ayesha");
  const p = await plan(c, "projects", "QA Original project"),
    p2 = await plan(c, "projects", "QA New project"),
    g = await plan(c, "goals", "QA Goal"),
    g2 = await plan(c, "goals", "QA Second goal"),
    tid = await create(c);
  let t = await task(c, tid);
  let r = await c.patch(ep + "task-links/" + tid, {
    data: { revision: t.revision, projectId: p, goalIds: [g, g2, g] },
  });
  assert.equal(r.status(), 200);
  assert.equal((await task(c, tid)).goals.length, 2);
  assert.equal(
    (
      await c.patch(ep + "task-links/" + tid, {
        data: { revision: t.revision, projectId: p2, goalIds: [] },
      })
    ).status(),
    409,
  );
  await stage(c, tid, "Done");
  assert.ok((await task(c, tid)).completed_at);
  await stage(c, tid, "Done");
  let history = await (await c.get(ep + "task-history")).json();
  let events = history.events.filter(
    (e) => e.task_id === tid && e.event === "completed",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].project_id, p);
  assert.equal(events[0].goals.length, 2);
  assert.equal(events[0].actor_name, "Ayesha Khan");
  t = await task(c, tid);
  await c.patch(ep + "task-links/" + tid, {
    data: { revision: t.revision, projectId: p2, goalIds: [] },
  });
  history = await (await c.get(ep + "task-history")).json();
  assert.equal(history.events.find((e) => e.id === events[0].id).project_id, p);
  await stage(c, tid, "To do");
  assert.equal((await task(c, tid)).completed_at, null);
  await stage(c, tid, "Done");
  history = await (await c.get(ep + "task-history")).json();
  assert.equal(
    history.events.filter((e) => e.task_id === tid && e.event === "completed")
      .length,
    2,
  );
  assert.equal(history.completions.filter((e) => e.task_id === tid).length, 1);
  assert.equal(
    history.completions.find((e) => e.task_id === tid).project_id,
    p2,
  );
  assert.equal(
    history.events.filter((e) => e.task_id === tid && e.event === "reopened")
      .length,
    1,
  );
});
test("monthly progress uses local timezone, snapshots and unique task counts", async () => {
  const c = await ctx("ayesha"),
    p = await plan(c, "projects", "QA Boundary project"),
    g = await plan(c, "goals", "QA Boundary goal"),
    tid = await create(c);
  let t = await task(c, tid);
  await c.patch(ep + "task-links/" + tid, {
    data: { revision: t.revision, projectId: p, goalIds: [g] },
  });
  await stage(c, tid, "Done");
  const d = database();
  await d
    .prepare(
      "UPDATE task_events SET created_at='2026-09-30T20:30:00.000Z' WHERE task_id=? AND event='completed'",
    )
    .run(tid);
  await d.close();
  const pk = await (
      await c.get(ep + "task-history?month=2026-10&timezone=Asia%2FKarachi")
    ).json(),
    utc = await (
      await c.get(ep + "task-history?month=2026-10&timezone=UTC")
    ).json();
  assert.ok(pk.completions.some((e) => e.task_id === tid));
  assert.ok(!utc.completions.some((e) => e.task_id === tid));
  assert.equal(pk.projects.find((x) => x.id === p).count, 1);
  assert.equal(pk.goals.find((x) => x.id === g).count, 1);
  assert.equal((await c.get(ep + "task-history?month=2026-13")).status(), 400);
  assert.equal(
    (await c.get(ep + "task-history?timezone=not-a-zone")).status(),
    400,
  );
});
test("plans, links and reports enforce roles, tenant isolation and stale revisions", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    pid = await plan(c, "projects", "QA Internal project"),
    gid = await plan(other, "goals", "QA Other tenant goal"),
    tid = await create(c, "amira");
  let t = await task(c, tid);
  assert.equal(
    (
      await c.patch(ep + "task-links/" + tid, {
        data: { revision: t.revision, projectId: pid, goalIds: [gid] },
      })
    ).status(),
    404,
  );
  assert.equal((await task(c, tid)).project_id, "");
  assert.equal(
    (
      await c.patch(ep + "task-links/" + tid, {
        data: { revision: t.revision, projectId: pid, goalIds: [] },
      })
    ).status(),
    200,
  );
  const student = await ctx("amira"),
    platform = await ctx("admin");
  for (const x of [student, platform]) {
    const b = await boot(x);
    assert.deepEqual(b.projects, []);
    assert.deepEqual(b.goals, []);
    assert.equal((await x.get(ep + "task-history")).status(), 403);
    assert.equal(
      (await x.post(ep + "goals", { data: { title: "Denied" } })).status(),
      403,
    );
  }
  const st = (await boot(student)).tasks.find((t) => t.id === tid);
  assert.equal(st.project_id, "");
  assert.equal(st.project_title, "");
  assert.deepEqual(st.goals, []);
  assert.ok(!(await boot(other)).projects.some((p) => p.id === pid));
  assert.equal(
    (
      await other.patch(ep + "projects/" + pid, {
        data: { title: "Denied", revision: 1 },
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await c.patch(ep + "projects/" + pid, {
        data: { title: "Updated", revision: 1 },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await c.patch(ep + "projects/" + pid, {
        data: { title: "Stale", revision: 1 },
      })
    ).status(),
    409,
  );
  assert.equal(
    (
      await c.post(ep + "projects", {
        data: { title: "Bad date", targetDate: "2026-02-30" },
      })
    ).status(),
    400,
  );
});
test("completion stops old reminders, and reopening does not reactivate them", async () => {
  const c = await ctx("ayesha"),
    tid = await create(c);
  const d = database();
  const rid = randomUUID();
  await d
    .prepare(
      "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,'northstar','ayesha',?,?,'Asia/Karachi')",
    )
    .run(rid, tid, new Date().toISOString());
  await stage(c, tid, "Done");
  assert.equal(
    (await d.prepare("SELECT status FROM task_reminders WHERE id=?").get(rid))
      .status,
    "completed",
  );
  await stage(c, tid, "To do");
  assert.equal(
    (await d.prepare("SELECT status FROM task_reminders WHERE id=?").get(rid))
      .status,
    "completed",
  );
  await d.close();
});
test("lead follow-up creates one real assigned task per date and guards stale/closed leads", async () => {
  const c = await ctx("ayesha");
  const l = await post(c, "leads", {
    name: "QA Followup lead",
    email: "follow-" + randomUUID() + "@example.com",
    follow_up: "2026-10-25",
  });
  leadIds.push(l.id);
  const first = await post(c, "leads/" + l.id + "/follow-up", { revision: 1 });
  taskIds.push(first.taskId);
  const replay = await post(c, "leads/" + l.id + "/follow-up", { revision: 1 });
  assert.equal(replay.taskId, first.taskId);
  const t = await task(c, first.taskId);
  assert.equal(t.due_date, "2026-10-25");
  assert.equal(t.assignee, "Ayesha Khan");
  assert.equal(t.important, 1);
  assert.equal(
    (
      await c.post(ep + "leads/" + l.id + "/follow-up", {
        data: { revision: 999 },
      })
    ).status(),
    409,
  );
  await c.patch(ep + "leads/" + l.id, { data: { stage: "Lost", revision: 1 } });
  assert.equal(
    (
      await c.post(ep + "leads/" + l.id + "/follow-up", {
        data: { revision: 2 },
      })
    ).status(),
    400,
  );
  const other = await ctx("bright-owner");
  assert.equal(
    (
      await other.post(ep + "leads/" + l.id + "/follow-up", {
        data: { revision: 2 },
      })
    ).status(),
    404,
  );
});
test("new tasks accept validated project/goal links and reports remain readable when subscription is read-only", async () => {
  const c = await ctx("ayesha"),
    p = await plan(c, "projects", "QA Creation project"),
    g = await plan(c, "goals", "QA Creation goal");
  const made = await post(c, "tasks", {
    title: "QA Linked at creation",
    important: false,
    urgent: false,
    projectId: p,
    goalIds: [g],
  });
  taskIds.push(made.id);
  assert.equal((await task(c, made.id)).project_id, p);
  assert.equal((await task(c, made.id)).goals[0].id, g);
  const d = database();
  const sub = await d
    .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
    .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='expired' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal((await c.get(ep + "task-history")).status(), 200);
    assert.equal(
      (
        await c.post(ep + "projects", {
          data: { title: "Denied while read-only" },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await c.post("/api/crm-agent", {
          data: {
            operation: "message",
            message: "Show cases for amira.shah@example.com",
            clientKey: randomUUID(),
          },
        })
      ).status(),
      403,
    );
    assert.equal((await c.get("/api/crm-agent")).status(), 200);
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(sub.status);
    await d.close();
  }
});
