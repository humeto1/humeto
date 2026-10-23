import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { runTaskScheduler } from "../src/lib/task-scheduler.mjs";
import { nextDay, localDay } from "../src/lib/scheduling-clock.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  d = database(),
  contexts = [],
  series = [],
  plans = [];
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
  const r = await c.post("/api/workspace/" + path, { data });
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
after(async () => {
  for (const id of series) {
    const s = await d
      .prepare("SELECT template_task_id FROM task_recurrences WHERE id=?")
      .get(id);
    const rows = await d
      .prepare("SELECT task_id FROM task_occurrences WHERE series_id=?")
      .all(id);
    await d.prepare("DELETE FROM task_recurrences WHERE id=?").run(id);
    for (const tid of [
      s?.template_task_id,
      ...rows.map((r) => r.task_id),
    ].filter(Boolean)) {
      await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(tid);
      await d.prepare("DELETE FROM task_goals WHERE task_id=?").run(tid);
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(tid);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(tid);
    }
  }
  for (const [kind, id] of plans)
    await d.prepare(`DELETE FROM ${kind} WHERE id=?`).run(id);
  for (const c of contexts) await c.dispose();
  await d.close();
});
test("routine types preserve missed daily occurrences, regenerate independently of completion, and count late completion", async () => {
  const c = await ctx("ayesha"),
    today = localDay(new Date(), "UTC");
  const r = await post(c, "planning", {
    action: "routine",
    title: "QA daily operations",
    kind: "operations",
    category: "Work",
    frequency: "daily",
    firstDay: today,
    time: "00:00",
    timezone: "UTC",
  });
  series.push(r.id);
  const first = nextDay(today, "daily", -3);
  await d
    .prepare("UPDATE task_recurrences SET first_day=?,next_day=? WHERE id=?")
    .run(first, first, r.id);
  await runTaskScheduler({
    d,
    heartbeat: false,
    tenantId: "northstar",
    userId: "ayesha",
    routineOnly: true,
  });
  let occ = await d
    .prepare("SELECT * FROM task_occurrences WHERE series_id=? ORDER BY day")
    .all(r.id);
  assert.equal(occ.length, 4);
  const count = (
    await d
      .prepare("SELECT count(*) AS n FROM tasks WHERE tenant_id=?")
      .get("northstar")
  ).n;
  await runTaskScheduler({
    d,
    heartbeat: false,
    tenantId: "northstar",
    userId: "ayesha",
    routineOnly: true,
  });
  assert.equal(
    (
      await d
        .prepare("SELECT count(*) AS n FROM tasks WHERE tenant_id=?")
        .get("northstar")
    ).n,
    count,
  );
  let report = await (
    await c.get("/api/workspace/planning?week=" + today + "&timezone=UTC")
  ).json();
  assert.ok(
    report.occurrences.some(
      (o) => o.series_id === r.id && o.state === "missed",
    ),
  );
  const t = await d
    .prepare("SELECT * FROM tasks WHERE id=?")
    .get(occ[0].task_id);
  assert.equal(t.work_kind, "routine");
  assert.equal(t.category, "Work");
  assert.equal(
    (
      await c.patch("/api/workspace/tasks/" + t.id, {
        data: { stage: "Done", revision: t.revision },
      })
    ).status(),
    200,
  );
  report = await (
    await c.get("/api/workspace/planning?week=" + first + "&timezone=UTC")
  ).json();
  assert.equal(
    report.occurrences.find((o) => o.task_id === t.id).state,
    "done",
  );
  const tomorrow = nextDay(today, "daily");
  await runTaskScheduler({
    d,
    heartbeat: false,
    tenantId: "northstar",
    userId: "ayesha",
    routineOnly: true,
    now: new Date(tomorrow + "T12:00:00Z"),
  });
  assert.ok(
    (
      await d
        .prepare(
          "SELECT task_id FROM task_occurrences WHERE series_id=? AND day=?",
        )
        .get(r.id, tomorrow)
    ).task_id,
  );
});
test("groceries repeat monthly, subscription yearly handles leap dates, skipped days are not missed", async () => {
  const c = await ctx("ayesha"),
    today = localDay(new Date(), "UTC");
  assert.equal(nextDay("2024-02-29", "yearly", 1, 29), "2025-02-28");
  assert.equal(nextDay("2027-02-28", "yearly", 1, 29), "2028-02-29");
  for (const [kind, freq] of [
    ["groceries", "monthly"],
    ["subscription", "yearly"],
  ]) {
    const r = await post(c, "planning", {
      action: "routine",
      title: "QA " + kind,
      kind,
      frequency: freq,
      firstDay: nextDay(today, "daily"),
      time: "09:00",
      timezone: "UTC",
    });
    series.push(r.id);
    const s = await d
      .prepare("SELECT * FROM task_recurrences WHERE id=?")
      .get(r.id);
    assert.equal(s.routine_kind, kind);
    await post(c, "scheduling", {
      action: "series-skip",
      id: s.id,
      revision: s.revision,
    });
    assert.equal(
      (
        await d
          .prepare("SELECT disposition FROM task_occurrences WHERE series_id=?")
          .get(s.id)
      ).disposition,
      "skipped",
    );
  }
});
test("planning and alert preferences reject foreign tenants, students, stale edits and expired writes", async () => {
  const c = await ctx("ayesha"),
    student = await ctx("amira");
  assert.equal((await student.get("/api/workspace/planning")).status(), 403);
  const prefs = (await (await c.get("/api/workspace/scheduling")).json())
    .preferences;
  await post(c, "planning", {
    action: "alerts",
    revision: prefs.revision,
    tone: "bell",
    vibration: false,
    precise: true,
  });
  const saved = (await (await c.get("/api/workspace/scheduling")).json())
    .preferences;
  assert.equal(saved.tone, "bell");
  assert.equal(saved.vibration, false);
  assert.equal(saved.precise, true);
  assert.equal(
    (
      await c.post("/api/workspace/planning", {
        data: {
          action: "alerts",
          revision: prefs.revision,
          tone: "silent",
          vibration: false,
          precise: false,
        },
      })
    ).status(),
    409,
  );
  const foreign = await ctx("bright-owner");
  const data = await (await foreign.get("/api/workspace/planning")).json();
  assert.ok(!data.routines.some((s) => series.includes(s.id)));
  const subscription = await d
    .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
    .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='expired' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal(
      (
        await c.post("/api/workspace/planning", {
          data: {
            action: "alerts",
            revision: saved.revision,
            tone: "chime",
            vibration: true,
            precise: false,
          },
        })
      ).status(),
      403,
    );
    assert.equal((await c.get("/api/workspace/planning")).status(), 200);
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(subscription.status);
  }
  const g = await post(c, "goals", {
    title: "QA measurable goal",
    category: "Financial",
    successMetric: "Save PKR 100000",
    targetDate: "2027-12-31",
  });
  plans.push(["goals", g.id]);
  const p = await post(c, "projects", {
    title: "QA goal project",
    category: "Work",
    goalId: g.id,
    targetDate: "2027-09-30",
  });
  plans.push(["projects", p.id]);
  assert.equal(
    (await d.prepare("SELECT goal_id FROM projects WHERE id=?").get(p.id))
      .goal_id,
    g.id,
  );
  assert.equal(
    (
      await foreign.post("/api/workspace/projects", {
        data: { title: "Foreign link", goalId: g.id },
      })
    ).status(),
    404,
  );
});
test("web calendar edits a deadline and routine interface shares the weekly report", async () => {
  const c = await ctx("ayesha"),
    browser = await chromium.launch(),
    context = await browser.newContext();
  await context.addCookies((await c.storageState()).cookies);
  const page = await context.newPage();
  try {
    await page.goto(base + "/workspace/progress");
    await page.getByRole("button", { name: "Calendar", exact: true }).waitFor();
    await page
      .locator('.planning-controls input[type="month"]')
      .fill("2027-12");
    await page
      .getByRole("button", { name: "Calendar 2027-12-31", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit plan", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit calendar plan" });
    await editor.getByLabel("Deadline", { exact: true }).fill("2028-01-15");
    await editor
      .getByRole("button", { name: "Save calendar plan", exact: true })
      .click();
    await page
      .getByText("Plan and deadline saved on all devices.", { exact: true })
      .waitFor();
    assert.equal(
      (
        await d
          .prepare("SELECT target_date FROM goals WHERE id=?")
          .get(plans.find(([k]) => k === "goals")[1])
      ).target_date,
      "2028-01-15",
    );
    await page
      .getByRole("button", { name: "Routines & operations", exact: true })
      .click();
    await page
      .getByRole("heading", { name: /Weekly routine review/ })
      .waitFor();
    await page
      .getByRole("button", { name: "Add routine", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("UI routine preview");
    await page
      .getByRole("combobox", { name: "Routine kind", exact: true })
      .last()
      .selectOption("subscription");
    assert.equal(
      await page.getByLabel("Routine frequency", { exact: true }).inputValue(),
      "monthly",
    );
    await page
      .getByLabel("Routine frequency", { exact: true })
      .selectOption("yearly");
    assert.equal(
      await page.getByLabel("Routine frequency", { exact: true }).inputValue(),
      "yearly",
    );
  } finally {
    await context.close();
    await browser.close();
  }
});

test("expected profit and avoided-loss estimates preserve currency and never post real payments", async () => {
  const c = await ctx("ayesha"),
    before = (await d.prepare("SELECT count(*) AS n FROM payments").get()).n;
  const v = await post(c, "tasks", {
    title: "QA estimate task",
    important: false,
    urgent: false,
    valueType: "profit",
    valueAmount: "12500.25",
    valueCurrency: "pkr",
    valueNote: "Potential commission",
  });
  try {
    let t = await d.prepare("SELECT * FROM tasks WHERE id=?").get(v.id);
    assert.equal(t.value_minor, 1250025);
    assert.equal(t.value_currency, "PKR");
    assert.equal(
      (
        await c.patch("/api/workspace/tasks/" + v.id, {
          data: {
            stage: t.stage,
            revision: t.revision,
            valueType: "avoid_loss",
            valueAmount: "75000",
            valueCurrency: "USD",
          },
        })
      ).status(),
      200,
    );
    t = await d.prepare("SELECT * FROM tasks WHERE id=?").get(v.id);
    assert.equal(t.value_type, "avoid_loss");
    assert.equal(t.value_minor, 7500000);
    assert.equal(
      (
        await c.patch("/api/workspace/tasks/" + v.id, {
          data: { stage: "Done", revision: t.revision },
        })
      ).status(),
      200,
    );
    t = await d.prepare("SELECT * FROM tasks WHERE id=?").get(v.id);
    assert.equal(t.value_minor, 7500000);
    assert.equal(
      (await d.prepare("SELECT count(*) AS n FROM payments").get()).n,
      before,
    );
    assert.equal(
      (
        await c.post("/api/workspace/tasks", {
          data: {
            title: "Bad amount",
            important: false,
            urgent: false,
            valueType: "profit",
            valueAmount: "1.999",
          },
        })
      ).status(),
      400,
    );
  } finally {
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(v.id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(v.id);
  }
});
test("reviewed wording rotates per operations occurrence while canonical identity and previous names stay immutable", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    today = localDay(new Date(), "UTC"),
    tomorrow = nextDay(today, "daily");
  const r = await post(c, "planning", {
    action: "routine",
    title: "Review 5 pending enquiries",
    kind: "operations",
    frequency: "daily",
    firstDay: tomorrow,
    time: "09:00",
    timezone: "UTC",
  });
  series.push(r.id);
  const approve = {
    action: "wording-approve",
    id: r.id,
    revision: 0,
    canonicalTitle: "Review 5 pending enquiries",
    variants: [
      "Check 5 pending enquiries",
      "Review the 5 enquiries still pending",
    ],
    reviewed: true,
  };
  assert.equal(
    (await other.post("/api/workspace/planning", { data: approve })).status(),
    404,
  );
  assert.equal(
    (
      await c.post("/api/workspace/planning", {
        data: {
          ...approve,
          variants: ["Check 10 pending enquiries", "Check pending enquiries"],
        },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await c.post("/api/workspace/planning", {
        data: { ...approve, reviewed: false },
      })
    ).status(),
    400,
  );
  await post(c, "planning", approve);
  for (const offset of [0, 1])
    await runTaskScheduler({
      d,
      heartbeat: false,
      routineOnly: true,
      tenantId: "northstar",
      userId: "ayesha",
      now: new Date(nextDay(tomorrow, "daily", offset) + "T12:00:00Z"),
    });
  const occurrences = await d
    .prepare("SELECT * FROM task_occurrences WHERE series_id=? ORDER BY day")
    .all(r.id);
  assert.equal(occurrences.length, 2);
  assert.notEqual(occurrences[0].display_title, occurrences[1].display_title);
  assert.equal(occurrences[0].canonical_title, approve.canonicalTitle);
  for (const o of occurrences) {
    assert.equal(
      (await d.prepare("SELECT title FROM tasks WHERE id=?").get(o.task_id))
        .title,
      approve.canonicalTitle,
    );
  }
  const snapshot = occurrences[0].display_title;
  await post(c, "planning", {
    action: "wording-state",
    id: r.id,
    revision: 1,
    enabled: false,
  });
  assert.equal(
    (
      await d
        .prepare(
          "SELECT display_title FROM task_occurrences WHERE series_id=? AND day=?",
        )
        .get(r.id, tomorrow)
    ).display_title,
    snapshot,
  );
  const boot = await (await c.get("/api/mobile")).json();
  assert.equal(
    boot.tasks.find((t) => t.id === occurrences[0].task_id).display_title,
    snapshot,
  );
  const t = await d
    .prepare("SELECT revision FROM tasks WHERE id=?")
    .get(occurrences[0].task_id);
  assert.equal(
    (
      await c.patch("/api/workspace/tasks/" + occurrences[0].task_id, {
        data: {
          title: "A manually changed task",
          stage: "To do",
          revision: t.revision,
        },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await (await c.get("/api/mobile")).json()).tasks.find(
      (t) => t.id === occurrences[0].task_id,
    ).display_title,
    "",
  );
  assert.equal(
    (
      await c.post("/api/workspace/planning", {
        data: { action: "wording-generate", id: r.id },
      })
    ).status(),
    503,
  );
});

test("paused operations days are skipped on resume rather than counted as missed", async () => {
  const c = await ctx("ayesha"),
    today = localDay(new Date(), "UTC"),
    r = await post(c, "planning", {
      action: "routine",
      title: "QA paused operations",
      kind: "operations",
      frequency: "daily",
      firstDay: nextDay(today, "daily"),
      time: "09:00",
      timezone: "UTC",
    });
  series.push(r.id);
  const past = nextDay(today, "daily", -2);
  await d
    .prepare(
      "UPDATE task_recurrences SET status='paused',next_day=? WHERE id=?",
    )
    .run(past, r.id);
  await post(c, "scheduling", {
    action: "series-state",
    id: r.id,
    revision: 1,
    status: "active",
  });
  const rows = await d
    .prepare("SELECT disposition FROM task_occurrences WHERE series_id=?")
    .all(r.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.disposition === "skipped"));
});
test("web wording review explicitly enables rotation and cards keep their original name visible", async () => {
  const c = await ctx("ayesha"),
    browser = await chromium.launch(),
    context = await browser.newContext();
  await context.addCookies((await c.storageState()).cookies);
  const page = await context.newPage();
  try {
    await page.goto(base + "/workspace/progress");
    await page
      .getByRole("button", { name: "Routines & operations", exact: true })
      .click();
    const wording = page
      .locator(".routine-wording")
      .filter({ hasText: "Review 5 pending enquiries" });
    await wording.locator("summary").click();
    await wording
      .locator("textarea")
      .fill(
        "Check the 5 pending enquiries\nReview the 5 enquiries still pending",
      );
    await wording.getByRole("checkbox").check();
    await wording
      .getByRole("button", { name: "Approve wording rotation", exact: true })
      .click();
    await wording
      .getByText(
        "Approved. Future occurrences rotate these wordings; previous names remain in history.",
        { exact: true },
      )
      .waitFor();
    await page.goto(base + "/workspace/tasks");
    const card = page.getByRole("button", {
      name: "Open task: Review 5 pending enquiries",
      exact: true,
    });
    await card.waitFor();
    assert.ok(
      (await card.innerText()).includes("Original: Review 5 pending enquiries"),
    );
  } finally {
    await context.close();
    await browser.close();
  }
});
