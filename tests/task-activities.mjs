import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "playwright";
import { database } from "../src/lib/postgres.mjs";
import { randomUUID } from "node:crypto";
const base = process.env.HUMETO_TEST_URL || "http://localhost:4174";
test("background activities run alongside a private focus session, schedule updates and never complete work automatically", async () => {
  const d = database(),
    ids = [randomUUID(), randomUUID()],
    c = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    }),
    other = await request.newContext({
      baseURL: base,
      extraHTTPHeaders: { Origin: base },
    });
  try {
    await c.post("/api/auth/demo", { data: { userId: "ayesha" } });
    await other.post("/api/auth/demo", { data: { userId: "bright-owner" } });
    for (const id of ids)
      await d
        .prepare("INSERT INTO tasks(id,tenant_id,title) VALUES(?,?,?)")
        .run(id, "northstar", "QA parallel activity");
    const path = "/api/task-activities?taskId=" + ids[1];
    assert.equal(
      (
        await c.post("/api/workspace/focus", {
          data: {
            action: "start",
            taskId: ids[0],
            taskRevision: 1,
            minutes: 60,
          },
        })
      ).status(),
      200,
    );
    let response = await c.post(path, {
      data: {
        action: "start",
        kind: "automation",
        label: "Application worker",
        note: "Preparing supporting information",
        minutes: 120,
      },
    });
    assert.equal(response.status(), 200, await response.text());
    const activityId = (await response.json()).id;
    let state = await (await c.get(path)).json(),
      activity = state.activities[0];
    assert.equal(activity.state, "running");
    assert.ok(Date.parse(activity.check_in_at) > Date.now() + 119 * 60000);
    let focus = await (await c.get("/api/workspace/focus")).json();
    assert.equal(focus.active.task_id, ids[0]);
    assert.equal((await other.get(path)).status(), 404);
    response = await c.post(path, {
      data: {
        action: "update",
        id: activityId,
        revision: activity.revision,
        note: "Halfway, need another hour",
        minutes: 60,
      },
    });
    assert.equal(response.status(), 200);
    assert.equal(
      (
        await c.post(path, {
          data: {
            action: "stop",
            id: activityId,
            revision: activity.revision,
            note: "Old view",
          },
        })
      ).status(),
      409,
    );
    state = await (await c.get(path)).json();
    activity = state.activities[0];
    assert.equal(
      (
        await c.post(path, {
          data: {
            action: "stop",
            id: activity.id,
            revision: activity.revision,
            note: "Worker finished its session",
          },
        })
      ).status(),
      200,
    );
    assert.notEqual(
      (await d.prepare("SELECT stage FROM tasks WHERE id=?").get(ids[1])).stage,
      "Done",
    );
    assert.equal(
      (
        await d
          .prepare("SELECT status FROM task_reminders WHERE task_id=?")
          .get(ids[1])
      ).status,
      "cancelled",
    );
    assert.equal(
      (await (await c.get("/api/workspace/focus")).json()).active.task_id,
      ids[0],
    );
  } finally {
    for (const id of ids) {
      await d.prepare("DELETE FROM task_reminders WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM focus_sessions WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
      await d.prepare("DELETE FROM tasks WHERE id=?").run(id);
    }
    await c.dispose();
    await other.dispose();
    await d.close();
  }
});
