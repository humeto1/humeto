import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  ids = [];
const endpoint = "/api/journey-insights";
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
async function lead(c) {
  const r = await c.post("/api/workspace/leads", {
    data: {
      name: "Journey QA " + randomUUID().slice(0, 6),
      email: randomUUID() + "@example.com",
      expected_fee: 100000,
      upfront_fee: 25000,
      incentive: 15000,
      destination: "Canada",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  ids.push(id);
  return id;
}
const read = async (c) => (await c.get(endpoint)).json();
const save = (c, row, extra = {}) =>
  c.post(endpoint, {
    data: {
      kind: row.kind,
      id: row.id,
      entityRevision: row.revision,
      revision: row.deadline.revision,
      dueDate: "2026-01-05",
      timezone: "Asia/Karachi",
      label: "Send required documents",
      ...extra,
    },
  });
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const id of ids) {
    await d.prepare("DELETE FROM journey_deadlines WHERE entity_id=?").run(id);
    await d
      .prepare("DELETE FROM journey_stage_visits WHERE entity_id=?")
      .run(id);
    await d.prepare("DELETE FROM leads WHERE id=?").run(id);
  }
  await d.close();
});
test("journey observations record actual transitions without inventing baseline durations", async () => {
  const c = await ctx("ayesha"),
    id = await lead(c);
  let data = await read(c),
    row = data.records.find((r) => r.id === id);
  assert.equal(row.baseline, false);
  assert.equal(row.stage, "New");
  assert.ok(row.observedDays >= 0);
  assert.equal(row.fee, 100000);
  assert.equal(row.contingentIncentive, 15000);
  const d = database();
  await d
    .prepare(
      "UPDATE journey_stage_visits SET entered_at=now()-interval '2 days' WHERE entity_id=? AND exited_at IS NULL",
    )
    .run(id);
  const moved = await c.patch("/api/workspace/leads/" + id, {
    data: { stage: "Qualified", revision: row.revision },
  });
  assert.equal(moved.status(), 200, await moved.text());
  data = await read(c);
  row = data.records.find((r) => r.id === id);
  assert.equal(row.stage, "Qualified");
  assert.ok(row.observedDays < 0.01);
  const metric = data.metrics.find(
    (m) => m.kind === "leads" && m.stage === "New",
  );
  assert.ok(metric.visits >= 1);
  assert.ok(metric.averageDays > 0);
  const visits = await d
    .prepare("SELECT * FROM journey_stage_visits WHERE entity_id=? ORDER BY id")
    .all(id);
  assert.equal(visits.length, 2);
  assert.ok(visits[0].exited_at);
  assert.equal(visits[1].exited_at, null);
  await d
    .prepare("UPDATE leads SET notes=? WHERE id=?")
    .run("Unrelated edit", id);
  assert.equal(
    (
      await d
        .prepare(
          "SELECT count(*)::int AS n FROM journey_stage_visits WHERE entity_id=?",
        )
        .get(id)
    ).n,
    2,
  );
  const baselineId = await lead(c);
  await d
    .prepare(
      "UPDATE journey_stage_visits SET baseline=TRUE,entered_at=now()-interval '100 days' WHERE entity_id=?",
    )
    .run(baselineId);
  let baseline = (await read(c)).records.find((r) => r.id === baselineId);
  assert.equal(baseline.baseline, true);
  assert.ok(baseline.observedDays >= 100);
  assert.equal(
    (
      await c.patch("/api/workspace/leads/" + baselineId, {
        data: { stage: "Qualified", revision: baseline.revision },
      })
    ).status(),
    200,
  );
  const afterBaseline = (await read(c)).metrics.find(
    (m) => m.kind === "leads" && m.stage === "New",
  );
  assert.equal(afterBaseline.visits, metric.visits);
});
test("journey deadlines are revision-checked, timezone-aware and independent for each journey", async () => {
  const c = await ctx("ayesha"),
    id = await lead(c);
  let row = (await read(c)).records.find((r) => r.id === id);
  assert.equal((await save(c, row, { dueDate: "2026-02-30" })).status(), 400);
  assert.equal((await save(c, row, { timezone: "wrong/zone" })).status(), 400);
  const attempts = await Promise.all([save(c, row), save(c, row)]);
  assert.deepEqual(attempts.map((r) => r.status()).sort(), [200, 409]);
  row = (await read(c)).records.find((r) => r.id === id);
  assert.equal(row.deadline.dueDate, "2026-01-05");
  assert.ok(row.daysUntil < 0);
  const current = row;
  assert.equal(
    (await save(c, current, { entityRevision: current.revision + 1 })).status(),
    409,
  );
  assert.equal((await save(c, row, { dueDate: "", label: "" })).status(), 200);
  row = (await read(c)).records.find((r) => r.id === id);
  assert.equal(row.daysUntil, null);
  assert.equal(row.deadline.dueDate, "");
  assert.ok(row.deadline.revision > current.deadline.revision);
  const data = await read(c),
    app = data.records.find((r) => r.kind === "applications");
  assert.equal(app.fee, null);
  assert.equal(app.paid, null);
});
test("journey reports and deadline edits enforce tenant, role, origin and subscription boundaries", async () => {
  const c = await ctx("ayesha"),
    foreign = await ctx("bright-owner"),
    student = await ctx("amira"),
    admin = await ctx("admin"),
    id = await lead(c),
    row = (await read(c)).records.find((r) => r.id === id);
  assert.ok(!(await read(foreign)).records.some((r) => r.id === id));
  assert.equal((await save(foreign, row)).status(), 404);
  for (const f of [student, admin]) {
    assert.equal((await f.get(endpoint)).status(), 403);
    assert.equal((await save(f, row)).status(), 403);
  }
  assert.equal(
    (
      await c.post(endpoint, {
        headers: { Origin: "https://foreign.example" },
        data: {},
      })
    ).status(),
    403,
  );
  const d = database(),
    before = await d
      .prepare("SELECT status FROM subscriptions WHERE tenant_id='northstar'")
      .get();
  try {
    await d
      .prepare(
        "UPDATE subscriptions SET status='read_only' WHERE tenant_id='northstar'",
      )
      .run();
    assert.equal((await c.get(endpoint)).status(), 200);
    assert.equal((await save(c, row)).status(), 403);
  } finally {
    await d
      .prepare("UPDATE subscriptions SET status=? WHERE tenant_id='northstar'")
      .run(before.status);
  }
});
test("journey insights UI saves a deadline, filters overdue work and fits narrow screens", async () => {
  const c = await ctx("ayesha"),
    id = await lead(c),
    row = (await read(c)).records.find((r) => r.id === id);
  assert.equal((await save(c, row)).status(), 200);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    assert.equal(
      (
        await page.request.post(base + "/api/auth/demo", {
          headers: { Origin: base },
          data: { userId: "ayesha" },
        })
      ).status(),
      200,
    );
    await page.goto(base + "/workspace/insights");
    await page
      .getByRole("heading", { name: "See what needs attention." })
      .waitFor();
    await page.getByLabel("Journey", { exact: true }).selectOption("leads");
    await page.getByLabel("Find a case", { exact: true }).fill(row.name);
    await page.getByLabel("Only overdue deadlines", { exact: true }).check();
    await page.getByRole("heading", { name: row.name, exact: true }).waitFor();
    await page.getByText("Edit deadline", { exact: true }).click();
    await page
      .getByLabel("Deadline label", { exact: true })
      .fill("QA review documents by deadline");
    await page
      .getByRole("button", { name: "Save deadline", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Deadline saved." })
      .waitFor();
    await page.screenshot({
      path: "artifacts/journey-insights.jpg",
      fullPage: true,
    });
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
