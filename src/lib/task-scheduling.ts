import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { isStaff, canMutate } from "./auth";
import { validTimezone, validDay, localInstant } from "./agent/dates";
import {
  defaultPreferences,
  quietUntil,
  localDay,
} from "./scheduling-clock.mjs";
import type { Actor } from "./types";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  day = z.string().refine(validDay, "Choose a real calendar date.");
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preferences"),
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    timezone: z.string().max(100),
    quietEnabled: z.boolean(),
    quietStart: time,
    quietEnd: time,
    dailyLimit: z.number().int().min(1).max(20),
    followupMinutes: z.union([
      z.literal(0),
      z.literal(60),
      z.literal(240),
      z.literal(1440),
    ]),
  }),
  z.object({
    action: z.literal("series"),
    taskId: z.string().min(1).max(100),
    taskRevision: z.number().int().positive(),
    frequency: z.enum(["daily", "weekdays", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(12),
    firstDay: day,
    time,
    timezone: z.string().max(100),
    endDay: z.union([z.literal(""), day]).default(""),
  }),
  z.object({
    action: z.literal("series-state"),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    status: z.enum(["active", "paused", "cancelled"]),
  }),
  z.object({
    action: z.literal("remind"),
    taskId: z.string().min(1).max(100),
    taskRevision: z.number().int().positive(),
    day,
    time,
    timezone: z.string().max(100),
  }),
  z.object({
    action: z.literal("snooze"),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    minutes: z.number().int().min(1).max(10080),
  }),
  z.object({
    action: z.literal("dismiss"),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("finish"),
    id: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    taskRevision: z.number().int().positive(),
  }),
]);
export async function schedulingRead(a: Actor, summary = false) {
  if (!isStaff(a)) return fail("Task scheduling is for company staff.", 403);
  const d = db(),
    prefs = {
      ...defaultPreferences,
      ...(await d
        .prepare(
          "SELECT * FROM task_followup_preferences WHERE tenant_id=? AND user_id=?",
        )
        .get(a.tenantId, a.id)),
    },
    now = new Date();
  const rows = await d
    .prepare(
      "SELECT r.*,t.title,t.stage,t.revision AS task_revision,n.notified_at,n.nudge_count FROM task_reminders r JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id LEFT JOIN task_followup_notifications n ON n.reminder_id=r.id WHERE r.tenant_id=? AND r.user_id=? AND r.status='scheduled' AND t.stage!='Done' ORDER BY r.remind_at LIMIT 100",
    )
    .all(a.tenantId, a.id);
  const quiet = quietUntil(now, prefs),
    reminders = rows.map((r) => ({
      ...r,
      due: Date.parse(r.remind_at) <= now.getTime(),
      ready:
        !!r.notified_at &&
        prefs.enabled &&
        !quiet &&
        Date.parse(r.remind_at) <= now.getTime(),
    }));
  const heartbeat = await d
    .prepare("SELECT heartbeat FROM task_scheduler_heartbeat WHERE id='main'")
    .get();
  const health = {
    online:
      !!heartbeat && now.getTime() - Date.parse(heartbeat.heartbeat) < 45000,
    lastSeen: heartbeat?.heartbeat || null,
  };
  if (summary)
    return NextResponse.json(
      { readyCount: reminders.filter((r) => r.ready).length, worker: health },
      { headers: { "Cache-Control": "no-store" } },
    );
  const series = await d
    .prepare(
      "SELECT r.*,t.title,(SELECT count(*) FROM task_occurrences o WHERE o.series_id=r.id) AS occurrence_count FROM task_recurrences r JOIN tasks t ON t.id=r.template_task_id AND t.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.user_id=? ORDER BY r.created_at DESC LIMIT 100",
    )
    .all(a.tenantId, a.id);
  const events = await d
    .prepare(
      "SELECT e.*,t.title FROM task_reminder_events e JOIN task_reminders r ON r.id=e.reminder_id AND r.tenant_id=e.tenant_id JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id WHERE e.tenant_id=? AND e.user_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 30",
    )
    .all(a.tenantId, a.id);
  return NextResponse.json(
    {
      preferences: prefs,
      reminders,
      series,
      events,
      worker: health,
      quietUntil: quiet,
      serverNow: now.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function schedulingWrite(a: Actor, body: unknown) {
  if (!isStaff(a) || !(await canMutate(a)))
    return fail("Task schedules are read-only.", 403);
  const v = command.parse(body);
  if ("timezone" in v) {
    try {
      validTimezone(v.timezone);
    } catch {
      return fail("Choose a valid IANA timezone, such as Asia/Karachi.");
    }
  }
  return withTransaction(async () => {
    const d = db();
    await d
      .prepare(
        "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE",
      )
      .get(a.tenantId, a.id);
    if (v.action === "preferences") {
      if (v.quietEnabled && v.quietStart === v.quietEnd)
        return fail("Quiet hours must have different start and end times.");
      const current = await d
        .prepare(
          "SELECT revision FROM task_followup_preferences WHERE tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(a.tenantId, a.id);
      if ((current?.revision || 0) !== v.revision)
        return fail("Preferences changed. Refresh before saving.", 409);
      await d
        .prepare(
          "INSERT INTO task_followup_preferences(tenant_id,user_id,enabled,timezone,quiet_enabled,quiet_start,quiet_end,daily_limit,followup_minutes) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET enabled=excluded.enabled,timezone=excluded.timezone,quiet_enabled=excluded.quiet_enabled,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,daily_limit=excluded.daily_limit,followup_minutes=excluded.followup_minutes,revision=task_followup_preferences.revision+1",
        )
        .run(
          a.tenantId,
          a.id,
          v.enabled,
          v.timezone,
          v.quietEnabled,
          v.quietStart,
          v.quietEnd,
          v.dailyLimit,
          v.followupMinutes,
        );
    } else if (v.action === "series" || v.action === "remind") {
      const t = await d
        .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(v.taskId, a.tenantId);
      if (!t) return fail("Task not found.", 404);
      if (t.revision !== v.taskRevision)
        return fail("Task changed. Refresh before scheduling.", 409);
      if (v.action === "series") {
        if (v.firstDay < localDay(new Date(), v.timezone))
          return fail("Choose today or a future first occurrence.");
        if (v.endDay && v.endDay < v.firstDay)
          return fail("End date must be on or after the first occurrence.");
        if (
          v.frequency === "weekdays" &&
          [0, 6].includes(new Date(v.firstDay + "T12:00:00Z").getUTCDay())
        )
          return fail("Choose a weekday for the first occurrence.");
        const existing = await d
          .prepare(
            "SELECT id FROM task_recurrences WHERE tenant_id=? AND user_id=? AND template_task_id=? AND status IN ('active','paused')",
          )
          .get(a.tenantId, a.id, t.id);
        if (existing)
          return fail(
            "You already have a live series for this task. Pause or cancel it below first.",
            409,
          );
        await d
          .prepare(
            "INSERT INTO task_recurrences(id,tenant_id,user_id,template_task_id,frequency,interval_count,first_day,next_day,end_day,local_time,timezone) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            a.tenantId,
            a.id,
            t.id,
            v.frequency,
            v.interval,
            v.firstDay,
            v.firstDay,
            v.endDay,
            v.time,
            v.timezone,
          );
      } else {
        if (t.stage === "Done") return fail("Choose an unfinished task.", 409);
        const [h, m] = v.time.split(":").map(Number);
        let at: string;
        try {
          at = localInstant(v.day, h, m, v.timezone);
        } catch {
          return fail(
            "That local date/time is unavailable. Choose another time.",
          );
        }
        if (Date.parse(at) <= Date.now())
          return fail("Choose a future reminder time.");
        await d
          .prepare(
            "UPDATE task_reminders SET status='replaced' WHERE tenant_id=? AND user_id=? AND task_id=? AND status='scheduled'",
          )
          .run(a.tenantId, a.id, t.id);
        const rid = id();
        await d
          .prepare(
            "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
          )
          .run(rid, a.tenantId, a.id, t.id, at, v.timezone);
        await d
          .prepare(
            "INSERT INTO task_reminder_events(id,reminder_id,tenant_id,user_id,event,next_at) VALUES(?,?,?,?,'scheduled',?)",
          )
          .run(id(), rid, a.tenantId, a.id, at);
      }
    } else if (v.action === "series-state") {
      const s = await d
        .prepare(
          "SELECT * FROM task_recurrences WHERE id=? AND tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(v.id, a.tenantId, a.id);
      if (!s) return fail("Recurring series not found.", 404);
      if (s.revision !== v.revision)
        return fail("Series changed. Refresh before updating.", 409);
      if (["cancelled", "ended"].includes(s.status))
        return fail(
          "This series has ended. Create a new schedule instead.",
          409,
        );
      await d
        .prepare(
          "UPDATE task_recurrences SET status=?,revision=revision+1 WHERE id=?",
        )
        .run(v.status, s.id);
    } else {
      const r = await d
        .prepare(
          "SELECT * FROM task_reminders WHERE id=? AND tenant_id=? AND user_id=? FOR UPDATE",
        )
        .get(v.id, a.tenantId, a.id);
      if (!r) return fail("Reminder not found.", 404);
      if (r.revision !== v.revision || r.status !== "scheduled")
        return fail("Reminder changed. Refresh before updating.", 409);
      const t = await d
        .prepare(
          "SELECT id,stage,revision FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE",
        )
        .get(r.task_id, a.tenantId);
      if (!t || t.stage === "Done")
        return fail("This task is already finished.", 409);
      let at = "";
      if (v.action === "finish") {
        if (t.revision !== v.taskRevision)
          return fail("Task changed. Refresh before finishing.", 409);
        await d
          .prepare(
            "UPDATE tasks SET stage='Done',last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
          )
          .run(a.id, t.id, a.tenantId);
      } else if (v.action === "dismiss")
        await d
          .prepare("UPDATE task_reminders SET status='dismissed' WHERE id=?")
          .run(r.id);
      else {
        at = new Date(Date.now() + v.minutes * 60000).toISOString();
        await d
          .prepare("UPDATE task_reminders SET remind_at=? WHERE id=?")
          .run(at, r.id);
        await d
          .prepare(
            "DELETE FROM task_followup_notifications WHERE reminder_id=?",
          )
          .run(r.id);
      }
      await d
        .prepare(
          "INSERT INTO task_reminder_events(id,reminder_id,tenant_id,user_id,event,previous_at,next_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id(), r.id, a.tenantId, a.id, v.action, r.remind_at, at);
    }
    await audit(
      a.tenantId,
      a.id,
      v.action,
      "task-scheduling",
      a.id,
      "Updated task schedule or follow-up controls",
    );
    return NextResponse.json({ ok: true });
  });
}
