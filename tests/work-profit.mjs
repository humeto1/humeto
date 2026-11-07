import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { database } from "../src/lib/postgres.mjs";
const d = database(),
  base = process.env.HUMETO_TEST_URL;
after(() => d.close());
const ok = async (r) => {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
};
async function ctx(user = "ayesha") {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  await ok(await c.post("/api/auth/demo", { data: { userId: user } }));
  return c;
}
let p, g, t, session;
test("actual receipts and focus hours roll up once across task, project and goal without doubling estimates", async () => {
  const c = await ctx(),
    foreign = await ctx("bright-owner");
  try {
    const oldFocus = (await ok(await c.get("/api/workspace/focus"))).active;
    if (oldFocus)
      await ok(
        await c.post("/api/workspace/focus", {
          data: {
            action: "stop",
            sessionId: oldFocus.id,
            revision: oldFocus.revision,
            taskRevision: oldFocus.task_revision,
          },
        }),
      );
    g = (
      await ok(
        await c.post("/api/workspace/goals", {
          data: {
            title: "Profit audit goal",
            targetDate: "2027-12-31",
            status: "Active",
          },
        }),
      )
    ).id;
    p = (
      await ok(
        await c.post("/api/workspace/projects", {
          data: {
            title: "Profit audit project",
            targetDate: "2027-12-31",
            status: "Active",
            goalId: g,
          },
        }),
      )
    ).id;
    t = (
      await ok(
        await c.post("/api/workspace/tasks", {
          data: {
            title: "Visa receipt audit",
            projectId: p,
            goalIds: [g],
            valueType: "profit",
            valueAmount: "50000",
            valueCurrency: "PKR",
            important: false,
            urgent: false,
          },
        }),
      )
    ).id;
    await d
      .prepare(
        "INSERT INTO plan_financial_targets(tenant_id,entity_type,entity_id,currency,completion,basis) VALUES('northstar','project',?,'PKR',10000000,'project')",
      )
      .run(p);
    session = (
      await ok(
        await c.post("/api/workspace/focus", {
          data: { action: "start", taskId: t, taskRevision: 1, minutes: 30 },
        }),
      )
    ).id;
    const row = await d
      .prepare("SELECT id FROM focus_work_intervals WHERE session_id=?")
      .get(session);
    await d
      .prepare(
        "UPDATE focus_work_intervals SET started_at=now()-interval '1 hour' WHERE id=?",
      )
      .run(row.id);
    const active = (await ok(await c.get("/api/workspace/focus"))).active;
    await ok(
      await c.post("/api/workspace/focus", {
        data: {
          action: "pause",
          sessionId: session,
          revision: active.revision,
          taskRevision: active.task_revision,
        },
      }),
    );
    const receipt = {
      id: randomUUID(),
      taskId: t,
      sessionId: session,
      amount: "20000",
      currency: "PKR",
      day: new Date().toISOString().slice(0, 10),
      note: "First payment",
    };
    await ok(await c.post("/api/work-profit", { data: receipt }));
    await ok(await c.post("/api/work-profit", { data: receipt }));
    await ok(
      await c.post("/api/work-profit", {
        data: { ...receipt, id: randomUUID(), amount: "30000" },
      }),
    );
    for (const [type, id, estimate] of [
      ["task", t, 5000000],
      ["project", p, 10000000],
      ["goal", g, 10000000],
    ]) {
      const s = await ok(await c.get(`/api/work-profit?type=${type}&id=${id}`));
      assert.equal(s.actual[0].amount, 5000000);
      assert.equal(s.estimated[0].amount, estimate);
      assert.ok(s.focusSeconds >= 3599 && s.focusSeconds < 3610);
    }
    assert.equal(
      (await foreign.get(`/api/work-profit?type=task&id=${t}`)).status(),
      404,
    );
    assert.equal(
      (
        await foreign.post("/api/work-profit", {
          data: { ...receipt, id: randomUUID() },
        })
      ).status(),
      400,
    );
    await ok(
      await c.post("/api/work-profit", {
        data: { ...receipt, id: randomUUID(), currency: "USD", amount: "10" },
      }),
    );
    const s = await ok(await c.get(`/api/work-profit?type=goal&id=${g}`));
    assert.equal(s.actual.length, 2);
    assert.equal(
      (
        await c.post("/api/work-profit", { data: { ...receipt, amount: "9" } })
      ).status(),
      400,
    );
  } finally {
    await c.dispose();
    await foreign.dispose();
  }
});
test("focus attendance confirms working or pauses at 30 minute cutoff without completing task", async () => {
  const c = await ctx();
  try {
    let active = (await ok(await c.get("/api/workspace/focus"))).active;
    await ok(
      await c.post("/api/workspace/focus", {
        data: {
          action: "resume",
          sessionId: active.id,
          revision: active.revision,
          taskRevision: active.task_revision,
          minutes: 30,
        },
      }),
    );
    await d
      .prepare(
        "UPDATE focus_sessions SET attendance_due_at=now()-interval '10 seconds',running_since=now()-interval '30 minutes 10 seconds' WHERE id=?",
      )
      .run(session);
    active = (await ok(await c.get("/api/workspace/focus"))).active;
    assert.ok(active.attendance_prompt_at);
    assert.equal(active.state, "running");
    await ok(
      await c.post("/api/workspace/focus", {
        data: {
          action: "confirm",
          sessionId: active.id,
          revision: active.revision,
          taskRevision: active.task_revision,
        },
      }),
    );
    active = (await ok(await c.get("/api/workspace/focus"))).active;
    assert.equal(active.attendance_prompt_at, null);
    assert.ok(Date.parse(active.attendance_due_at) > Date.now() + 1790000);
    await d
      .prepare(
        "UPDATE focus_sessions SET attendance_due_at=now()-interval '90 seconds',running_since=now()-interval '31 minutes 30 seconds' WHERE id=?",
      )
      .run(session);
    await d
      .prepare(
        "UPDATE focus_work_intervals SET started_at=(SELECT running_since FROM focus_sessions WHERE id=?) WHERE session_id=? AND ended_at IS NULL",
      )
      .run(session, session);
    const openInterval = await d.prepare("SELECT id FROM focus_work_intervals WHERE session_id=? AND ended_at IS NULL").get(session);
    const cutoff = (
      await d
        .prepare("SELECT attendance_due_at FROM focus_sessions WHERE id=?")
        .get(session)
    ).attendance_due_at;
    active = (await ok(await c.get("/api/workspace/focus"))).active;
    assert.equal(active.state, "paused");
    const interval = await d
      .prepare(
        "SELECT ended_at FROM focus_work_intervals WHERE id=?",
      )
      .get(openInterval.id);
    assert.equal(
      new Date(interval.ended_at).getTime(),
      new Date(cutoff).getTime(),
      "The response grace minute is excluded from focus hours",
    );
    assert.equal(active.task_stage, "In progress");
    assert.equal(active.running_since, null);
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
  } finally {
    await c.dispose();
  }
});
test("profit receipt form is available after focus work and totals render on map root", async () => {
  const browser = await chromium.launch();
  try {
    const c = await browser.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
      viewport: { width: 393, height: 852 },
    });
    await ok(
      await c.request.post("/api/auth/demo", { data: { userId: "ayesha" } }),
    );
    const page = await c.newPage();
    await page.goto("/workspace/tasks");
    await page.evaluate(
      ({ taskId, sessionId }) =>
        window.dispatchEvent(
          new CustomEvent("humeto-profit-prompt", {
            detail: { taskId, sessionId },
          }),
        ),
      { taskId: t, sessionId: session },
    );
    const form = page.getByRole("dialog", {
      name: "Actual profit received",
      exact: true,
    });
    await form.getByLabel("Amount received", { exact: true }).fill("100");
    await form
      .getByRole("button", { name: "Record received amount", exact: true })
      .click();
    await form.waitFor({ state: "hidden" });
    await page.goto("/workspace/progress");
    const card = page.locator(".workstream-card").filter({
      has: page.getByRole("heading", {
        name: "Profit audit project",
        exact: true,
      }),
    });
    await card.getByRole("button", { name: /Project map/ }).click();
    const map = page.getByRole("dialog").first();
    await map
      .locator(".wbs-root .work-totals")
      .getByText("Actual profit", { exact: true })
      .waitFor();
    await map
      .locator(".wbs-root .work-totals")
      .getByText(/PKR 50,100/)
      .waitFor();
    mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/compact-map-profit.png" });
    assert.ok(
      (await map
        .locator(".wbs-header")
        .evaluate((el) => el.getBoundingClientRect().height)) < 80,
    );
    await c.close();
  } finally {
    await browser.close();
  }
});
