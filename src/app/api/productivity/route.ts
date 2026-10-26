import { actor, isStaff } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { db } from "@/lib/db";
import { z } from "zod";
export async function GET(req: Request) {
  try {
    const a = await actor();
    if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const u = new URL(req.url),
      zone = u.searchParams.get("timezone") || "Asia/Karachi";
    new Intl.DateTimeFormat("en", { timeZone: zone });
    const start = z.iso.date().parse(u.searchParams.get("start")),
      end = z.iso.date().parse(u.searchParams.get("end"));
    if (start > end || Date.parse(end) - Date.parse(start) > 365 * 86400000)
      return Response.json(
        { error: "Choose a range of up to 366 days." },
        { status: 400 },
      );
    const d = db();
    const summary = await d
      .prepare(
        "SELECT count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND r.track_occurrences))::int AS total,count(*) FILTER(WHERE stage='Done' AND NOT EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND r.track_occurrences))::int AS done,count(*) FILTER(WHERE stage<>'Done' AND NOT EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND r.track_occurrences))::int AS pending,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM task_recurrences r WHERE r.template_task_id=t.id AND NOT r.track_occurrences) OR EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=t.id))::int AS repeating FROM tasks t WHERE tenant_id=? AND storage_state='active'",
      )
      .get(a.tenantId);
    const daily = (
      await d.query(
        `WITH days AS(SELECT v::date AS day FROM generate_series($1::date,$2::date,interval '1 day')v) SELECT to_char(day,'YYYY-MM-DD') AS day,COALESCE(sum(GREATEST(0,extract(epoch FROM LEAST(COALESCE(i.ended_at,now()),(day+1)::timestamp AT TIME ZONE $3)-GREATEST(i.started_at,day::timestamp AT TIME ZONE $3)))) FILTER(WHERE i.id IS NOT NULL),0)::float8 AS seconds FROM days LEFT JOIN focus_work_intervals i ON i.tenant_id=$4 AND i.user_id=$5 AND i.started_at<(day+1)::timestamp AT TIME ZONE $3 AND COALESCE(i.ended_at,now())>day::timestamp AT TIME ZONE $3 GROUP BY day ORDER BY day`,
        [start, end, zone, a.tenantId, a.id],
      )
    ).rows;
    const buckets =
      start === end
        ? (
            await d.query(
              `WITH hours AS(SELECT h AS at FROM generate_series($1::date::timestamp AT TIME ZONE $2,(($1::date+1)::timestamp AT TIME ZONE $2)-interval '1 hour',interval '1 hour')h) SELECT to_char(at AT TIME ZONE $2,'HH24:MI') AS label,at::text AS day,COALESCE(sum(GREATEST(0,extract(epoch FROM LEAST(COALESCE(i.ended_at,now()),at+interval '1 hour')-GREATEST(i.started_at,at)))) FILTER(WHERE i.id IS NOT NULL),0)::float8 AS seconds FROM hours LEFT JOIN focus_work_intervals i ON i.tenant_id=$3 AND i.user_id=$4 AND i.started_at<at+interval '1 hour' AND COALESCE(i.ended_at,now())>at GROUP BY at ORDER BY at`,
              [start, zone, a.tenantId, a.id],
            )
          ).rows
        : daily.map((d) => ({ ...d, label: d.day.slice(5) }));
    const completed = (
      await d.query(
        `SELECT DISTINCT ON(e.task_id) e.task_id,e.title,e.created_at,e.project_title,EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=e.task_id) AS repeating FROM task_events e WHERE e.tenant_id=$1 AND e.event='completed' AND (e.created_at::timestamptz AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date ORDER BY e.task_id,e.created_at DESC`,
        [a.tenantId, zone, start, end],
      )
    ).rows.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
    const timings = (
      await d.query(
        `SELECT f.task_id,t.title,t.stage,min(f.started_at) AS started_at,max(f.ended_at) AS ended_at,bool_or(f.running_since IS NOT NULL) AS running,sum(f.elapsed_seconds+CASE WHEN f.running_since IS NULL THEN 0 ELSE greatest(0,extract(epoch FROM now()-f.running_since)) END)::float8 AS seconds FROM focus_sessions f JOIN tasks t ON t.id=f.task_id AND t.tenant_id=f.tenant_id WHERE f.tenant_id=$1 AND f.user_id=$2 GROUP BY f.task_id,t.title,t.stage ORDER BY seconds DESC`,
        [a.tenantId, a.id],
      )
    ).rows;
    const projectValues = (
      await d.query(
        `SELECT DISTINCT ON(f.currency,f.basis) p.id,p.title,f.currency,f.basis,(f.upfront+f.completion+f.conditional) AS amount FROM plan_financial_targets f JOIN projects p ON p.id=f.entity_id AND p.tenant_id=f.tenant_id WHERE f.tenant_id=$1 AND f.entity_type='project' AND p.status<>'Archived' AND f.upfront+f.completion+f.conditional>0 ORDER BY f.currency,f.basis,amount DESC,p.id`,
        [a.tenantId],
      )
    ).rows;
    const taskValues = (
      await d.query(
        `SELECT DISTINCT ON(value_currency) id,title,value_currency AS currency,value_minor AS amount FROM tasks WHERE tenant_id=$1 AND storage_state='active' AND value_type='profit' AND value_minor>0 ORDER BY value_currency,value_minor DESC,id`,
        [a.tenantId],
      )
    ).rows;
    return Response.json(
      {
        summary,
        daily,
        buckets,
        completed,
        timings,
        longest: timings.find((t) => t.seconds > 0) || null,
        fastest:
          timings
            .filter((t) => t.stage === "Done" && t.seconds > 0)
            .sort((x, y) => x.seconds - y.seconds)[0] || null,
        projectValues,
        taskValues,
        timezone: zone,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Unable to load productivity. Check the date range and timezone.",
      },
      { status: 400 },
    );
  }
}
