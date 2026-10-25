import { featureAllowed } from "./feature-access.mjs";
import { subscriptionAccess } from "./subscription-access.mjs";
import { randomUUID } from "node:crypto";
import { database } from "./postgres.mjs";
import {
  defaultPreferences,
  latestOccurrence,
  localDay,
  quietUntil,
  nextDay,
} from "./scheduling-clock.mjs";
async function writable(d, tenant, user, now) {
  const s = await d
    .prepare(
      "SELECT s.status,s.expires_at,s.features_json FROM memberships m JOIN subscriptions s ON s.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role IN ('owner','consultant')",
    )
    .get(tenant, user);
  return subscriptionAccess(s, now.getTime()) && featureAllowed(s, "tasks");
}
export async function runTaskScheduler({
  d = database(),
  now = new Date(),
  heartbeat = true,
  tenantId = "",
  userId = "",
  routineOnly = false,
} = {}) {
  await d.query("SELECT humeto_purge_task_bin($1,$2)", [
    now.toISOString(),
    tenantId,
  ]);
  if (heartbeat)
    await d
      .prepare(
        "INSERT INTO task_scheduler_heartbeat(id,heartbeat) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat",
      )
      .run(now.toISOString());
  const series = await d
    .prepare(
      "SELECT id FROM task_recurrences WHERE status='active' AND next_day<=? AND (next_day || ' ' || local_time)<=to_char(timezone(task_recurrences.timezone,?::timestamptz),'YYYY-MM-DD HH24:MI')" +
        (tenantId ? " AND tenant_id=? AND user_id=?" : "") +
        (routineOnly ? " AND track_occurrences=TRUE" : "") +
        " ORDER BY next_day LIMIT 500",
    )
    .all(
      new Date(now.getTime() + 86400000).toISOString().slice(0, 10),
      now.toISOString(),
      ...(tenantId ? [tenantId, userId] : []),
    );
  let created = 0,
    notified = 0;
  for (const { id } of series) {
    await d.transaction(async () => {
      const s = await d
        .prepare(
          "SELECT * FROM task_recurrences WHERE id=? AND status='active' FOR UPDATE SKIP LOCKED",
        )
        .get(id);
      if (!s || !(await writable(d, s.tenant_id, s.user_id, now))) return;
      let occurrence;
      try {
        occurrence = latestOccurrence(s, now);
      } catch {
        await d
          .prepare(
            "UPDATE task_recurrences SET status='paused',last_error='Schedule needs review before catch-up.',revision=revision+1 WHERE id=?",
          )
          .run(id);
        return;
      }
      if (!occurrence.day && !occurrence.ended) return;
      const days = [];
      if (s.track_occurrences && occurrence.day) {
        let day = s.next_day;
        for (let i = 0; i < 5000 && day <= occurrence.day; i++) {
          days.push(day);
          day = nextDay(
            day,
            s.frequency,
            s.interval_count,
            Number(s.first_day.slice(8)),
          );
        }
      } else if (occurrence.day) days.push(occurrence.day);
      for (const occurrenceDay of days) {
        const t = await d
          .prepare(
            "SELECT * FROM tasks WHERE id=? AND tenant_id=? AND storage_state='active'",
          )
          .get(s.template_task_id, s.tenant_id);
        if (!t) return;
        const taskId = randomUUID(),
          claim = await d
            .prepare(
              "INSERT INTO task_occurrences(series_id,day) VALUES(?,?) ON CONFLICT DO NOTHING",
            )
            .run(id, occurrenceDay);
        // Keep older expected days as missed evidence without flooding the task board.
        if (
          claim.changes &&
          s.track_occurrences &&
          occurrenceDay <
            new Date(now.getTime() - 31 * 86400000).toISOString().slice(0, 10)
        ) {
          await d
            .prepare(
              "UPDATE task_occurrences SET canonical_title=? WHERE series_id=? AND day=?",
            )
            .run(t.title, id, occurrenceDay);
          continue;
        }
        if (claim.changes) {
          await d
            .prepare(
              "INSERT INTO tasks(id,tenant_id,person_id,title,important,urgent,due_date,assignee,last_actor_id,project_id,category,work_kind,value_type,value_minor,value_currency,value_note,value_timing,payment_pattern) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              taskId,
              s.tenant_id,
              t.person_id,
              t.title,
              t.important,
              t.urgent,
              occurrenceDay,
              t.assignee,
              s.user_id,
              t.project_id,
              t.category || "",
              s.track_occurrences ? "routine" : t.work_kind || "one_off",
              t.value_type || "none",
              t.value_minor ?? null,
              t.value_currency || "PKR",
              t.value_note || "",
              t.value_timing || "prompt",
              t.payment_pattern || "one_time",
            );
          await d
            .prepare(
              "INSERT INTO task_goals(tenant_id,task_id,goal_id) SELECT l.tenant_id,?,l.goal_id FROM task_goals l JOIN goals g ON g.id=l.goal_id AND g.tenant_id=l.tenant_id WHERE l.task_id=? AND l.tenant_id=?",
            )
            .run(taskId, t.id, s.tenant_id);
          await d
            .prepare(
              "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) SELECT a.tenant_id,'task',?,a.user_id,? FROM work_assignments a JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.tenant_id=? AND a.entity_type='task' AND a.entity_id=? AND m.role IN ('owner','consultant')",
            )
            .run(taskId, s.user_id, s.tenant_id, t.id);
          await d
            .prepare(
              "UPDATE task_occurrences SET task_id=? WHERE series_id=? AND day=?",
            )
            .run(taskId, id, occurrenceDay);
          const wording = await d
            .prepare(
              "SELECT * FROM routine_wording WHERE series_id=? AND enabled=TRUE AND canonical_title=?",
            )
            .get(id, t.title);
          const variants = wording?.variants || [];
          const prior = await d
            .prepare(
              "SELECT count(*) AS n FROM task_occurrences WHERE series_id=? AND day<?",
            )
            .get(id, occurrenceDay);
          const display = variants.length
            ? variants[Number(prior.n) % variants.length]
            : "";
          await d
            .prepare(
              "UPDATE task_occurrences SET canonical_title=?,display_title=?,wording_revision=? WHERE series_id=? AND day=?",
            )
            .run(
              t.title,
              display,
              wording?.revision || null,
              id,
              occurrenceDay,
            );
          // Past occurrences stay in history, but only today gets a fresh nudge.
          if (
            occurrenceDay === localDay(now, s.timezone) ||
            !s.track_occurrences
          )
            await d
              .prepare(
                "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone,origin,source_key) VALUES(?,?,?,?,?,?,'automatic',?)",
              )
              .run(
                randomUUID(),
                s.tenant_id,
                s.user_id,
                taskId,
                now.toISOString(),
                s.timezone,
                s.id + ":" + occurrenceDay,
              );
          created++;
        }
      }
      await d
        .prepare(
          "UPDATE task_recurrences SET next_day=?,status=CASE WHEN ? THEN 'ended' ELSE status END,last_error=NULL,revision=revision+1 WHERE id=?",
        )
        .run(occurrence.next, occurrence.ended, id);
    });
  }
  if (routineOnly) return { created, notified };
  const members = await d
    .prepare(
      "SELECT DISTINCT tenant_id,user_id FROM task_reminders WHERE status='scheduled' AND remind_at<=?",
    )
    .all(now.toISOString());
  for (const member of members) {
    await d.transaction(async () => {
      const { tenant_id: tenant, user_id: user } = member;
      // Serialize reminder nudges for each member; keeps daily limits correct under concurrent ticks.
      const membership = await d
        .prepare(
          "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? FOR UPDATE SKIP LOCKED",
        )
        .get(tenant, user);
      if (!membership || !(await writable(d, tenant, user, now))) return;
      const prefs = {
        ...defaultPreferences,
        ...(await d
          .prepare(
            "SELECT * FROM task_followup_preferences WHERE tenant_id=? AND user_id=?",
          )
          .get(tenant, user)),
      };
      if (!prefs.enabled || quietUntil(now, prefs)) return;
      const today = localDay(now, prefs.timezone);
      const count = await d
        .prepare(
          "SELECT count(*) AS n FROM task_reminder_events e JOIN task_reminders rr ON rr.id=e.reminder_id WHERE e.tenant_id=? AND e.user_id=? AND e.event='notified' AND rr.origin='automatic' AND timezone(?,e.created_at)::date=?::date",
        )
        .get(tenant, user, prefs.timezone, today);
      let budget = prefs.daily_limit - Number(count.n);

      const reminders = await d
        .prepare(
          "SELECT r.*,t.important,t.urgent,n.notified_at,n.nudge_count FROM task_reminders r JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id LEFT JOIN task_followup_notifications n ON n.reminder_id=r.id WHERE r.tenant_id=? AND r.user_id=? AND r.status='scheduled' AND r.remind_at<=? AND t.stage!='Done' AND t.storage_state='active' AND (n.reminder_id IS NULL OR (? > 0 AND n.notified_at <= ?::timestamptz - (? * interval '1 minute'))) ORDER BY r.remind_at LIMIT 100",
        )
        .all(
          tenant,
          user,
          now.toISOString(),
          prefs.followup_minutes,
          now.toISOString(),
          prefs.followup_minutes,
        );
      for (const r of reminders) {
        if (
          r.origin === "automatic" &&
          (budget <= 0 || (!r.important && !r.urgent))
        )
          continue;
        if (
          r.notified_at &&
          (!prefs.followup_minutes ||
            now.getTime() - Date.parse(r.notified_at) <
              prefs.followup_minutes * 60000)
        )
          continue;
        await d
          .prepare(
            "INSERT INTO task_followup_notifications(reminder_id,tenant_id,user_id,notified_at) VALUES(?,?,?,?) ON CONFLICT(reminder_id) DO UPDATE SET notified_at=excluded.notified_at,nudge_count=task_followup_notifications.nudge_count+1",
          )
          .run(r.id, tenant, user, now.toISOString());
        await d
          .prepare(
            "INSERT INTO task_reminder_events(id,reminder_id,tenant_id,user_id,event,created_at) VALUES(?,?,?,?,'notified',?)",
          )
          .run(randomUUID(), r.id, tenant, user, now.toISOString());
        if (r.origin === "automatic") budget--;
        notified++;
      }
    });
  }
  return { created, notified };
}
