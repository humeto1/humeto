import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("plan targets split upfront, completion and conditional rewards without posting accounts; teams inherit with explicit task overrides", async () => {
  const d = database(),
    c = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    }),
    pid = randomUUID(),
    gid = randomUUID(),
    tid = randomUUID();
  try {
    assert.equal(
      (await c.post("/api/auth/demo", { data: { userId: "ayesha" } })).status(),
      200,
    );
    await d
      .prepare(
        "INSERT INTO goals(id,tenant_id,title,created_by) VALUES(?,?,?,?)",
      )
      .run(gid, "northstar", "QA outcome", "ayesha");
    await d
      .prepare(
        "INSERT INTO projects(id,tenant_id,title,created_by,goal_id) VALUES(?,?,?,?,?)",
      )
      .run(pid, "northstar", "QA delivery", "ayesha", gid);
    await d
      .prepare(
        "INSERT INTO tasks(id,tenant_id,title,project_id) VALUES(?,?,?,?)",
      )
      .run(tid, "northstar", "QA contribution", pid);
    const target = {
      revision: 0,
      currency: "PKR",
      upfront: "25000",
      completion: "100000",
      conditional: "500000",
      upfront_date: "2026-10-24",
      completion_date: "2026-12-01",
      conditional_date: "2027-01-01",
      condition: "University confirms enrolment",
      basis: "project",
    };
    const ledgerBefore = (
      await d
        .prepare(
          "SELECT count(*)::int AS n FROM finance_entries WHERE tenant_id=?",
        )
        .get("northstar")
    ).n;
    const path = `/api/plan-targets?type=project&id=${pid}`;
    let r = await c.post(path, { data: target });
    assert.equal(r.status(), 200, await r.text());
    const saved = await (await c.get(path)).json();
    assert.equal(saved.target.upfront, 2500000);
    assert.equal(saved.target.conditional, 50000000);
    assert.equal(
      (
        await d
          .prepare(
            "SELECT count(*)::int AS n FROM finance_entries WHERE tenant_id=?",
          )
          .get("northstar")
      ).n,
      ledgerBefore,
    );
    const taskState = await (await c.get("/api/mobile")).json();
    assert.equal(
      taskState.tasks.find((t) => t.id === tid).project_target_conditional,
      50000000,
    );
    assert.equal((await c.post(path, { data: target })).status(), 409);
    assert.equal(
      (
        await c.post(path, { data: { ...target, revision: 1, condition: "" } })
      ).status(),
      400,
    );
    assert.equal(
      (
        await c.post(path, { data: { ...target, revision: 1, upfront: "-1" } })
      ).status(),
      400,
    );
    const assign = async (type, id, userIds, revision = 0, inherit = false) =>
      c.post("/api/workspace/assignments", {
        data: { type, id, userIds, revision, inherit },
      });
    assert.equal((await assign("project", pid, ["ayesha"])).status(), 200);
    assert.equal((await assign("goal", gid, ["consultant"])).status(), 200);
    const get = async () =>
      (await c.get(`/api/workspace/assignments?type=task&id=${tid}`)).json();
    let team = await get();
    assert.equal(team.inherits, true);
    assert.deepEqual(team.effectiveUserIds.sort(), ["ayesha", "consultant"]);
    assert.equal((await assign("task", tid, ["consultant"])).status(), 200);
    team = await get();
    assert.equal(team.inherits, false);
    assert.deepEqual(team.effectiveUserIds, ["consultant"]);
    assert.equal(
      (await assign("task", tid, [], team.revision, true)).status(),
      200,
    );
    team = await get();
    assert.equal(team.inherits, true);
    assert.equal(team.effectiveUserIds.length, 2);
    assert.equal(
      (await assign("project", pid, ["bright-owner"], 1)).status(),
      400,
    );
    assert.equal(
      (
        await c.post(`/api/task-links?taskId=${tid}`, {
          data: { label: "Drive folder", url: "https://drive.google.com/test" },
        })
      ).status(),
      200,
    );
    assert.equal(
      (await (await c.get(`/api/task-links?taskId=${tid}`)).json()).links
        .length,
      1,
    );
  } finally {
    for (const id of [tid, pid, gid]) {
      await d.prepare("DELETE FROM work_assignments WHERE entity_id=?").run(id);
      await d
        .prepare("DELETE FROM assignment_revisions WHERE entity_id=?")
        .run(id);
      await d
        .prepare("DELETE FROM plan_financial_targets WHERE entity_id=?")
        .run(id);
    }
    await d.prepare("DELETE FROM tasks WHERE id=?").run(tid);
    await d.prepare("DELETE FROM projects WHERE id=?").run(pid);
    await d.prepare("DELETE FROM goals WHERE id=?").run(gid);
    await c.dispose();
    await d.close();
  }
});
