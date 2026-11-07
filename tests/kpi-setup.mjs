import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
const base = process.env.HUMETO_TEST_URL,
  d = database();
after(() => d.close());
async function ctx(user = "ayesha") {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  await ok(await c.post("/api/auth/demo", { data: { userId: user } }));
  return c;
}
async function ok(r) {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
const scope = (type, id) => ({ type, parentId: id });
const read = (c, s, query = "") =>
  c
    .get("/api/plan-success?type=" + s.type + "&parentId=" + s.parentId + query)
    .then(ok);
const post = (c, s, v) => c.post("/api/plan-success", { data: { ...s, ...v } });
const back = (day, n) => {
  const v = new Date(day + "T12:00:00Z");
  v.setUTCDate(v.getUTCDate() - n);
  return v.toISOString().slice(0, 10);
};
let standaloneId, projectId, goalId, kpiId;
test("activity, project and inherited-goal scopes share zero-limit measurements and complete dated history", async () => {
  const c = await ctx(),
    foreign = await ctx("bright-owner"),
    student = await ctx("amira");
  try {
    const task = await ok(
      await c.post("/api/workspace/tasks", {
        data: { title: "Audit protein setup", important: true, urgent: true },
      }),
    );
    standaloneId = task.id;
    const s = scope("activity", task.id);
    const original = (await read(c, s)).activities[0];
    const k = await ok(
      await post(c, s, {
        action: "kpi",
        revision: 0,
        activityId: task.id,
        title: "Zero missed follow-ups",
        target: 0,
        unit: "misses",
        cadence: "daily",
        timezone: "Asia/Karachi",
        direction: "at_most",
      }),
    );
    kpiId = k.id;
    let data = await read(c, s),
      metric = data.kpis[0];
    assert.equal(metric.target, 0);
    assert.equal(data.activities[0].id, task.id);
    assert.equal(data.activities[0].storage_state, "active");
    assert.equal(
      (
        await foreign.get("/api/plan-success?type=activity&parentId=" + task.id)
      ).status(),
      404,
    );
    assert.equal(
      (
        await student.get("/api/plan-success?type=activity&parentId=" + task.id)
      ).status(),
      403,
    );
    assert.equal(
      (
        await post(foreign, s, {
          action: "result",
          revision: 0,
          activityId: task.id,
          id: k.id,
          kpiRevision: metric.revision,
          day: metric.day,
          actual: 0,
        })
      ).status(),
      404,
    );
    assert.equal(
      (
        await post(student, s, {
          action: "activity",
          id: task.id,
          revision: original.revision,
          isCsf: true,
        })
      ).status(),
      403,
    );
    for (let i = 0; i < 18; i++)
      await ok(
        await post(c, s, {
          action: "result",
          id: k.id,
          activityId: task.id,
          kpiRevision: metric.revision,
          revision: 0,
          day: back(metric.today, i),
          actual: 0,
        }),
      );
    data = await read(c, s);
    metric = data.kpis[0];
    assert.equal(metric.historyTotal, 18);
    assert.equal(metric.history.length, 12);
    assert.equal(metric.historyMore, true);
    const older = (await read(c, s, "&kpiId=" + k.id + "&offset=12")).kpis[0];
    assert.equal(older.history.length, 6);
    assert.equal(older.historyMore, false);
    const selected = (
      await read(c, s, "&kpiId=" + k.id + "&day=" + back(metric.today, 16))
    ).kpis[0];
    assert.equal(selected.current.revision, 1);
    await ok(
      await post(c, s, {
        action: "result",
        id: k.id,
        activityId: task.id,
        kpiRevision: metric.revision,
        revision: 1,
        day: selected.day,
        entryMode: "dated",
        actual: 2,
        note: "Historical correction",
      }),
    );
    assert.equal(
      (
        await post(c, s, {
          action: "result",
          id: k.id,
          activityId: task.id,
          kpiRevision: metric.revision,
          revision: 1,
          day: selected.day,
          actual: 3,
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await post(c, s, {
          action: "result",
          id: k.id,
          activityId: task.id,
          kpiRevision: metric.revision,
          revision: 0,
          day: back(metric.today, 1),
          entryMode: "current",
          actual: 0,
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await post(c, s, {
          action: "result",
          id: k.id,
          activityId: task.id,
          kpiRevision: metric.revision,
          revision: 0,
          day: back(metric.today, -1),
          actual: 0,
        })
      ).status(),
      400,
    );
    await ok(
      await post(c, s, {
        action: "kpi",
        id: k.id,
        activityId: task.id,
        revision: metric.revision,
        title: metric.title,
        target: 5,
        unit: "misses",
        cadence: "daily",
        timezone: metric.timezone,
        direction: "at_most",
      }),
    );
    metric = (await read(c, s)).kpis[0];
    assert.equal(Number(metric.current.target_snapshot), 0);
    await ok(
      await post(c, s, {
        action: "result",
        id: k.id,
        activityId: task.id,
        kpiRevision: metric.revision,
        revision: 0,
        day: back(metric.today, 25),
        actual: 0,
      }),
    );
    const past = (
      await read(c, s, "&kpiId=" + k.id + "&day=" + back(metric.today, 25))
    ).kpis[0];
    assert.equal(
      Number(past.current.target_snapshot),
      0,
      "Backfill uses the definition that applied on that date",
    );
    const project = await ok(
      await c.post("/api/workspace/projects", {
        data: {
          title: "Audit unified project",
          description: "QA",
          targetDate: "",
          status: "Active",
        },
      }),
    );
    projectId = project.id;
    const goal = await ok(
      await c.post("/api/workspace/goals", {
        data: {
          title: "Audit unified goal",
          description: "QA",
          targetDate: "2027-12-31",
          status: "Active",
        },
      }),
    );
    goalId = goal.id;
    await d
      .prepare("UPDATE projects SET goal_id=? WHERE id=?")
      .run(goal.id, project.id);
    await d
      .prepare("UPDATE tasks SET project_id=? WHERE id=?")
      .run(project.id, task.id);
    for (const parent of [
      scope("project", project.id),
      scope("goal", goal.id),
    ]) {
      const data = await read(c, parent);
      assert.equal(data.kpis.filter((m) => m.id === k.id).length, 1);
      assert.equal(data.activities.filter((a) => a.id === task.id).length, 1);
      assert.equal(
        (
          await post(c, parent, {
            action: "kpi",
            revision: 0,
            activityId: "not-this-task",
            title: "Invalid",
            target: 1,
            cadence: "daily",
            timezone: "UTC",
          })
        ).status(),
        404,
      );
    }
    const activity = (await read(c, s)).activities[0];
    await ok(
      await post(c, s, {
        action: "activity",
        id: task.id,
        revision: activity.revision,
        isCsf: true,
        isKpi: true,
        note: "Still critical after completion",
      }),
    );
    let boot = await ok(await c.get("/api/mobile")),
      current = boot.tasks.find((t) => t.id === task.id);
    await ok(
      await c.patch("/api/workspace/tasks/" + task.id, {
        data: { stage: "Done", revision: current.revision },
      }),
    );
    const complete = (await read(c, s)).activities[0];
    assert.equal(complete.stage, "Done");
    assert.equal(complete.is_csf, true);
    // Leave a daily KPI task available for the browser setup/editor audit.
    current = (await ok(await c.get("/api/mobile"))).tasks.find(
      (t) => t.id === task.id,
    );
    await ok(
      await c.patch("/api/workspace/tasks/" + task.id, {
        data: { stage: "To do", revision: current.revision },
      }),
    );
  } finally {
    await c.dispose();
    await foreign.dispose();
    await student.dispose();
  }
});
test("recurring occurrences resolve to one canonical activity and share measurements across scopes", async () => {
  const c = await ctx();
  try {
    const task = await ok(
      await c.post("/api/workspace/tasks", {
        data: {
          title: "Audit gym recurrence",
          important: false,
          urgent: false,
        },
      }),
    );
    const today = new Date().toISOString().slice(0, 10);
    await ok(
      await c.post("/api/workspace/scheduling", {
        data: {
          action: "series",
          taskId: task.id,
          taskRevision: 1,
          frequency: "daily",
          interval: 1,
          firstDay: today,
          time: "00:00",
          timezone: "UTC",
        },
      }),
    );
    await runTaskScheduler({
      d,
      tenantId: "northstar",
      userId: "ayesha",
      heartbeat: false,
    });
    const row = await d
      .prepare(
        "SELECT o.task_id FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id WHERE r.template_task_id=? LIMIT 1",
      )
      .get(task.id);
    assert.ok(row);
    const s = scope("activity", row.task_id);
    let data = await read(c, s);
    assert.equal(data.activities[0].id, task.id);
    const made = await ok(
      await post(c, s, {
        action: "kpi",
        revision: 0,
        activityId: task.id,
        title: "Gym visits",
        target: 3,
        unit: "visits",
        cadence: "weekly",
        timezone: "UTC",
      }),
    );
    assert.equal(
      (await read(c, scope("activity", task.id))).kpis[0].id,
      made.id,
    );
    assert.equal((await read(c, s)).kpis[0].id, made.id);
    for (const cadence of ["quarterly", "half_year"])
      await ok(
        await post(c, s, {
          action: "kpi",
          revision: 0,
          activityId: task.id,
          title: cadence,
          target: 0,
          cadence,
          timezone: "UTC",
        }),
      );
    await ok(
      await c.post("/api/workspace/task-storage/" + task.id, {
        data: {
          action: "archive",
          revision: (await read(c, s)).activities[0].revision,
        },
      }),
    );
    assert.equal(
      (
        await c.get("/api/plan-success?type=activity&parentId=" + row.task_id)
      ).status(),
      404,
    );
  } finally {
    await c.dispose();
  }
});
test("task editor exposes targets, dates, older history and protects an open result at midnight", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: base,
      viewport: { width: 393, height: 852 },
      timezoneId: "Asia/Karachi",
      extraHTTPHeaders: { Origin: base },
    });
    await ok(
      await context.request.post("/api/auth/demo", {
        data: { userId: "ayesha" },
      }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const clockData = await read(
      context.request,
      scope("activity", standaloneId),
    );
    await page.clock.install({
      time: new Date(clockData.kpis[0].today + "T12:00:00+05:00"),
    });
    await page.goto("/workspace/tasks");
    await page
      .getByRole("button", {
        name: "Open task: Audit protein setup",
        exact: true,
      })
      .click();
    const task = page.getByRole("dialog").first();
    await task
      .locator(".task-detail-group > summary")
      .filter({ hasText: "Activity tags" })
      .click();
    const measure = task.getByRole("region", {
      name: "Zero missed follow-ups",
      exact: true,
    });
    await measure.waitFor();
    await measure.getByText("History", { exact: true }).click();
    await measure
      .getByRole("button", { name: "Load older results", exact: true })
      .click();
    await measure
      .getByText("Showing 19 of 19 results", { exact: true })
      .waitFor();
    await measure
      .getByRole("button", { name: "Log result", exact: true })
      .or(measure.getByRole("button", { name: "Update result", exact: true }))
      .click();
    const editor = page.getByRole("dialog", {
      name: "Activity indicators and measurements",
      exact: true,
    });
    const input = editor.getByLabel("Measured total for this period", {
      exact: true,
    });
    await input.waitFor();
    await editor
      .getByRole("button", { name: "Yesterday", exact: true })
      .click();
    await input.fill("1");
    await editor
      .getByRole("button", { name: "Save result", exact: true })
      .click();
    await editor.waitFor({ state: "hidden" });
    await measure
      .getByRole("button", { name: "Update result", exact: true })
      .click();
    await input.waitFor();
    await input.fill("7");
    // Client clock crosses a boundary while editor is open: never silently submit to yesterday.
    await page.clock.fastForward(86400000);
    await editor
      .getByRole("alert")
      .filter({ hasText: "new reporting day" })
      .waitFor();
    assert.equal(
      await editor
        .getByRole("button", { name: "Save result", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await input.inputValue(), "7");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(
      await task.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      JSON.stringify(
        await task.evaluate((el) =>
          [...el.querySelectorAll("*")]
            .filter(
              (n) =>
                n.getBoundingClientRect().right >
                el.getBoundingClientRect().right,
            )
            .slice(0, 8)
            .map((n) => ({
              tag: n.tagName,
              cls: n.className,
              text: n.textContent?.slice(0, 50),
            })),
        ),
      ),
    );

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("new task tags guide target setup; project and goal map categories configure the same measurements", async () => {
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
    await ok(
      await context.request.post("/api/workspace/tasks", {
        data: {
          title: "Audit new standalone KPI",
          important: true,
          urgent: true,
        },
      }),
    );
    const page = await context.newPage();
    await page.goto("/workspace/tasks");
    await page
      .getByRole("button", {
        name: "Open task: Audit new standalone KPI",
        exact: true,
      })
      .click();
    const task = page.getByRole("dialog").first();
    await task
      .locator(".task-detail-group > summary")
      .filter({ hasText: "Activity tags" })
      .click();
    await task
      .getByLabel("KPI · Measure this activity", { exact: true })
      .check();
    await task.getByRole("button", { name: "Save tags", exact: true }).click();
    await task.getByText("Needs target", { exact: true }).waitFor();
    await task.getByRole("button", { name: "Set target", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "Activity indicators and measurements",
      exact: true,
    });
    await editor
      .getByLabel("Measurement name", { exact: true })
      .fill("Protein grams");
    await editor.getByLabel("Target", { exact: true }).fill("120");
    await editor.getByLabel("Unit", { exact: true }).fill("grams");
    await editor
      .getByRole("button", { name: "Save indicators", exact: true })
      .click();
    await task
      .getByRole("region", { name: "Protein grams", exact: true })
      .waitFor();
    await page.goto("/workspace/progress");
    for (const [type, id, title] of [
      ["project", projectId, "Audit unified project"],
      ["goal", goalId, "Audit unified goal"],
    ]) {
      const activity = await ok(
        await post(context.request, scope(type, id), {
          action: "activity",
          revision: 0,
          title: "Audit " + type + " category",
          isKpi: true,
          isCsf: true,
        }),
      );
      await page.reload();
      if (type === "goal")
        await page.getByRole("button", { name: "Goals", exact: true }).click();
      const card = page
        .locator(".workstream-card")
        .filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        });
      if (!(await card.isVisible()))
        await page
          .locator("summary")
          .filter({ hasText: "Plans without a deadline" })
          .click();
      await card
        .getByRole("button", {
          name: type === "goal" ? /Goal map/ : /Project map/,
        })
        .click();
      const map = page.getByRole("dialog").first();
      await map
        .getByRole("button", {
          name: "Edit Audit " + type + " category",
          exact: true,
        })
        .click();
      await map
        .getByRole("button", { name: "Set target", exact: true })
        .click();
      await editor
        .getByLabel("Measurement name", { exact: true })
        .fill(type + " zero limit");
      await editor.getByLabel("Target", { exact: true }).fill("0");
      await editor
        .getByLabel("Target period", { exact: true })
        .selectOption("half_year");
      await editor
        .getByLabel("Success means", { exact: true })
        .selectOption("at_most");
      await editor
        .getByRole("button", { name: "Save indicators", exact: true })
        .click();
      await map
        .getByRole("region", { name: type + " zero limit", exact: true })
        .waitFor();
      const data = await read(context.request, scope(type, id));
      assert.equal(
        data.kpis.filter((k) => k.activity_id === activity.id).length,
        1,
      );
      assert.equal(
        data.activities.find((a) => a.id === activity.id).storage_state,
        "planning",
      );
      const boot = await ok(await context.request.get("/api/mobile"));
      assert.equal(
        boot.tasks.some((t) => t.id === activity.id),
        false,
      );
      await map
        .getByRole("button", { name: "Close activity details", exact: true })
        .click();
      await map
        .getByRole("button", { name: "Close project map", exact: true })
        .click();
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
