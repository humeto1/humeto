import "server-only";
import { impactFields, impactValues } from "./task-value";
import { z } from "zod";
import { db, id, withTransaction } from "./db";
import { isStaff, canMutate } from "./auth";
import { hasFeature } from "./feature-guard";
import { localDay, nextDay, validDay } from "./scheduling-clock.mjs";
import { runTaskScheduler } from "./task-scheduler.mjs";
import type { Actor } from "./types";
const fail = (error: string, status = 400) =>
  Response.json({ error }, { status });
export async function planningRead(req: Request, a: Actor) {
  if (!isStaff(a) || a.role === "platform_admin")
    return fail("Workspace planning is for workspace members.", 403);
  if (!(await hasFeature(a.tenantId, "tasks")))
    return fail("Tasks is not included.", 403);
  const u = new URL(req.url),
    zone = u.searchParams.get("timezone") || "Asia/Karachi";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    return fail("Choose a valid timezone.");
  }
  const today = localDay(new Date(), zone),
    requested = u.searchParams.get("week") || today;
  if (!validDay(requested)) return fail("Choose a valid week date.");
  const start = new Date(requested + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const from = start.toISOString().slice(0, 10),
    end = nextDay(from, "daily", 6);
  await runTaskScheduler({
    d: db(),
    tenantId: a.tenantId,
    userId: a.id,
    routineOnly: true,
    heartbeat: false,
  });
  const routines = await db()
    .prepare(
      "SELECT r.*,t.title,t.category,t.project_id,COALESCE(w.enabled,FALSE) AS wording_enabled,COALESCE(w.variants,'[]'::jsonb) AS wording_variants,COALESCE(w.revision,0) AS wording_revision,w.canonical_title AS wording_canonical FROM task_recurrences r JOIN tasks t ON t.id=r.template_task_id AND t.tenant_id=r.tenant_id LEFT JOIN routine_wording w ON w.series_id=r.id WHERE r.tenant_id=? AND r.user_id=? AND r.track_occurrences=TRUE ORDER BY r.created_at DESC",
    )
    .all(a.tenantId, a.id);
  const rows = await db()
    .prepare(
      "SELECT o.*,r.routine_kind,r.timezone,t.stage,t.revision AS task_revision,t.completed_at,t.title,template.title AS template_title FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id JOIN tasks template ON template.id=r.template_task_id AND template.tenant_id=r.tenant_id LEFT JOIN tasks t ON t.id=o.task_id AND t.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? AND r.track_occurrences=TRUE AND (t.id IS NULL OR t.storage_state='active') AND o.day>=? AND o.day<=? ORDER BY o.day,template.title",
    )
    .all(a.tenantId, a.id, from, end);
  const occurrences: any[] = rows.map((r) => ({
    ...r,
    title: r.title || r.template_title,
    state:
      r.disposition === "skipped"
        ? "skipped"
        : r.stage === "Done"
          ? "done"
          : r.day < localDay(new Date(), r.timezone)
            ? "missed"
            : "pending",
  }));
  for (const r of routines) {
    if (r.status !== "active") continue;
    let day = r.next_day as string;
    for (let i = 0; i < 400 && day <= end; i++) {
      if (r.end_day && day > r.end_day) break;
      if (
        day >= from &&
        !occurrences.some((o) => o.series_id === r.id && o.day === day)
      )
        occurrences.push({
          series_id: r.id,
          day,
          title: r.title,
          routine_kind: r.routine_kind,
          timezone: r.timezone,
          state: day > today ? "upcoming" : day < today ? "missed" : "pending",
          task_id: null,
        } as any);
      day = nextDay(
        day,
        r.frequency,
        r.interval_count,
        Number((r.first_day as string).slice(8)),
      );
    }
  }
  const totals = Object.fromEntries(
    ["done", "missed", "pending", "skipped", "upcoming"].map((s) => [
      s,
      occurrences.filter((r) => r.state === s).length,
    ]),
  );
  return Response.json(
    {
      routines,
      occurrences,
      totals,
      week: from,
      weekEnd: end,
      today,
      timezone: zone,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
const input = z.discriminatedUnion("action", [
  z.object({
    ...impactFields,
    action: z.literal("routine"),
    important: z.boolean().default(false),
    urgent: z.boolean().default(false),
    personId: z.string().max(100).default(""),
    assignee: z.string().max(200).default(""),
    title: z.string().trim().min(2).max(200),
    category: z.string().trim().max(60).default("Personal"),
    kind: z.enum(["operations", "groceries", "subscription"]),
    frequency: z.enum(["daily", "weekdays", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(12).default(1),
    firstDay: z.string().refine(validDay),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().max(100),
    endDay: z.string().default(""),
    projectId: z.string().max(100).default(""),
    goalIds: z.array(z.string().max(100)).max(20).default([]),
  }),
  z.object({
    action: z.literal("alerts"),
    revision: z.number().int().nonnegative(),
    tone: z.enum(["chime", "bell", "silent"]),
    vibration: z.boolean(),
    precise: z.boolean(),
  }),
]);
export async function planningWrite(a: Actor, body: unknown) {
  if (
    !isStaff(a) ||
    !(await canMutate(a)) ||
    !(await hasFeature(a.tenantId, "tasks"))
  )
    return fail("Planning is read-only.", 403);
  const v = input.parse(body);
  return withTransaction(async () => {
    await db()
      .prepare(
        "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
      )
      .get(a.tenantId, a.id);
    if (v.action === "alerts") {
      const p = await db()
        .prepare(
          "SELECT revision FROM task_followup_preferences WHERE tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(a.tenantId, a.id);
      if ((p?.revision || 0) !== v.revision)
        return fail("Preferences changed. Refresh first.", 409);
      await db()
        .prepare(
          "INSERT INTO task_followup_preferences(tenant_id,user_id,tone,vibration,precise) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET tone=excluded.tone,vibration=excluded.vibration,precise=excluded.precise,revision=task_followup_preferences.revision+1",
        )
        .run(a.tenantId, a.id, v.tone, v.vibration, v.precise);
      return Response.json({ ok: true });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: v.timezone });
    } catch {
      return fail("Choose a valid timezone.");
    }
    if (
      v.firstDay < localDay(new Date(), v.timezone) ||
      (v.endDay && (!validDay(v.endDay) || v.endDay < v.firstDay))
    )
      return fail("Choose a valid future schedule.");
    if (
      v.frequency === "weekdays" &&
      [0, 6].includes(new Date(v.firstDay + "T12:00Z").getUTCDay())
    )
      return fail("Choose a weekday start.");
    if (
      v.projectId &&
      !(await db()
        .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
        .get(v.projectId, a.tenantId))
    )
      return fail("Project not found.", 404);
    for (const goal of new Set(v.goalIds))
      if (
        !(await db()
          .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
          .get(goal, a.tenantId))
      )
        return fail("Goal not found.", 404);
    if (
      v.personId &&
      !(await db()
        .prepare("SELECT id FROM people WHERE id=? AND tenant_id=?")
        .get(v.personId, a.tenantId))
    )
      return fail("Applicant not found.", 404);
    if (
      v.assignee &&
      !(await db()
        .prepare(
          "SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant') AND u.name=?",
        )
        .get(a.tenantId, v.assignee))
    )
      return fail("Choose a workspace team member.");
    const tid = id(),
      sid = id();
    await db()
      .prepare(
        "INSERT INTO tasks(id,tenant_id,title,category,person_id,important,urgent,work_kind,assignee,last_actor_id,project_id,value_type,value_minor,value_currency,value_note,value_timing,payment_pattern) VALUES(?,?,?,?,?,?,?,'routine',?,?,?,?,?,?,?,?,?)",
      )
      .run(
        tid,
        a.tenantId,
        v.title,
        v.category,
        v.personId || null,
        v.important ? 1 : 0,
        v.urgent ? 1 : 0,
        v.assignee || a.name,
        a.id,
        v.projectId,
        ...impactValues(v),
      );
    for (const goal of new Set(v.goalIds))
      await db()
        .prepare(
          "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
        )
        .run(a.tenantId, tid, goal);
    await db()
      .prepare(
        "INSERT INTO task_recurrences(id,tenant_id,user_id,template_task_id,frequency,interval_count,first_day,next_day,end_day,local_time,timezone,routine_kind,track_occurrences) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,TRUE)",
      )
      .run(
        sid,
        a.tenantId,
        a.id,
        tid,
        v.frequency,
        v.interval,
        v.firstDay,
        v.firstDay,
        v.endDay,
        v.time,
        v.timezone,
        v.kind,
      );
    return Response.json({ id: sid, taskId: tid });
  });
}
