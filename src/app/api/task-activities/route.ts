import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { db, id, withTransaction, audit } from "@/lib/db";
import { hasFeature } from "@/lib/feature-guard";
import { z } from "zod";
export const runtime = "nodejs";
const input = z.object({
  action: z.enum(["start", "update", "pause", "resume", "stop"]),
  id: z.string().max(100).optional(),
  revision: z.number().int().min(1).optional(),
  kind: z.enum(["team", "automation", "waiting"]).default("waiting"),
  performerId: z.string().max(100).default(""),
  label: z.string().trim().max(80).default(""),
  note: z.string().trim().min(1).max(1000),
  minutes: z.number().int().min(1).max(1440).default(60),
  timezone: z.string().max(100).default("Asia/Karachi"),
});
async function route(req: Request) {
  try {
    const a = await actor();
    if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const taskId = z
      .string()
      .min(1)
      .max(100)
      .parse(new URL(req.url).searchParams.get("taskId"));
    const task = await db()
      .prepare("SELECT id,title,stage FROM tasks WHERE id=? AND tenant_id=?")
      .get(taskId, a.tenantId);
    if (!task)
      return Response.json({ error: "Task not found." }, { status: 404 });
    if (req.method === "GET") {
      const activities = await db()
        .prepare(
          "SELECT a.id,a.created_by,a.performer_kind,a.performer_id,a.performer_label,a.state,a.elapsed_seconds,a.running_since,a.check_in_at,a.note,a.revision,a.started_at,a.ended_at,u.name AS recorded_by,a.elapsed_seconds+CASE WHEN a.running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-a.running_since)))::bigint) END AS seconds FROM task_activities a JOIN users u ON u.id=a.created_by WHERE a.task_id=? AND a.tenant_id=? ORDER BY a.started_at DESC LIMIT 100",
        )
        .all(taskId, a.tenantId);
      const members = await db()
        .prepare(
          "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant') ORDER BY u.name",
        )
        .all(a.tenantId);
      const events = await db()
        .prepare(
          "SELECT e.id,e.activity_id,e.event,e.note,e.created_at,u.name AS actor FROM task_activity_events e JOIN task_activities a ON a.id=e.activity_id JOIN users u ON u.id=e.actor_id WHERE a.task_id=? AND a.tenant_id=? ORDER BY e.created_at DESC LIMIT 100",
        )
        .all(taskId, a.tenantId);
      return Response.json(
        {
          activities,
          members,
          events,
          actorId: a.id,
          owner: a.role === "owner",
          serverNow: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return Response.json(
        { error: "Workspace is read-only." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length")) > 8000)
      return Response.json({ error: "Too large." }, { status: 413 });
    const v = input.parse(await req.json());
    new Intl.DateTimeFormat("en", { timeZone: v.timezone });
    return await withTransaction(async () => {
      const locked = await db()
        .prepare(
          "SELECT id,stage FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE",
        )
        .get(taskId, a.tenantId);
      if (!locked)
        return Response.json({ error: "Task not found." }, { status: 404 });
      let activityId = v.id;
      if (v.action === "start") {
        if (locked.stage === "Done")
          return Response.json(
            { error: "Reopen this task before recording new activity." },
            { status: 409 },
          );
        const count = await db()
          .prepare(
            "SELECT count(*)::int AS n FROM task_activities WHERE task_id=? AND tenant_id=?",
          )
          .get(taskId, a.tenantId);
        if (Number(count?.n) >= 100)
          return Response.json(
            { error: "Activity history limit reached for this task." },
            { status: 400 },
          );
        let label = v.label;
        if (v.kind === "team") {
          const member = await db()
            .prepare(
              "SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role IN ('owner','consultant')",
            )
            .get(a.tenantId, v.performerId);
          if (!member)
            return Response.json(
              { error: "Choose a team member in this workspace." },
              { status: 400 },
            );
          label = String(member.name);
        } else if (!label)
          return Response.json(
            { error: "Describe who or what is working on this." },
            { status: 400 },
          );
        activityId = id();
        const reminderId = id(),
          when = new Date(Date.now() + v.minutes * 60000).toISOString();
        await db()
          .prepare(
            "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
          )
          .run(reminderId, a.tenantId, a.id, taskId, when, v.timezone);
        await db()
          .prepare(
            "INSERT INTO task_activities(id,tenant_id,task_id,created_by,performer_kind,performer_id,performer_label,check_in_at,note,reminder_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            activityId,
            a.tenantId,
            taskId,
            a.id,
            v.kind,
            v.kind === "team" ? v.performerId : null,
            label,
            when,
            v.note,
            reminderId,
          );
      } else {
        const row = await db()
          .prepare(
            "SELECT * FROM task_activities WHERE id=? AND task_id=? AND tenant_id=? FOR UPDATE",
          )
          .get(v.id, taskId, a.tenantId);
        if (!row)
          return Response.json(
            { error: "Activity not found." },
            { status: 404 },
          );
        if (
          a.role !== "owner" &&
          row.created_by !== a.id &&
          row.performer_id !== a.id
        )
          return Response.json(
            {
              error:
                "Only its recorder, performer or workspace owner can update this activity.",
            },
            { status: 403 },
          );
        if (Number(row.revision) !== v.revision || row.state === "ended")
          return Response.json(
            { error: "Activity changed or ended. Reload first." },
            { status: 409 },
          );
        const state =
          v.action === "stop"
            ? "ended"
            : v.action === "pause"
              ? "paused"
              : v.action === "resume"
                ? "running"
                : row.state;
        const when =
          state === "running"
            ? new Date(Date.now() + v.minutes * 60000).toISOString()
            : null;
        await db()
          .prepare(
            "UPDATE task_activities SET elapsed_seconds=elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-running_since)))::bigint) END,state=?,running_since=CASE WHEN ?='running' THEN clock_timestamp() ELSE NULL END,check_in_at=?,note=?,ended_at=CASE WHEN ?='ended' THEN now() ELSE NULL END,revision=revision+1 WHERE id=?",
          )
          .run(state, state, when, v.note, state, row.id);
        if (row.reminder_id) {
          await db()
            .prepare(
              "UPDATE task_reminders SET status=?,remind_at=coalesce(?,remind_at) WHERE id=? AND tenant_id=?",
            )
            .run(
              when ? "scheduled" : "cancelled",
              when,
              row.reminder_id,
              a.tenantId,
            );
          await db()
            .prepare(
              "DELETE FROM task_followup_notifications WHERE reminder_id=?",
            )
            .run(row.reminder_id);
        }
      }
      await db()
        .prepare(
          "INSERT INTO task_activity_events(id,activity_id,actor_id,event,note) VALUES(?,?,?,?,?)",
        )
        .run(id(), activityId, a.id, v.action, v.note);
      await audit(
        a.tenantId,
        a.id,
        "activity_" + v.action,
        "task",
        taskId,
        "Recorded background/delegated activity; focus and completion unchanged",
      );
      return Response.json({ saved: true, id: activityId });
    });
  } catch {
    return Response.json(
      { error: "Check activity details, timezone and expected update time." },
      { status: 400 },
    );
  }
}
export const GET = route,
  POST = route;
