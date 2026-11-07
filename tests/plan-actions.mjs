import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
const base = process.env.HUMETO_TEST_URL,
  d = database();
after(() => d.close());
async function ok(r) {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
async function ctx(user = "ayesha") {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  await ok(await c.post("/api/auth/demo", { data: { userId: user } }));
  return c;
}
const get = (c, type, id) =>
  c.get(`/api/plan-actions?type=${type}&planId=${id}`).then(ok);
async function act(c, type, id, action, extra = {}) {
  const { plan } = await get(c, type, id);
  return ok(
    await c.post("/api/plan-actions", {
      data: { type, planId: id, revision: plan.revision, action, ...extra },
    }),
  );
}
const tree = (c, id, type = "project") =>
  c.get(`/api/project-wbs?projectId=${id}&type=${type}`).then(ok);
async function wbs(c, id, command) {
  const t = await tree(c, id);
  return ok(
    await c.post("/api/project-wbs", {
      data: { projectId: id, revision: t.revision, ...command },
    }),
  );
}
let projectId, goalId;
test("plan rename, pause and resume preserve stages/history and hold work, focus, repeats and notifications", async () => {
  const c = await ctx(),
    other = await ctx("bright-owner"),
    student = await ctx("amira");
  try {
    goalId = (
      await ok(
        await c.post("/api/workspace/goals", {
          data: {
            title: "Plan actions goal",
            description: "Keep description",
            targetDate: "2027-12-31",
            status: "Active",
          },
        }),
      )
    ).id;
    projectId = (
      await ok(
        await c.post("/api/workspace/projects", {
          data: {
            title: "Plan actions project",
            description: "Original brief",
            targetDate: "2027-12-31",
            status: "Active",
            goalId,
          },
        }),
      )
    ).id;
    await wbs(c, projectId, {
      action: "add",
      titles: [
        "Active activity",
        "Repeating activity",
        "Completed CSF",
        "Planning category",
      ],
    });
    let t = await tree(c, projectId);
    const work = t.nodes.find((n) => n.title === "Active activity"),
      repeat = t.nodes.find((n) => n.title === "Repeating activity"),
      done = t.nodes.find((n) => n.title === "Completed CSF");
    for (const n of [work, done])
      await wbs(c, projectId, {
        action: "select",
        id: n.id,
        taskRevision: n.revision,
        selected: true,
      });
    t = await tree(c, projectId);
    let row = t.nodes.find((n) => n.id === done.id);
    await wbs(c, projectId, {
      action: "edit",
      id: row.id,
      taskRevision: row.revision,
      title: row.title,
      frequency: "once",
      stage: "Done",
      isCsf: true,
    });
    const day = new Date().toISOString().slice(0, 10);
    await wbs(c, projectId, {
      action: "edit",
      id: repeat.id,
      taskRevision: repeat.revision,
      title: repeat.title,
      frequency: "daily",
      firstDay: day,
      timezone: "UTC",
    });
    row = (await tree(c, projectId)).nodes.find((n) => n.id === repeat.id);
    await wbs(c, projectId, {
      action: "select",
      id: row.id,
      taskRevision: row.revision,
      selected: true,
    });
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      heartbeat: false,
    });
    const metric = await ok(
      await c.post("/api/plan-success", {
        data: {
          type: "project",
          parentId: projectId,
          action: "kpi",
          revision: 0,
          activityId: work.id,
          title: "Leads",
          target: 3,
          cadence: "daily",
          unit: "leads",
          timezone: "UTC",
        },
      }),
    );
    const metricData = (
      await ok(
        await c.get(`/api/plan-success?type=project&parentId=${projectId}`),
      )
    ).kpis.find((k) => k.id === metric.id);
    await ok(
      await c.post("/api/plan-success", {
        data: {
          type: "project",
          parentId: projectId,
          action: "result",
          id: metric.id,
          activityId: work.id,
          revision: 0,
          kpiRevision: metricData.revision,
          day: metricData.day,
          actual: 3,
        },
      }),
    );
    await d
      .prepare(
        "INSERT INTO plan_financial_targets(tenant_id,entity_type,entity_id,currency,completion,basis) VALUES('northstar','project',?,'PKR',90000,'month')",
      )
      .run(projectId);
    const milestone = randomUUID();
    await d
      .prepare(
        "INSERT INTO plan_milestones(id,tenant_id,entity_type,entity_id,title,target_date,status) VALUES(?,'northstar','project',?,'Launch milestone','2027-11-01','Completed')",
      )
      .run(milestone, projectId);
    await d
      .prepare("INSERT INTO milestone_tasks(milestone_id,task_id) VALUES(?,?)")
      .run(milestone, work.id);
    await d
      .prepare(
        "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES('northstar','project',?,'ayesha','ayesha')",
      )
      .run(projectId);
    row = (await tree(c, projectId)).nodes.find((n) => n.id === work.id);
    const focus = await ok(
      await c.post("/api/workspace/focus", {
        data: {
          action: "start",
          taskId: row.id,
          taskRevision: row.revision,
          minutes: 25,
        },
      }),
    );
    const before = await d
      .prepare("SELECT stage,completed_at FROM tasks WHERE id=?")
      .get(done.id);
    const history = await d
      .prepare(
        "SELECT project_title FROM task_events WHERE task_id=? AND event='completed'",
      )
      .get(done.id);
    await act(c, "project", projectId, "rename", {
      title: "Renamed plan project",
    });
    assert.equal(
      (await get(c, "project", projectId)).plan.description,
      "Original brief",
    );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT project_title FROM task_events WHERE task_id=? AND event='completed'",
          )
          .get(done.id)
      ).project_title,
      history.project_title,
    );
    await act(c, "project", projectId, "pause");
    let boot = await ok(await c.get("/api/mobile"));
    assert.equal(boot.tasks.find((n) => n.id === work.id).is_plan_paused, true);
    assert.equal(
      (
        await d
          .prepare("SELECT state FROM focus_sessions WHERE id=?")
          .get(focus.id)
      ).state,
      "paused",
    );
    assert.deepEqual(
      await d
        .prepare("SELECT stage,completed_at FROM tasks WHERE id=?")
        .get(done.id),
      before,
    );
    row = boot.tasks.find((n) => n.id === work.id);
    assert.equal(
      (
        await c.patch("/api/workspace/tasks/" + row.id, {
          data: { stage: "Done", revision: row.revision },
        })
      ).status(),
      409,
    );
    const occurrenceCount = (
      await d
        .prepare(
          "SELECT count(*)::int AS n FROM task_occurrences WHERE series_id IN (SELECT id FROM task_recurrences WHERE template_task_id=?)",
        )
        .get(repeat.id)
    ).n;
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      now: new Date(Date.now() + 86400000),
      heartbeat: false,
    });
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM task_occurrences WHERE series_id IN (SELECT id FROM task_recurrences WHERE template_task_id=?)",
          )
          .get(repeat.id)
      ).n,
      occurrenceCount,
    );
    const notifications = await ok(
      await c.post("/api/notification-plan", {
        data: { deviceId: randomUUID(), platform: "web" },
      }),
    );
    assert.equal(
      notifications.events.some(
        (e) => e.taskId === work.id || e.taskId === repeat.id,
      ),
      false,
    );
    await act(c, "goal", goalId, "pause");
    await act(c, "project", projectId, "resume");
    assert.equal(
      (await ok(await c.get("/api/mobile"))).tasks.find((n) => n.id === work.id)
        .is_plan_paused,
      true,
      "Another paused parent keeps the task held",
    );
    await act(c, "goal", goalId, "resume");
    assert.equal(
      (await ok(await c.get("/api/mobile"))).tasks.find((n) => n.id === work.id)
        .is_plan_paused,
      false,
    );
    assert.equal(
      (
        await d
          .prepare("SELECT state FROM focus_sessions WHERE id=?")
          .get(focus.id)
      ).state,
      "paused",
      "Focus never restarts automatically",
    );
    assert.equal(
      (
        await other.get(`/api/plan-actions?type=project&planId=${projectId}`)
      ).status(),
      404,
    );
    assert.equal(
      (
        await student.get(`/api/plan-actions?type=goal&planId=${goalId}`)
      ).status(),
      403,
    );
    const revision = (await get(c, "project", projectId)).plan.revision;
    await act(c, "project", projectId, "rename", {
      title: "Plan actions project",
    });
    assert.equal(
      (
        await c.post("/api/plan-actions", {
          data: {
            type: "project",
            planId: projectId,
            action: "rename",
            title: "Stale overwrite",
            revision,
          },
        })
      ).status(),
      409,
    );
  } finally {
    await c.dispose();
    await other.dispose();
    await student.dispose();
  }
});
test("planning copies preserve hierarchy and settings with independent ids and no task results or sharing", async () => {
  const c = await ctx();
  try {
    let t = await tree(c, projectId);
    const work = t.nodes.find((n) => n.title === "Active activity"),
      child = t.nodes.find((n) => n.title === "Planning category");
    await wbs(c, projectId, {
      action: "move",
      id: child.id,
      parentId: work.id,
    });
    await d
      .prepare(
        "UPDATE tasks SET value_type='profit',value_minor=5000000,value_currency='PKR' WHERE id=?",
      )
      .run(work.id);
    const copy = (
      await act(c, "project", projectId, "duplicate", {
        title: "Project planning copy",
      })
    ).id;
    const copied = await tree(c, copy),
      source = await tree(c, projectId);
    assert.equal(copied.nodes.length, source.nodes.length);
    assert.equal(
      copied.nodes.every(
        (n) => n.storage_state === "planning" && n.stage === "To do",
      ),
      true,
    );
    const a = copied.nodes.find((n) => n.title === work.title),
      b = copied.nodes.find((n) => n.title === child.title);
    assert.equal(b.parent_id, a.id);
    assert.notEqual(a.id, work.id);
    assert.equal(
      (await d.prepare("SELECT value_minor FROM tasks WHERE id=?").get(a.id))
        .value_minor,
      5000000,
    );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT completion FROM plan_financial_targets WHERE entity_type='project' AND entity_id=?",
          )
          .get(copy)
      ).completion,
      90000,
    );
    const metrics = await ok(
      await c.get(`/api/plan-success?type=project&parentId=${copy}`),
    );
    assert.equal(metrics.kpis.length, 1);
    assert.equal(metrics.kpis[0].historyTotal, 0);
    assert.notEqual(
      metrics.kpis[0].id,
      (
        await ok(
          await c.get(`/api/plan-success?type=project&parentId=${projectId}`),
        )
      ).kpis[0].id,
    );
    const repeat = copied.nodes.find((n) => n.title === "Repeating activity");
    assert.equal(
      (
        await d
          .prepare(
            "SELECT wbs_suspended FROM task_recurrences WHERE template_task_id=?",
          )
          .get(repeat.id)
      ).wbs_suspended,
      true,
    );
    const ms = await d
      .prepare(
        "SELECT id,status FROM plan_milestones WHERE entity_type='project' AND entity_id=?",
      )
      .get(copy);
    assert.equal(ms.status, "Pending");
    assert.equal(
      (
        await d
          .prepare("SELECT task_id FROM milestone_tasks WHERE milestone_id=?")
          .get(ms.id)
      ).task_id,
      a.id,
    );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM project_shares WHERE project_id=?",
          )
          .get(copy)
      ).n,
      0,
    );
    const own = await ok(
      await c.post("/api/plan-success", {
        data: {
          type: "goal",
          parentId: goalId,
          action: "activity",
          revision: 0,
          title: "Goal-owned CSF",
          isCsf: true,
        },
      }),
    );
    const goalCopy = (
      await act(c, "goal", goalId, "duplicate", { title: "Goal planning copy" })
    ).id;
    const goalMap = await tree(c, goalCopy, "goal");
    assert.equal(goalMap.nodes.length, 1);
    assert.equal(goalMap.nodes[0].is_csf, true);
    assert.notEqual(goalMap.nodes[0].id, own.id);
    assert.equal(
      (
        await d
          .prepare("SELECT count(*)::int AS n FROM projects WHERE goal_id=?")
          .get(goalCopy)
      ).n,
      0,
    );
  } finally {
    await c.dispose();
  }
});
test("delete can retain tasks and history or move linked tasks to Bin; other projects survive goal deletion", async () => {
  const c = await ctx();
  try {
    await act(c, "project", projectId, "pause");
    const work = (await tree(c, projectId)).nodes.find(
      (n) => n.title === "Active activity",
    );
    await act(c, "project", projectId, "delete");
    const retained = await d
      .prepare("SELECT storage_state,project_id FROM tasks WHERE id=?")
      .get(work.id);
    assert.equal(retained.storage_state, "active");
    assert.equal(retained.project_id, "");
    assert.equal(
      (await ok(await c.get("/api/mobile"))).tasks.find((t) => t.id === work.id)
        .is_plan_paused,
      false,
    );
    assert.equal(
      (
        await ok(
          await c.get(`/api/plan-success?type=activity&parentId=${work.id}`),
        )
      ).kpis[0].historyTotal,
      1,
    );
    const goalCopy = (
      await act(c, "goal", goalId, "duplicate", {
        title: "Delete audit goal copy",
      })
    ).id;
    await act(c, "goal", goalCopy, "delete");
    const p = (
      await ok(
        await c.post("/api/workspace/projects", {
          data: {
            title: "Delete task test",
            description: "QA",
            targetDate: "",
            status: "Active",
          },
        }),
      )
    ).id;
    await wbs(c, p, { action: "add", titles: ["Delete me"] });
    let t = (await tree(c, p)).nodes[0];
    await wbs(c, p, {
      action: "select",
      id: t.id,
      taskRevision: t.revision,
      selected: true,
    });
    await act(c, "project", p, "delete", { deleteTasks: true });
    t = await d
      .prepare(
        "SELECT storage_state,revision,purge_after FROM tasks WHERE id=?",
      )
      .get(t.id);
    assert.equal(t.storage_state, "bin");
    assert.ok(t.purge_after);
    await ok(
      await c.post(
        "/api/workspace/task-storage/" +
          (
            await d
              .prepare("SELECT id FROM tasks WHERE title='Delete me'")
              .get()
          ).id,
        { data: { action: "restore", revision: t.revision } },
      ),
    );
    assert.equal(
      (
        await d
          .prepare("SELECT project_id FROM tasks WHERE title='Delete me'")
          .get()
      ).project_id,
      "",
    );
    const projectsBefore = (
      await d
        .prepare("SELECT count(*)::int AS n FROM projects WHERE goal_id=?")
        .get(goalId)
    ).n;
    assert.ok(projectsBefore);
    await act(c, "goal", goalId, "delete");
    const active = (await ok(await c.get("/api/workspace/focus"))).active;
    if (active)
      await ok(
        await c.post("/api/workspace/focus", {
          data: {
            action: "stop",
            sessionId: active.id,
            revision: active.revision,
            taskRevision: active.task_revision,
          },
        }),
      );
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM projects WHERE title='Project planning copy'",
          )
          .get()
      ).n,
      1,
    );
  } finally {
    await c.dispose();
  }
});
test("project and goal card menus rename plans, map headers rename, and Go filters tasks", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 393, height: 852 },
      extraHTTPHeaders: { Origin: base },
    });
    await ok(
      await context.request.post("/api/auth/demo", {
        data: { userId: "ayesha" },
      }),
    );
    const page = await context.newPage();
    const p = await ok(
      await context.request.post("/api/workspace/projects", {
        data: {
          title: "Menu project audit",
          description: "UI",
          targetDate: "2027-12-31",
          status: "Active",
        },
      }),
    );
    await page.goto("/workspace/progress");
    let card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "Menu project audit",
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Project options", exact: true })
      .click();
    const options = page.getByRole("dialog", {
      name: "Project options",
      exact: true,
    });
    await options.getByRole("button", { name: "Rename", exact: true }).click();
    await options
      .getByLabel("Name", { exact: true })
      .fill("Renamed card audit");
    await options
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await options.waitFor({ state: "hidden" });
    card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "Renamed card audit",
        exact: true,
      }),
    });
    await card.getByRole("button", { name: /Project map/ }).click();
    const map = page.getByRole("dialog").first();
    await map
      .getByRole("button", { name: "Rename project", exact: true })
      .click();
    await options.getByLabel("Name", { exact: true }).fill("Renamed map audit");
    await options
      .getByRole("button", { name: "Save name", exact: true })
      .click();
    await map
      .getByRole("heading", { name: "Renamed map audit", exact: true })
      .waitFor();
    await map
      .getByRole("button", { name: "Close project map", exact: true })
      .click();
    card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "Renamed map audit",
        exact: true,
      }),
    });
    await card
      .getByRole("button", {
        name: "Go to tasks for Renamed map audit",
        exact: true,
      })
      .click();
    await page.waitForURL("**/workspace/tasks?project=" + p.id);
    await page
      .locator("summary")
      .filter({ hasText: /Filters/ })
      .first()
      .click();
    await page
      .getByRole("combobox", { name: "Task project filter", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Task project filter", exact: true })
        .inputValue(),
      p.id,
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await context.close();
  } finally {
    await browser.close();
  }
});
