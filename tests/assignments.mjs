import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174",
  contexts = [],
  tasks = [];
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
after(async () => {
  for (const c of contexts) await c.dispose();
  const d = database();
  for (const id of tasks) {
    await d
      .prepare(
        "DELETE FROM work_assignments WHERE entity_type='task' AND entity_id=?",
      )
      .run(id);
    await d
      .prepare(
        "DELETE FROM assignment_revisions WHERE entity_type='task' AND entity_id=?",
      )
      .run(id);
    await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
    await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  await d.close();
});
test("multiple staff can own work, with stale, student and cross-tenant assignment guards", async () => {
  const c = await ctx("ayesha"),
    other = await ctx("bright-owner"),
    student = await ctx("amira");
  let r = await c.post("/api/workspace/tasks", {
    data: {
      title: "Assignment QA " + randomUUID(),
      important: false,
      urgent: false,
      dueDate: "",
      assignee: "",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  const { id } = await r.json();
  tasks.push(id);
  const path = "/api/workspace/assignments";
  const send = (client, userIds, revision) =>
    client.post(path, { data: { type: "task", id, userIds, revision } });
  r = await send(c, ["ayesha", "consultant"], 0);
  assert.equal(r.status(), 200, await r.text());
  let data = await (await c.get(path + "?type=task&id=" + id)).json();
  assert.equal(data.userIds.length, 2);
  assert.equal((await send(c, [], 0)).status(), 409);
  assert.equal((await send(c, ["bright-owner"], data.revision)).status(), 400);
  assert.equal((await send(other, [], 0)).status(), 404);
  assert.equal((await send(student, [], 0)).status(), 403);
  assert.equal((await send(c, [], data.revision)).status(), 200);
});
