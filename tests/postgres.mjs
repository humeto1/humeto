import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "playwright";
import { database, parameters } from "../src/lib/postgres.mjs";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
const d = database(),
  contexts = [],
  people = [],
  tasks = [],
  projects = [];
async function owner() {
  const c = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(c);
  assert.equal(
    (await c.post("/api/auth/demo", { data: { userId: "ayesha" } })).status(),
    200,
  );
  return c;
}
async function ok(r) {
  assert.equal(r.status(), 200, await r.text());
  return r.json();
}
after(async () => {
  for (const c of contexts) await c.dispose();
  for (const id of tasks) {
    await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM task_goals WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(id);
  }
  for (const id of people) {
    await d.prepare("DELETE FROM payments WHERE person_id=?").run(id);
    await d.prepare("DELETE FROM case_finance WHERE person_id=?").run(id);
    await d.prepare("DELETE FROM intake WHERE person_id=?").run(id);
    await d.prepare("DELETE FROM people WHERE id=?").run(id);
    await d.prepare("DELETE FROM audit WHERE entity_id=?").run(id);
  }
  for (const id of projects)
    await d.prepare("DELETE FROM projects WHERE id=?").run(id);
  await d.close();
});
test("PostgreSQL is the actual database and supports safe parameter compilation", async () => {
  assert.match(
    (await d.query("SELECT version() AS version")).rows[0].version,
    /PostgreSQL/,
  );
  assert.equal(
    (await d.query("SELECT count(*) AS n FROM schema_migrations")).rows[0].n,
    2,
  );
  assert.equal(
    parameters(
      `SELECT '?' AS literal, "?" AS identifier WHERE id=? AND email=?`,
    ),
    `SELECT '?' AS literal, "?" AS identifier WHERE id=$1 AND email=$2`,
  );
});
test("pooled transactions keep their connection and roll back independently under concurrency", async () => {
  const ids = [randomUUID(), randomUUID()];
  projects.push(...ids);
  let joined = 0,
    release;
  const barrier = new Promise((r) => (release = r));
  const outcomes = await Promise.allSettled(
    ids.map((id, index) =>
      d.transaction(async () => {
        const before = (await d.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        await d
          .prepare(
            "INSERT INTO projects(id,tenant_id,title,created_by) VALUES(?,'northstar','PG transaction isolation QA','ayesha')",
          )
          .run(id);
        if (++joined === 2) release();
        await barrier;
        const after = (await d.query("SELECT pg_backend_pid() AS pid")).rows[0]
          .pid;
        assert.equal(before, after);
        if (index === 0) throw new Error("Intentional rollback");
        return before;
      }),
    ),
  );
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal(
    await d.prepare("SELECT id FROM projects WHERE id=?").get(ids[0]),
    undefined,
  );
  assert.ok(await d.prepare("SELECT id FROM projects WHERE id=?").get(ids[1]));
});
test("simultaneous task edits preserve optimistic revisions and produce one stage event", async () => {
  const c = await owner();
  const { id } = await ok(
    await c.post("/api/workspace/tasks", {
      data: {
        title: "PG concurrency QA " + randomUUID(),
        important: true,
        urgent: false,
        assignee: "Ayesha Khan",
      },
    }),
  );
  tasks.push(id);
  const responses = await Promise.all(
    ["Review", "Done"].map((stage) =>
      c.patch("/api/workspace/tasks/" + id, { data: { stage, revision: 1 } }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409]);
  const t = await d
    .prepare("SELECT stage,revision FROM tasks WHERE id=?")
    .get(id);
  assert.equal(t.revision, 2);
  const events = await d
    .prepare("SELECT * FROM task_events WHERE task_id=? AND event!='created'")
    .all(id);
  assert.equal(events.length, 1);
  assert.equal(events[0].to_stage, t.stage);
});
test("simultaneous payment retries record one receipt and one amount", async () => {
  const c = await owner();
  const p = await ok(
    await c.post("/api/workspace/students", {
      data: {
        name: "PG Receipt QA",
        email: "pg-" + randomUUID() + "@example.com",
      },
    }),
  );
  people.push(p.id);
  await ok(
    await c.patch("/api/workspace/case-finance/" + p.id, {
      data: {
        revision: 0,
        expected_fee: 100000,
        upfront_fee: 50000,
        incentive: 0,
        timeline: "",
      },
    }),
  );
  const data = {
    amount: 25000,
    reference: "PG duplicate retry",
    clientKey: randomUUID(),
  };
  const responses = await Promise.all([
    c.post("/api/workspace/case-finance/" + p.id + "/payment", { data }),
    c.post("/api/workspace/case-finance/" + p.id + "/payment", { data }),
  ]);
  for (const r of responses) await ok(r);
  const aggregate = await d
    .prepare(
      "SELECT count(*) AS n,sum(amount) AS amount FROM payments WHERE person_id=?",
    )
    .get(p.id);
  assert.equal(aggregate.n, 1);
  assert.equal(aggregate.amount, 25000);
});

test("concurrent fee agreement edits cannot overwrite the same revision", async () => {
  const c = await owner();
  const p = await ok(
    await c.post("/api/workspace/students", {
      data: {
        name: "PG Agreement QA",
        email: "pg-fees-" + randomUUID() + "@example.com",
      },
    }),
  );
  people.push(p.id);
  const agreement = {
    revision: 0,
    expected_fee: 100000,
    upfront_fee: 50000,
    incentive: 0,
    timeline: "",
  };
  await ok(
    await c.patch("/api/workspace/case-finance/" + p.id, { data: agreement }),
  );
  const edits = await Promise.all(
    [110000, 120000].map((expected_fee) =>
      c.patch("/api/workspace/case-finance/" + p.id, {
        data: { ...agreement, revision: 1, expected_fee },
      }),
    ),
  );
  assert.deepEqual(edits.map((r) => r.status()).sort(), [200, 409]);
  assert.equal(
    (
      await d
        .prepare("SELECT revision FROM case_finance WHERE person_id=?")
        .get(p.id)
    ).revision,
    2,
  );
});
test("concurrent staff invites respect the final available seat", async () => {
  const c = await owner();
  const subscription = await d
    .prepare("SELECT seats FROM subscriptions WHERE tenant_id='northstar'")
    .get();
  const used = await d
    .prepare(
      "SELECT count(*) n FROM memberships WHERE tenant_id='northstar' AND role IN ('owner','consultant')",
    )
    .get();
  const emails = [0, 1].map(() => "pg-seat-" + randomUUID() + "@example.com");
  try {
    await d
      .prepare("UPDATE subscriptions SET seats=? WHERE tenant_id='northstar'")
      .run(used.n + 1);
    const responses = await Promise.all(
      emails.map((email) =>
        c.post("/api/workspace/team", {
          data: {
            name: "PG Seat QA",
            email,
            password: randomUUID() + "-qa",
            role: "consultant",
          },
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 403]);
  } finally {
    await d
      .prepare("UPDATE subscriptions SET seats=? WHERE tenant_id='northstar'")
      .run(subscription.seats);
    for (const email of emails) {
      const u = await d
        .prepare("SELECT id FROM users WHERE email=?")
        .get(email);
      if (u) {
        await d.prepare("DELETE FROM memberships WHERE user_id=?").run(u.id);
        await d.prepare("DELETE FROM audit WHERE entity_id=?").run(u.id);
        await d.prepare("DELETE FROM users WHERE id=?").run(u.id);
      }
    }
  }
});
