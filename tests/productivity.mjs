import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL,
  d = database(),
  ids = [],
  clients = [];
async function ctx(user) {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  clients.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: user } })).status(),
    200,
  );
  return c;
}
async function post(c, path, data) {
  const r = await c.post(path, { data });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
after(async () => {
  for (const c of clients) await c.dispose();
  for (const id of ids) {
    await d.query("DELETE FROM tasks WHERE id=$1", [id]);
    await d.query("DELETE FROM plan_milestones WHERE entity_id=$1", [id]);
    await d.query("DELETE FROM projects WHERE id=$1", [id]);
  }
  await d.close();
});
test("productivity splits measured work at local midnight, excludes other users, and shows completion history", async () => {
  const c = await ctx("consultant"),
    id = randomUUID();
  ids.push(id);
  await d.query(
    "INSERT INTO tasks(id,tenant_id,title,important,urgent) VALUES($1,'northstar','Measured dashboard task',1,1)",
    [id],
  );
  const template = randomUUID(),
    series = randomUUID();
  ids.push(template);
  await d.query(
    "INSERT INTO tasks(id,tenant_id,title) VALUES($1,'northstar','Repeating template')",
    [template],
  );
  await d.query(
    "INSERT INTO task_recurrences(id,tenant_id,user_id,template_task_id,frequency,interval_count,first_day,next_day,local_time,timezone,status,track_occurrences) VALUES($1,'northstar','consultant',$2,'daily',1,'2026-10-20','2026-10-21','09:00','UTC','paused',true)",
    [series, template],
  );
  await d.query(
    "INSERT INTO task_occurrences(series_id,day,task_id) VALUES($1,'2026-10-20',$2)",
    [series, id],
  );
  const sid = randomUUID();
  await d.query(
    "INSERT INTO focus_sessions(id,tenant_id,user_id,task_id,target_minutes,state,elapsed_seconds,started_at,ended_at) VALUES($1,'northstar','consultant',$2,60,'stopped',3600,'2026-10-20T23:30:00Z','2026-10-21T00:30:00Z')",
    [sid, id],
  );
  await d.query(
    "INSERT INTO focus_work_intervals(session_id,tenant_id,user_id,task_id,started_at,ended_at) VALUES($1,'northstar','consultant',$2,'2026-10-20T23:30:00Z','2026-10-21T00:30:00Z')",
    [sid, id],
  );
  await d.query(
    "UPDATE tasks SET stage='Done',last_actor_id='consultant' WHERE id=$1",
    [id],
  );
  await d.query(
    "UPDATE task_events SET created_at='2026-10-21T00:30:00Z' WHERE task_id=$1 AND event='completed'",
    [id],
  );
  const r = await c.get(
    "/api/productivity?start=2026-10-20&end=2026-10-21&timezone=UTC",
  );
  assert.equal(r.status(), 200, await r.text());
  const v = await r.json();
  assert.deepEqual(
    v.daily.map((d) => d.seconds),
    [1800, 1800],
  );
  assert.ok(v.completed.some((t) => t.task_id === id));
  assert.equal(v.completed.find((t) => t.task_id === id).repeating, true);
  assert.equal(v.summary.done + v.summary.pending, v.summary.total);
  assert.ok(v.summary.repeating <= v.summary.total);
  assert.equal(v.timings.find((t) => t.task_id === id).seconds, 3600);
  const hourly = await c.get(
    "/api/productivity?start=2026-10-21&end=2026-10-21&timezone=UTC",
  );
  assert.equal(hourly.status(), 200, await hourly.text());
  const bins = (await hourly.json()).buckets;
  assert.equal(bins.length, 24);
  assert.equal(
    bins.reduce((s, d) => s + d.seconds, 0),
    1800,
  );
  const empty = await (
    await c.get(
      "/api/productivity?start=2026-10-19&end=2026-10-19&timezone=UTC",
    )
  ).json();
  assert.equal(empty.daily[0].seconds, 0);
  const dst = await (
    await c.get(
      "/api/productivity?start=2026-11-01&end=2026-11-01&timezone=America%2FNew_York",
    )
  ).json();
  assert.equal(dst.buckets.length, 25);
  assert.ok(dst.buckets.every((b) => b.seconds === 0));
  const other = await ctx("bright-owner");
  const foreign = await (
    await other.get(
      "/api/productivity?start=2026-10-20&end=2026-10-21&timezone=UTC",
    )
  ).json();
  assert.equal(
    foreign.timings.some((t) => t.task_id === id),
    false,
  );
  assert.equal((await other.get("/api/milestones?taskId=" + id)).status(), 404);
  assert.equal(
    (
      await c.get(
        "/api/productivity?start=2026-10-22&end=2026-10-20&timezone=UTC",
      )
    ).status(),
    400,
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: await c.storageState(),
    });
    const page = await context.newPage();
    await page.goto(base + "/workspace");
    await page
      .getByRole("heading", { name: "Make your time count." })
      .waitFor();
    await page
      .getByRole("button", { name: "Custom range", exact: true })
      .click();
    await page.getByLabel("From", { exact: true }).fill("2026-10-20");
    const changed = page.waitForResponse((r) =>
      r.url().includes("/api/productivity?start=2026-10-20&end=2026-10-21"),
    );
    await page.getByLabel("To", { exact: true }).fill("2026-10-21");
    const payload = await (await changed).json();
    assert.equal(
      payload.daily.reduce((s, d) => s + d.seconds, 0),
      3600,
    );
    await page
      .getByRole("img", {
        name: /Hours worked from 2026-10-20 to 2026-10-21: 1.0 h/,
      })
      .waitFor();
    assert.equal(await page.locator(".home-task-views").count(), 0);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: ".data/productivity-mobile.png",
      fullPage: true,
    });
    await context.close();
  } finally {
    await browser.close();
  }
});
test("milestones save task links, reject stale/foreign edits, and plan completion records elapsed duration", async () => {
  const c = await ctx("consultant");
  const p = await post(c, "/api/workspace/projects", {
    title: "Milestone ongoing project",
  });
  ids.push(p.id);
  const t = await post(c, "/api/workspace/tasks", {
    title: "Milestone linked task",
    projectId: p.id,
    important: true,
    urgent: false,
    dueDate: "",
    assignee: "Omar Ali",
  });
  ids.push(t.id);
  const m = await post(c, "/api/milestones", {
    type: "project",
    parentId: p.id,
    title: "First delivery",
    targetDate: "",
    taskIds: [t.id],
  });
  let state = await (
    await c.get("/api/milestones?type=project&parentId=" + p.id)
  ).json();
  assert.equal(state.parent.target_date, "");
  assert.equal(state.milestones[0].tasks[0].id, t.id);
  const row = state.milestones[0];
  await post(c, "/api/milestones", {
    type: "project",
    parentId: p.id,
    id: m.id,
    revision: row.revision,
    title: row.title,
    status: "Completed",
    taskIds: [t.id],
  });
  assert.equal(
    (
      await c.post("/api/milestones", {
        data: {
          type: "project",
          parentId: p.id,
          id: m.id,
          revision: row.revision,
          title: "Stale",
          taskIds: [],
        },
      })
    ).status(),
    409,
  );
  const other = await ctx("bright-owner");
  assert.equal(
    (
      await other.post("/api/milestones", {
        data: { type: "project", parentId: p.id, title: "Foreign" },
      })
    ).status(),
    404,
  );
  const complete = await c.patch("/api/workspace/projects/" + p.id, {
    data: {
      title: state.parent.title,
      targetDate: "",
      status: "Completed",
      revision: state.parent.revision,
    },
  });
  assert.equal(complete.status(), 200, await complete.text());
  state = await (
    await c.get("/api/milestones?type=project&parentId=" + p.id)
  ).json();
  assert.ok(state.parent.completed_at);
  assert.ok(state.milestones[0].completed_at);
  const student = await ctx("amira");
  assert.equal(
    (
      await student.get("/api/milestones?type=project&parentId=" + p.id)
    ).status(),
    403,
  );
});
