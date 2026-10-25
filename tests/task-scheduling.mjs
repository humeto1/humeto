import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
import {
  nextDay,
  scheduledAt,
  quietUntil,
  latestOccurrence,
  localDay,
  defaultPreferences,
} from "../src/lib/scheduling-clock.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  d = database(),
  contexts = [],
  tasks = [],
  seriesIds = [];
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
      title: "Scheduling QA " + randomUUID(),
      important: true,
      urgent: false,
      dueDate: "",
      assignee: "Ayesha Khan",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const id = (await r.json()).id;
  tasks.push(id);
  return (await (await c.get("/api/workspace/bootstrap")).json()).tasks.find(
    (t) => t.id === id,
  );
}
const read = async (c) => (await c.get("/api/workspace/scheduling")).json();
const send = (c, v) => c.post("/api/workspace/scheduling", { data: v });
async function preferences(c, extra = {}) {
  const s = await read(c),
    p = s.preferences;
  const r = await send(c, {
    action: "preferences",
    revision: p.revision,
    enabled: true,
    timezone: "UTC",
    quietEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
    dailyLimit: 3,
    followupMinutes: 0,
    ...extra,
  });
  assert.equal(r.status(), 200, await r.text());
}
async function reminder(c, t, at = new Date(Date.now() - 1000).toISOString()) {
  const id = randomUUID();
  await d
    .prepare(
      "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
    )
    .run(id, t.tenant_id, "ayesha", t.id, at, "UTC");
  return id;
}
after(async () => {
  for (const c of contexts) await c.dispose();
  for (const sid of seriesIds) {
    const generated = await d
      .prepare("SELECT task_id FROM task_occurrences WHERE series_id=?")
      .all(sid);
    for (const x of generated) if (x.task_id) tasks.push(x.task_id);
    await d.prepare("DELETE FROM task_recurrences WHERE id=?").run(sid);
  }
  for (const id of tasks) {
    await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(id);
    await d
      .prepare(
        "DELETE FROM work_assignments WHERE entity_type='task' AND entity_id=?",
      )
      .run(id);
    await d.prepare("DELETE FROM task_goals WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  await d.close();
});
test("recurrence calendar preserves monthly anchors, weekdays and DST wall times", () => {
  assert.equal(nextDay("2026-01-31", "monthly", 1, 31), "2026-02-28");
  assert.equal(nextDay("2026-02-28", "monthly", 1, 31), "2026-03-31");
  assert.equal(nextDay("2028-01-31", "monthly", 1, 31), "2028-02-29");
  assert.equal(nextDay("2026-10-16", "weekdays"), "2026-10-19");
  assert.equal(
    scheduledAt("2026-03-08", "02:30", "America/New_York"),
    "2026-03-08T07:00:00.000Z",
  );
  assert.equal(
    quietUntil(new Date("2026-10-18T20:00:00Z"), defaultPreferences),
    "2026-10-19T03:00:00.000Z",
  );
  assert.equal(
    quietUntil(new Date("2026-10-18T10:00:00Z"), defaultPreferences),
    null,
  );
  const s = {
    next_day: "2026-10-01",
    first_day: "2026-10-01",
    frequency: "daily",
    interval_count: 1,
    end_day: "",
    local_time: "09:00",
    timezone: "UTC",
  };
  assert.deepEqual(latestOccurrence(s, new Date("2026-10-18T10:00Z")), {
    day: "2026-10-18",
    next: "2026-10-19",
    ended: false,
  });
  assert.equal(
    latestOccurrence(
      { ...s, end_day: "2026-10-15" },
      new Date("2026-10-18T10:00Z"),
    ).day,
    "2026-10-15",
  );
});
test("recurring generation catches up once, copies project/goal/assignments, survives retries and pauses", async () => {
  const c = await ctx("ayesha"),
    t = await create(c),
    today = localDay(new Date(), "UTC");
  await d
    .prepare("UPDATE tasks SET project_id='demo-project-intake' WHERE id=?")
    .run(t.id);
  await d
    .prepare(
      "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,'demo-goal-ready')",
    )
    .run(t.tenant_id, t.id);
  await d
    .prepare(
      "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES(?,'task',?,'consultant','ayesha')",
    )
    .run(t.tenant_id, t.id);
  const r = await send(c, {
    action: "series",
    taskId: t.id,
    taskRevision: t.revision,
    frequency: "daily",
    interval: 1,
    firstDay: today,
    time: "00:00",
    timezone: "UTC",
  });
  assert.equal(r.status(), 200, await r.text());
  let s = (await read(c)).series.find((s) => s.template_task_id === t.id);
  seriesIds.push(s.id);
  await d
    .prepare("UPDATE task_recurrences SET first_day=?,next_day=? WHERE id=?")
    .run(nextDay(today, "daily", -5), nextDay(today, "daily", -5), s.id);
  const now = new Date();
  await Promise.all([
    runTaskScheduler({ d, now }),
    runTaskScheduler({ d, now }),
  ]);
  const occurrences = await d
    .prepare("SELECT * FROM task_occurrences WHERE series_id=?")
    .all(s.id);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].day, today);
  const generated = await d
    .prepare("SELECT * FROM tasks WHERE id=?")
    .get(occurrences[0].task_id);
  assert.equal(generated.stage, "To do");
  assert.equal(generated.title, t.title);
  assert.equal(generated.important, 1);
  assert.equal(generated.due_date, today);
  assert.equal(generated.project_id, "demo-project-intake");
  assert.ok(
    await d
      .prepare(
        "SELECT goal_id FROM task_goals WHERE task_id=? AND goal_id='demo-goal-ready'",
      )
      .get(generated.id),
  );
  assert.ok(
    await d
      .prepare(
        "SELECT user_id FROM work_assignments WHERE entity_id=? AND user_id='consultant'",
      )
      .get(generated.id),
  );
  await runTaskScheduler({ d, now });
  assert.equal(
    (
      await d
        .prepare("SELECT * FROM task_occurrences WHERE series_id=?")
        .all(s.id)
    ).length,
    1,
  );
  s = (await read(c)).series.find((x) => x.id === s.id);
  assert.equal(
    (
      await send(c, {
        action: "series-state",
        id: s.id,
        revision: s.revision,
        status: "paused",
      })
    ).status(),
    200,
  );
  await runTaskScheduler({ d, now: new Date(now.getTime() + 86400000) });
  assert.equal(
    (
      await d
        .prepare("SELECT * FROM task_occurrences WHERE series_id=?")
        .all(s.id)
    ).length,
    1,
  );
  assert.equal(
    (
      await send(c, {
        action: "series-state",
        id: s.id,
        revision: s.revision,
        status: "active",
      })
    ).status(),
    409,
  );
  s = (await read(c)).series.find((x) => x.id === s.id);
  assert.equal(
    (
      await send(c, {
        action: "series-state",
        id: s.id,
        revision: s.revision,
        status: "cancelled",
      })
    ).status(),
    200,
  );
});
test("follow-ups honor quiet hours, daily limits, cooldown, snooze, completion and tenant boundaries", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    student = await ctx("amira"),
    t = await create(c),
    now = new Date(),
    minute = now.toISOString().slice(11, 16),
    end = new Date(now.getTime() + 60 * 60000).toISOString().slice(11, 16);
  await preferences(c, {
    quietEnabled: true,
    quietStart: minute,
    quietEnd: end,
    dailyLimit: 1,
    followupMinutes: 0,
  });
  const id = await reminder(c, t);
  await runTaskScheduler({ d, now });
  assert.equal(
    await d
      .prepare("SELECT * FROM task_followup_notifications WHERE reminder_id=?")
      .get(id),
    undefined,
  );
  await preferences(c, { dailyLimit: 3, followupMinutes: 0 });
  await runTaskScheduler({ d, now });
  const first = await d
    .prepare("SELECT * FROM task_followup_notifications WHERE reminder_id=?")
    .get(id);
  assert.ok(first);
  await runTaskScheduler({ d, now: new Date(now.getTime() + 30 * 60000) });
  assert.equal(
    (
      await d
        .prepare(
          "SELECT * FROM task_followup_notifications WHERE reminder_id=?",
        )
        .get(id)
    ).nudge_count,
    1,
  );
  await runTaskScheduler({ d, now: new Date(now.getTime() + 61 * 60000) });
  assert.equal(
    (
      await d
        .prepare(
          "SELECT * FROM task_followup_notifications WHERE reminder_id=?",
        )
        .get(id)
    ).nudge_count,
    1,
  );
  let r = (await read(c)).reminders.find((r) => r.id === id);
  assert.ok(r);
  assert.equal((await other.get("/api/workspace/scheduling")).status(), 200);
  assert.ok(!(await read(other)).reminders.some((x) => x.id === id));
  assert.equal(
    (
      await send(other, {
        action: "snooze",
        id,
        revision: r.revision,
        minutes: 60,
      })
    ).status(),
    404,
  );
  assert.equal((await student.get("/api/workspace/scheduling")).status(), 403);
  assert.equal(
    (
      await send(c, { action: "snooze", id, revision: r.revision, minutes: 60 })
    ).status(),
    200,
  );
  assert.equal(
    (
      await send(c, { action: "snooze", id, revision: r.revision, minutes: 60 })
    ).status(),
    409,
  );
  assert.equal(
    await d
      .prepare("SELECT * FROM task_followup_notifications WHERE reminder_id=?")
      .get(id),
    undefined,
  );
  r = (await read(c)).reminders.find((r) => r.id === id);
  assert.ok(Date.parse(r.remind_at) > Date.now() + 59 * 60000);
  assert.equal(
    (
      await send(c, {
        action: "finish",
        id,
        revision: r.revision,
        taskRevision: r.task_revision,
      })
    ).status(),
    200,
  );
  assert.ok(!(await read(c)).reminders.some((x) => x.id === id));
  await runTaskScheduler({ d, now: new Date(now.getTime() + 2 * 86400000) });
  assert.equal(
    await d
      .prepare("SELECT * FROM task_followup_notifications WHERE reminder_id=?")
      .get(id),
    undefined,
  );
  // Explicit reminders stay outside the automatic budget and notify only once.
  const t2 = await create(c),
    id2 = await reminder(c, t2),
    tomorrow = new Date(
      new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10) +
        "T12:00:00Z",
    );
  await preferences(c, { dailyLimit: 1, followupMinutes: 0 });
  await runTaskScheduler({ d, now: tomorrow });
  await runTaskScheduler({ d, now: new Date(tomorrow.getTime() + 61 * 60000) });
  const count = await d
    .prepare(
      "SELECT count(*) AS n FROM task_reminder_events WHERE tenant_id='northstar' AND user_id='ayesha' AND event='notified' AND reminder_id=? AND timezone('UTC',created_at)::date=?::date",
    )
    .get(id2, tomorrow.toISOString().slice(0, 10));
  assert.equal(Number(count.n), 1);
});
test("scheduling preferences reject stale writes and readonly workspaces cannot advance schedules", async () => {
  const c = await ctx("ayesha"),
    p = (await read(c)).preferences;
  assert.equal(
    (
      await send(c, {
        action: "preferences",
        revision: p.revision - 1,
        enabled: true,
        timezone: "UTC",
        quietEnabled: false,
        quietStart: "22:00",
        quietEnd: "08:00",
        dailyLimit: 3,
        followupMinutes: 0,
      })
    ).status(),
    409,
  );
  const t = await create(c),
    rid = await reminder(c, t),
    prior = await d
      .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
      .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='paused' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal(
      (await send(c, { action: "dismiss", id: rid, revision: 1 })).status(),
      403,
    );
    await runTaskScheduler({ d, now: new Date(Date.now() + 10 * 86400000) });
    assert.equal(
      await d
        .prepare(
          "SELECT * FROM task_followup_notifications WHERE reminder_id=?",
        )
        .get(rid),
      undefined,
    );
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(prior.status);
  }
});
test("schedules UI creates a recurring series, saves preferences and fits a narrow screen", async () => {
  const browser = await chromium.launch(),
    context = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 1280, height: 950 },
    });
  try {
    await context.request.post("/api/auth/demo", {
      data: { userId: "ayesha" },
    });
    const t = await create(context.request),
      page = await context.newPage();
    await page.goto(base + "/workspace/tasks#task-followups");
    await page
      .getByRole("tab", { name: "Schedule a task", exact: true })
      .click();
    await page
      .getByLabel("Task schedule type", { exact: true })
      .selectOption("series");
    await page.getByLabel("Scheduled task", { exact: true }).selectOption(t.id);
    await page
      .getByLabel("Schedule first date", { exact: true })
      .fill(localDay(new Date(), "UTC"));
    await page.getByLabel("Schedule timezone", { exact: true }).fill("UTC");
    await page
      .getByRole("button", { name: "Create recurring series", exact: true })
      .click();
    await page
      .getByText("Recurring series saved. Each run creates one new task.", {
        exact: true,
      })
      .waitFor();
    const s = (await read(context.request)).series.find(
      (x) => x.template_task_id === t.id,
    );
    seriesIds.push(s.id);
    const seriesCard = page
      .locator("article")
      .filter({ has: page.getByText(t.title, { exact: true }) })
      .filter({
        has: page.getByText("Edit future occurrences", { exact: true }),
      });
    await seriesCard
      .getByText("Edit future occurrences", { exact: true })
      .click();
    await seriesCard
      .getByLabel("Edit repeat frequency", { exact: true })
      .selectOption("monthly");
    await seriesCard
      .getByLabel("Edit next occurrence", { exact: true })
      .fill(nextDay(localDay(new Date(), "UTC"), "daily", 1));
    await seriesCard
      .getByRole("button", { name: "Save future schedule", exact: true })
      .click();
    await page.getByText("Schedule updated.", { exact: true }).waitFor();
    assert.equal(
      (await read(context.request)).series.find((x) => x.id === s.id).frequency,
      "monthly",
    );
    await seriesCard.getByLabel(/I want to skip/).check();
    await page.screenshot({
      path: "artifacts/recurrence-review.jpg",
      fullPage: true,
    });
    await seriesCard
      .getByRole("button", { name: "Confirm skip occurrence", exact: true })
      .click();
    await page.getByText("Schedule updated.", { exact: true }).waitFor();
    assert.ok(
      (await read(context.request)).seriesEvents.some(
        (e) => e.series_id === s.id && e.event === "skipped",
      ),
    );
    await page
      .getByRole("tab", { name: "My preferences", exact: true })
      .click();
    await page.getByLabel("Daily nudge limit", { exact: true }).fill("3");
    await page
      .getByRole("button", { name: "Save my preferences", exact: true })
      .click();
    await page
      .getByText("Follow-up preferences saved.", { exact: true })
      .waitFor();
    assert.equal((await read(context.request)).preferences.daily_limit, 3);
    await page.goto(base + "/workspace/progress");
    const project = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "UK September intake",
        exact: true,
      }),
    });
    await project
      .getByRole("button", { name: "Assign project team", exact: true })
      .click();
    await project
      .getByRole("checkbox", { name: "Leila Morgan", exact: true })
      .check();
    await project
      .getByRole("button", { name: "Save project team", exact: true })
      .click();
    await project
      .getByRole("button", { name: "1 assigned", exact: true })
      .waitFor();
    assert.ok(
      await d
        .prepare(
          "SELECT user_id FROM work_assignments WHERE entity_type='project' AND entity_id='demo-project-intake' AND user_id='consultant'",
        )
        .get(),
    );
    await page.goto(base + "/workspace/tasks#task-followups");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page
      .getByRole("tab", { name: "Schedule a task", exact: true })
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  } finally {
    await context.close();
    await browser.close();
  }
});

