import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { canMutate, isStaff } from "./auth";
import type { Actor } from "./types";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
export async function focusRead(a: Actor) {
  if (!isStaff(a)) return fail("Task focus is not permitted.", 403);
  const rows = await db()
    .prepare(
      `SELECT f.*,t.title,t.stage AS task_stage,t.revision AS task_revision,t.project_id,COALESCE(p.title,'') AS project_title,
 f.elapsed_seconds+CASE WHEN f.running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-f.running_since)))::bigint) END AS total_seconds
 FROM focus_sessions f JOIN tasks t ON t.id=f.task_id AND t.tenant_id=f.tenant_id
 LEFT JOIN projects p ON p.id=t.project_id AND p.tenant_id=t.tenant_id
 WHERE f.tenant_id=? AND f.user_id=? ORDER BY f.started_at DESC LIMIT 50`,
    )
    .all(a.tenantId, a.id);
  const events = await db()
    .prepare(
      `SELECT e.* FROM focus_events e JOIN focus_sessions f ON f.id=e.session_id AND f.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.user_id=? ORDER BY e.created_at DESC LIMIT 100`,
    )
    .all(a.tenantId, a.id);
  return NextResponse.json({
    active: rows.find((r) => !r.ended_at) || null,
    history: rows.filter((r) => r.ended_at),
    events,
    serverNow: new Date().toISOString(),
    mode: "local",
  });
}
const command = z.object({
  action: z.enum([
    "start",
    "pause",
    "resume",
    "extend",
    "complete",
    "blocked",
    "stop",
  ]),
  taskId: z.string().min(1).max(100).optional(),
  taskRevision: z.number().int().positive().optional(),
  sessionId: z.string().min(1).max(100).optional(),
  revision: z.number().int().positive().optional(),
  minutes: z.number().int().min(1).max(720).default(25),
  note: z.string().trim().max(2000).default(""),
});
export async function focusMutation(a: Actor, body: unknown) {
  if (!isStaff(a) || !(await canMutate(a)))
    return fail("Task focus is read-only.", 403);
  const v = command.parse(body);
  return withTransaction(async () => {
    // Serialize starts for this member, including across tabs.
    await db()
      .prepare(
        "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
      )
      .get(a.tenantId, a.id);
    const active = await db()
      .prepare(
        "SELECT * FROM focus_sessions WHERE tenant_id=? AND user_id=? AND ended_at IS NULL FOR UPDATE",
      )
      .get(a.tenantId, a.id);
    if (v.action === "start") {
      if (active)
        return fail(
          "Pause and finish this focus session before starting another.",
          409,
        );
      const t = await db()
        .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(v.taskId || "", a.tenantId);
      if (!t) return fail("Task not found.", 404);
      if (t.stage === "Done") return fail("Choose an unfinished task.", 409);
      if (t.revision !== v.taskRevision)
        return fail("Task changed. Refresh and choose it again.", 409);
      const sid = id();
      await db()
        .prepare(
          `INSERT INTO focus_sessions(id,tenant_id,user_id,task_id,target_minutes,state,running_since,check_in_at,note) VALUES(?,?,?,?,?,'running',clock_timestamp(),clock_timestamp()+(? * interval '1 minute'),?)`,
        )
        .run(sid, a.tenantId, a.id, t.id, v.minutes, v.minutes, v.note);
      await db()
        .prepare(
          "UPDATE tasks SET stage='In progress',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(a.id, t.id, a.tenantId);
      await db()
        .prepare(
          "INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds) VALUES(?,?,?,?,'started',?,0)",
        )
        .run(id(), sid, a.tenantId, a.id, v.note);
      await audit(
        a.tenantId,
        a.id,
        "started",
        "task-focus",
        sid,
        "Started a task focus session",
      );
      return NextResponse.json({ ok: true, id: sid });
    }
    if (!active || active.id !== v.sessionId)
      return fail("Active focus session not found. Refresh this view.", 409);
    if (active.revision !== v.revision)
      return fail("Focus changed in another tab. Refresh and try again.", 409);
    const t = await db()
      .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
      .get(active.task_id, a.tenantId);
    if (!t) return fail("Task not found.", 404);
    if (v.action === "complete") {
      if (t.revision !== v.taskRevision)
        return fail("Task changed. Refresh before marking it done.", 409);
      await db()
        .prepare("UPDATE focus_sessions SET note=? WHERE id=?")
        .run(v.note, active.id);
      await db()
        .prepare(
          "UPDATE tasks SET stage='Done',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(a.id, t.id, a.tenantId);
      // The database trigger closes every active timer for this completed task.
    } else {
      if (v.action === "resume" && active.state === "running")
        return fail("The timer is already running.", 409);
      if (["pause", "extend"].includes(v.action) && active.state !== "running")
        return fail("Resume the timer first.", 409);
      const state =
        v.action === "resume" || v.action === "extend"
          ? "running"
          : v.action === "stop"
            ? "stopped"
            : v.action === "blocked"
              ? "blocked"
              : "paused";
      await db()
        .prepare(
          `UPDATE focus_sessions SET
    elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,
    state=?,running_since=CASE WHEN ?='running' THEN clock_timestamp() ELSE NULL END,
    check_in_at=CASE WHEN ?='running' THEN clock_timestamp()+(? * interval '1 minute') ELSE NULL END,
    ended_at=CASE WHEN ?='stopped' THEN clock_timestamp() ELSE NULL END,note=?,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?`,
        )
        .run(
          state,
          state,
          state,
          v.minutes,
          state,
          v.note,
          active.id,
          a.tenantId,
          a.id,
        );
      const row = await db()
        .prepare("SELECT elapsed_seconds FROM focus_sessions WHERE id=?")
        .get(active.id);
      await db()
        .prepare(
          "INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          active.id,
          a.tenantId,
          a.id,
          v.action,
          v.note,
          row!.elapsed_seconds,
        );
    }
    await audit(
      a.tenantId,
      a.id,
      v.action,
      "task-focus",
      active.id,
      "Updated a task focus session",
    );
    return NextResponse.json({ ok: true, id: active.id });
  });
}
