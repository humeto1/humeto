import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { canMutate, isStaff } from "./auth";
import { focusReply, interpretFocus } from "./focus-coach";
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
 WHERE f.tenant_id=? AND f.user_id=? ORDER BY f.started_at DESC,f.id DESC LIMIT 50`,
    )
    .all(a.tenantId, a.id);
  const events = await db()
    .prepare(
      `SELECT e.*,t.title FROM focus_events e JOIN focus_sessions f ON f.id=e.session_id AND f.tenant_id=e.tenant_id JOIN tasks t ON t.id=f.task_id AND t.tenant_id=f.tenant_id WHERE e.tenant_id=? AND e.user_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
    )
    .all(a.tenantId, a.id);
  return NextResponse.json(
    {
      active: rows.find((r) => !r.ended_at) || null,
      history: rows.filter((r) => r.ended_at),
      events,
      serverNow: new Date().toISOString(),
      mode: "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function focusInterpret(a: Actor, body: unknown) {
  if (!isStaff(a)) return fail("Task focus is not permitted.", 403);
  const { message } = z
    .object({ message: z.string().trim().min(1).max(2000) })
    .parse(body);
  const active = await db()
    .prepare(
      "SELECT id,revision,state FROM focus_sessions WHERE tenant_id=? AND user_id=? AND ended_at IS NULL",
    )
    .get(a.tenantId, a.id);
  return NextResponse.json({
    ...interpretFocus(message, active?.state || null),
    sessionId: active?.id || null,
    revision: active?.revision || null,
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
    "progress",
    "switch",
  ]),
  taskId: z.string().min(1).max(100).optional(),
  taskRevision: z.number().int().positive().optional(),
  nextTaskRevision: z.number().int().positive().optional(),
  sessionId: z.string().min(1).max(100).optional(),
  revision: z.number().int().positive().optional(),
  minutes: z.number().int().min(1).max(720).default(25),
  note: z.string().trim().max(2000).default(""),
  progress: z.number().int().min(0).max(100).optional(),
  nextStep: z.string().trim().max(500).optional(),
  blocker: z
    .enum(["", "waiting", "unclear", "overwhelmed", "other"])
    .optional(),
});
export async function focusMutation(a: Actor, body: unknown) {
  if (!isStaff(a) || !(await canMutate(a)))
    return fail("Task focus is read-only.", 403);
  const v = command.parse(body);
  return withTransaction(async () => {
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
    const record = async (
      sid: string,
      event: string,
      seconds: number,
      reply: string,
      clean = false,
    ) => {
      await db()
        .prepare(
          "INSERT INTO focus_events(id,session_id,tenant_id,user_id,event,note,elapsed_seconds,progress,next_step,blocker,assistant_reply) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          sid,
          a.tenantId,
          a.id,
          event,
          clean ? "" : v.note,
          seconds,
          clean ? null : (v.progress ?? null),
          clean ? "" : v.nextStep || "",
          clean ? "" : v.blocker || "",
          reply,
        );
    };
    const start = async (t: { id: string }) => {
      const sid = id(),
        switching = v.action === "switch";
      const last = await db()
        .prepare(
          "SELECT progress,next_step,note,state FROM focus_sessions WHERE tenant_id=? AND user_id=? AND task_id=? AND ended_at IS NOT NULL ORDER BY ended_at DESC,id DESC LIMIT 1",
        )
        .get(a.tenantId, a.id, t.id);
      const previous = last?.state === "completed" ? null : last;
      const startingProgress =
        (switching ? undefined : v.progress) ?? previous?.progress ?? null;
      const startingStep =
        (switching ? undefined : v.nextStep) ?? previous?.next_step ?? "";
      const startingNote = (!switching && v.note) || previous?.note || "";
      await db()
        .prepare(
          `INSERT INTO focus_sessions(id,tenant_id,user_id,task_id,target_minutes,state,running_since,check_in_at,note,next_step,progress) VALUES(?,?,?,?,?,'running',clock_timestamp(),clock_timestamp()+(? * interval '1 minute'),?,?,?)`,
        )
        .run(
          sid,
          a.tenantId,
          a.id,
          t.id,
          v.minutes,
          v.minutes,
          startingNote,
          startingStep,
          startingProgress,
        );
      await db()
        .prepare(
          "UPDATE tasks SET stage='In progress',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(a.id, t.id, a.tenantId);
      await record(
        sid,
        "started",
        0,
        (previous
          ? "Welcome back. Your earlier progress and next step are saved. "
          : "") +
          focusReply(
            v.action,
            v.minutes,
            switching ? undefined : v.progress,
            "",
            switching ? "" : v.nextStep,
          ),
        switching,
      );
      return sid;
    };
    if (v.action === "start") {
      if (active)
        return fail(
          "Finish or switch your current focus session before starting another.",
          409,
        );
      const t = await db()
        .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(v.taskId || "", a.tenantId);
      if (!t) return fail("Task not found.", 404);
      if (t.stage === "Done") return fail("Choose an unfinished task.", 409);
      if (t.revision !== v.taskRevision)
        return fail("Task changed. Refresh and choose it again.", 409);
      const sid = await start(t as { id: string });
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
    if (v.action === "switch") {
      const next = await db()
        .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(v.taskId || "", a.tenantId);
      if (!next) return fail("Next task not found.", 404);
      if (next.id === active.task_id || next.stage === "Done")
        return fail("Choose a different unfinished task.", 409);
      if (next.revision !== v.nextTaskRevision)
        return fail("Next task changed. Refresh before switching.", 409);
      // Validate both tasks before ending anything. The transaction makes switching all-or-nothing.
      await db()
        .prepare(
          `UPDATE focus_sessions SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,state='stopped',running_since=NULL,check_in_at=NULL,ended_at=clock_timestamp(),note=CASE WHEN ?='' THEN note ELSE ? END,revision=revision+1 WHERE id=?`,
        )
        .run(v.note, v.note, active.id);
      const stopped = await db()
        .prepare("SELECT elapsed_seconds FROM focus_sessions WHERE id=?")
        .get(active.id);
      await record(
        active.id,
        "switch",
        stopped!.elapsed_seconds,
        "Time saved. This task stays open while you work on something else.",
      );
      // A progress report belongs to the previous task, not the newly selected one.
      const sid = await start(next as { id: string });
      await audit(
        a.tenantId,
        a.id,
        "switch",
        "task-focus",
        active.id,
        "Saved focus and switched to another task",
      );
      return NextResponse.json({ ok: true, id: sid });
    }
    if (v.action === "complete") {
      if (t.revision !== v.taskRevision)
        return fail("Task changed. Refresh before marking it done.", 409);
      await db()
        .prepare(
          "UPDATE focus_sessions SET note=CASE WHEN ?='' THEN note ELSE ? END,progress=100 WHERE id=?",
        )
        .run(v.note, v.note, active.id);
      await db()
        .prepare(
          "UPDATE tasks SET stage='Done',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(a.id, t.id, a.tenantId);
      // Existing trigger stops all members' timers for a completed task. Enrich only this member's event.
      await db()
        .prepare(
          "UPDATE focus_events SET note=?,progress=100,assistant_reply=? WHERE session_id=? AND event='completed'",
        )
        .run(v.note, focusReply("complete", v.minutes), active.id);
    } else {
      if (v.action === "resume" && active.state === "running")
        return fail("The timer is already running.", 409);
      if (["pause", "extend"].includes(v.action) && active.state !== "running")
        return fail("Resume the timer first.", 409);
      if (
        v.action === "progress" &&
        !v.note &&
        v.progress === undefined &&
        v.nextStep === undefined
      )
        return fail("Add a progress note, percentage or next step.");
      const state =
        v.action === "progress"
          ? active.state
          : v.action === "resume" || v.action === "extend"
            ? "running"
            : v.action === "stop"
              ? "stopped"
              : v.action === "blocked"
                ? "blocked"
                : "paused";
      const blocker =
        v.action === "blocked"
          ? v.blocker || "other"
          : ["resume", "extend"].includes(v.action)
            ? ""
            : active.blocker;
      if (v.action === "progress") {
        // A progress update must not silently postpone an already-due check-in.
        await db()
          .prepare(
            "UPDATE focus_sessions SET note=CASE WHEN ?='' THEN note ELSE ? END,progress=COALESCE(?,progress),next_step=COALESCE(?,next_step),revision=revision+1 WHERE id=?",
          )
          .run(
            v.note,
            v.note,
            v.progress ?? null,
            v.nextStep ?? null,
            active.id,
          );
      } else {
        await db()
          .prepare(
            `UPDATE focus_sessions SET
 elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,
 state=?,running_since=CASE WHEN ?='running' THEN clock_timestamp() ELSE NULL END,
 check_in_at=CASE WHEN ?='running' THEN clock_timestamp()+(? * interval '1 minute') ELSE NULL END,
 ended_at=CASE WHEN ?='stopped' THEN clock_timestamp() ELSE NULL END,
 note=CASE WHEN ?='' THEN note ELSE ? END,progress=COALESCE(?,progress),next_step=COALESCE(?,next_step),blocker=?,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=?`,
          )
          .run(
            state,
            state,
            state,
            v.minutes,
            state,
            v.note,
            v.note,
            v.progress ?? null,
            v.nextStep ?? null,
            blocker,
            active.id,
            a.tenantId,
            a.id,
          );
      }
      const row = await db()
        .prepare(
          "SELECT elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END AS seconds FROM focus_sessions WHERE id=?",
        )
        .get(active.id);
      await record(
        active.id,
        v.action,
        row!.seconds,
        focusReply(v.action, v.minutes, v.progress, blocker, v.nextStep),
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