test("recurring schedule edits preserve history, reject stale/foreign edits and skip one occurrence without creating work", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("consultant"),
    t = await create(c),
    today = localDay(new Date(), "UTC"),
    tomorrow = nextDay(today, "daily", 1);
  assert.equal(
    (
      await send(c, {
        action: "series",
        taskId: t.id,
        taskRevision: t.revision,
        frequency: "daily",
        interval: 1,
        firstDay: tomorrow,
        time: "09:00",
        timezone: "UTC",
      })
    ).status(),
    200,
  );
  let s = (await read(c)).series.find((s) => s.template_task_id === t.id);
  seriesIds.push(s.id);
  const edit = {
    action: "series-edit",
    id: s.id,
    revision: s.revision,
    frequency: "monthly",
    interval: 1,
    nextDay: tomorrow,
    time: "10:30",
    timezone: "UTC",
    endDay: "",
  };
  assert.equal((await send(other, edit)).status(), 404);
  assert.equal(
    (await send(c, { ...edit, nextDay: "2026-02-30" })).status(),
    400,
  );
  assert.equal(
    (await send(c, { ...edit, nextDay: today, time: "00:00" })).status(),
    400,
  );
  assert.equal((await send(c, edit)).status(), 200);
  assert.equal((await send(c, edit)).status(), 409);
  s = (await read(c)).series.find((x) => x.id === s.id);
  assert.equal(s.frequency, "monthly");
  assert.equal(s.local_time, "10:30");
  assert.equal(s.first_day, tomorrow);
  const skip = { action: "series-skip", id: s.id, revision: s.revision };
  const attempts = await Promise.all([send(c, skip), send(c, skip)]);
  assert.deepEqual(attempts.map((r) => r.status()).sort(), [200, 409]);
  s = (await read(c)).series.find((x) => x.id === s.id);
  assert.equal(s.next_day, nextDay(tomorrow, "monthly", 1));
  assert.equal(Number(s.occurrence_count), 0);
  const skipped = await d
    .prepare("SELECT * FROM task_occurrences WHERE series_id=? AND day=?")
    .get(s.id, tomorrow);
  assert.equal(skipped.task_id, null);
  // The worker cannot turn a skipped day into a task, even when retried at that date.
  await runTaskScheduler({ d, now: new Date(tomorrow + "T12:00:00Z") });
  assert.equal(
    (
      await d
        .prepare(
          "SELECT task_id FROM task_occurrences WHERE series_id=? AND day=?",
        )
        .get(s.id, tomorrow)
    ).task_id,
    null,
  );
  assert.equal(
    (
      await send(c, { ...edit, revision: s.revision, nextDay: tomorrow })
    ).status(),
    409,
  );
  const state = await read(c);
  assert.ok(
    state.seriesEvents.some(
      (e) => e.series_id === s.id && e.event === "edited",
    ),
  );
  assert.ok(
    state.seriesEvents.some(
      (e) => e.series_id === s.id && e.event === "skipped",
    ),
  );
  assert.ok(
    !(await read(other)).seriesEvents.some((e) => e.series_id === s.id),
  );
  assert.equal(
    (
      await send(c, {
        action: "series-state",
        id: s.id,
        revision: s.revision,
        status: "paused",
      })
    ).status(),
    200,
  );
  s = (await read(c)).series.find((x) => x.id === s.id);
  assert.equal(
    (
      await send(c, {
        ...edit,
        revision: s.revision,
        nextDay: nextDay(s.next_day, "daily", 1),
      })
    ).status(),
    200,
  );
  assert.equal(
    (await read(c)).series.find((x) => x.id === s.id).status,
    "paused",
  );
});
