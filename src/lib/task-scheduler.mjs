import { randomUUID } from "node:crypto";
import { database } from "./postgres.mjs";
import {
  defaultPreferences,
  latestOccurrence,
  localDay,
  quietUntil,
} from "./scheduling-clock.mjs";
async function writable(d, tenant, user, now) {
  return !!(await d
    .prepare(
      "SELECT m.user_id FROM memberships m JOIN subscriptions s ON s.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role IN ('owner','consultant') AND s.status IN ('active','trial','grace') AND (s.expires_at='' OR s.expires_at IS NULL OR s.expires_at>=?)",
    )
    .get(tenant, user, now.toISOString().slice(0, 10)));
}
export async function runTaskScheduler({
  d = database(),
  now = new Date(),
  heartbeat = true,
} = {}) {
  if (heartbeat)
    await d
      .prepare(
        "INSERT INTO task_scheduler_heartbeat(id,heartbeat) VALUES('main',?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat",
      )
      .run(now.toISOString());
  const series = await d
    .prepare(
      "SELECT id FROM task_recurrences WHERE status='active' AND next_day<=? ORDER BY next_day",
    )
    .all(new Date(now.getTime() + 86400000).toISOString().slice(0, 10));
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
      if (occurrence.day) {
        const t = await d
          .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=?")
          .get(s.template_task_id, s.tenant_id);
        if (!t) return;
        const taskId = randomUUID(),
          claim = await d
            .prepare(
              "INSERT INTO task_occurrences(series_id,day) VALUES(?,?) ON CONFLICT DO NOTHING",
            )
            .run(id, occurrence.day);
        if (claim.changes) {
          await d
            .prepare(
              "INSERT INTO tasks(id,tenant_id,person_id,title,important,urgent,due_date,assignee,last_actor_id,project_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              taskId,
              s.tenant_id,
              t.person_id,
              t.title,
              t.important,
              t.urgent,
              occurrence.day,
              t.assignee,
              s.user_id,
              t.project_id,
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
            .run(taskId, id, occurrence.day);
          // Catch-up creates just the latest occurrence, with a reminder due now.
          await d
            .prepare(
              "INSERT INTO task_reminders(id,tenant_id,user_id,task_id,remind_at,timezone) VALUES(?,?,?,?,?,?)",
            )
            .run(
              randomUUID(),
              s.tenant_id,
              s.user_id,
              taskId,
              now.toISOString(),
              s.timezone,
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
          "SELECT count(*) AS n FROM task_reminder_events WHERE tenant_id=? AND user_id=? AND event='notified' AND timezone(?,created_at)::date=?::date",
        )
        .get(tenant, user, prefs.timezone, today);
      let budget = prefs.daily_limit - Number(count.n);
      if (budget <= 0) return;
      const reminders = await d
        .prepare(
          "SELECT r.*,n.notified_at,n.nudge_count FROM task_reminders r JOIN tasks t ON t.id=r.task_id AND t.tenant_id=r.tenant_id LEFT JOIN task_followup_notifications n ON n.reminder_id=r.id WHERE r.tenant_id=? AND r.user_id=? AND r.status='scheduled' AND r.remind_at<=? AND t.stage!='Done' AND (n.reminder_id IS NULL OR (? > 0 AND n.notified_at <= ?::timestamptz - (? * interval '1 minute'))) ORDER BY r.remind_at LIMIT 100",
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
        if (budget <= 0) break;
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
        budget--;
        notified++;
      }
    });
  }
  return { created, notified };
}
