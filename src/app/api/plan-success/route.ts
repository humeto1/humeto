import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { db, withTransaction, audit, id } from "@/lib/db";
import { z } from "zod";
import { kpiPeriod, type KpiCadence } from "../../../../shared/kpi-period";
const key = z.string().min(1).max(100),
  revision = z.number().int().nonnegative();
const scope = z.object({
  type: z.enum(["project", "goal", "activity"]),
  parentId: key,
});
const command = scope
  .extend({
    action: z.enum(["activity", "kpi", "result"]),
    id: key.optional(),
    revision,
    kpiRevision: revision.optional(),
    activityId: key.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(1000).optional(),
    isCsf: z.boolean().optional(),
    isKpi: z.boolean().optional(),
    target: z.number().finite().min(0).max(1e12).optional(),
    unit: z.string().trim().max(40).optional(),
    cadence: z
      .enum([
        "once",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "half_year",
        "yearly",
      ])
      .optional(),
    direction: z.enum(["at_least", "at_most"]).optional(),
    timezone: z.string().max(100).optional(),
    archived: z.boolean().optional(),
    day: z.iso.date().optional(),
    entryMode: z.enum(["current", "dated"]).optional(),
    actual: z.number().finite().min(0).max(1e12).optional(),
  })
  .strict();
class Failure extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const fail = (e: unknown) =>
  Response.json(
    {
      error:
        e instanceof Failure
          ? e.message
          : e instanceof z.ZodError
            ? "Check the activity or measurement details."
            : e instanceof Error && e.message === "ORIGIN"
              ? "Request origin is not permitted."
              : "Unable to save activity measures.",
    },
    {
      status:
        e instanceof Failure
          ? e.status
          : e instanceof Error && e.message === "ORIGIN"
            ? 403
            : 400,
    },
  );
async function authorized() {
  const a = await actor();
  return a && isStaff(a) && (await hasFeature(a.tenantId, "tasks")) ? a : null;
}
async function parent(
  tenant: string,
  type: string,
  parentId: string,
  lock = false,
) {
  if (type === "activity") {
    const supplied = await db()
      .prepare(
        "SELECT t.id,COALESCE((SELECT r.template_task_id FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id AND r.tenant_id=t.tenant_id WHERE o.task_id=t.id),t.id) AS canonical FROM tasks t WHERE t.tenant_id=? AND t.id=? AND t.storage_state IN ('active','planning')",
      )
      .get(tenant, parentId);
    if (!supplied) throw new Failure("Activity not found.", 404);
    const canonical = await db()
      .prepare(
        `SELECT id,title FROM tasks WHERE tenant_id=? AND id=? AND storage_state IN ('active','planning')${lock ? " FOR UPDATE" : ""}`,
      )
      .get(tenant, supplied.canonical);
    if (!canonical) throw new Failure("Restore this activity first.", 404);
    return canonical;
  }
  const p = await db()
    .prepare(
      `SELECT id,title FROM ${type === "project" ? "projects" : "goals"} WHERE tenant_id=? AND id=?${lock ? " FOR UPDATE" : ""}`,
    )
    .get(tenant, parentId);
  if (!p) throw new Failure("Plan not found.", 404);
  return p;
}
function relation(type: string) {
  return type === "activity"
    ? "t.id=?"
    : type === "project"
      ? "t.project_id=?"
      : `(EXISTS(SELECT 1 FROM task_goals g WHERE g.tenant_id=t.tenant_id AND g.task_id=t.id AND g.goal_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.tenant_id=t.tenant_id AND p.goal_id=?))`;
}
function params(tenant: string, type: string, parentId: string) {
  return [tenant, parentId, ...(type === "goal" ? [parentId] : [])];
}
function localDay(zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const resultColumns =
  "r.kpi_id,to_char(r.period_start,'YYYY-MM-DD') AS period_start,to_char(r.period_end,'YYYY-MM-DD') AS period_end,r.actual,r.target_snapshot,r.unit_snapshot,r.cadence_snapshot,r.direction_snapshot,r.note,r.revision";
export async function GET(req: Request) {
  try {
    const a = await authorized();
    if (!a) throw new Failure("Not permitted.", 403);
    const u = new URL(req.url),
      v = scope.parse({
        type: u.searchParams.get("type"),
        parentId: u.searchParams.get("parentId"),
      });
    const p = await parent(a.tenantId, v.type, v.parentId);
    const parentId = String(p.id);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(u.searchParams.get("offset") || 0);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .parse(u.searchParams.get("limit") || 12);
    const selectedDay = u.searchParams.has("day")
      ? z.iso.date().parse(u.searchParams.get("day"))
      : undefined;
    const metricId = u.searchParams.has("kpiId")
      ? key.parse(u.searchParams.get("kpiId"))
      : undefined;
    const activities = await db()
      .prepare(
        `SELECT t.id,t.title,t.stage,humeto_task_plan_paused(t.id) AS is_plan_paused,t.storage_state,t.is_csf,t.is_kpi,t.activity_note,t.revision,t.project_id,r.frequency FROM tasks t LEFT JOIN LATERAL (SELECT frequency FROM task_recurrences WHERE template_task_id=t.id AND tenant_id=t.tenant_id ORDER BY created_at DESC LIMIT 1) r ON TRUE WHERE t.tenant_id=? AND ${relation(v.type)} AND t.storage_state IN ('planning','active') AND NOT EXISTS(SELECT 1 FROM task_occurrences WHERE task_id=t.id) ORDER BY t.created_at,t.id`,
      )
      .all(...params(a.tenantId, v.type, parentId));
    const kpis = await db()
      .prepare(
        `SELECT k.* FROM activity_kpis k JOIN tasks t ON t.id=k.activity_id WHERE t.tenant_id=? AND ${relation(v.type)} AND t.storage_state IN ('active','planning') ${metricId ? "AND k.id=?" : ""} ORDER BY k.created_at,k.id`,
      )
      .all(
        ...params(a.tenantId, v.type, parentId),
        ...(metricId ? [metricId] : []),
      );
    const ids = kpis.map((k) => String(k.id));
    const periods = kpis.map((k) => {
      const today = localDay(String(k.timezone)),
        day = selectedDay || today;
      return {
        kpi_id: k.id,
        day,
        today,
        ...kpiPeriod(k.cadence as KpiCadence, day),
        cadence: k.cadence,
      };
    });
    const history = ids.length
      ? await db()
          .prepare(
            `SELECT ${resultColumns} FROM activity_kpis k JOIN LATERAL (SELECT * FROM plan_kpi_results WHERE kpi_id=k.id ORDER BY period_start DESC OFFSET ? LIMIT ?) r ON TRUE WHERE k.id=ANY(?::text[]) ORDER BY r.period_start DESC`,
          )
          .all(offset, limit, ids)
      : [];
    const current = ids.length
      ? await db()
          .prepare(
            `SELECT ${resultColumns} FROM plan_kpi_results r JOIN jsonb_to_recordset(?::jsonb) AS wanted(kpi_id text,start date,cadence text) ON r.kpi_id=wanted.kpi_id AND r.period_start=wanted.start AND r.cadence_snapshot=wanted.cadence`,
          )
          .all(JSON.stringify(periods))
      : [];
    const totals = ids.length
      ? await db()
          .prepare(
            "SELECT kpi_id,count(*)::int AS n FROM plan_kpi_results WHERE kpi_id=ANY(?::text[]) GROUP BY kpi_id",
          )
          .all(ids)
      : [];
    const definitions = ids.length
      ? await db()
          .prepare(
            "SELECT wanted.kpi_id,v.target,v.unit,v.direction FROM jsonb_to_recordset(?::jsonb) AS wanted(kpi_id text,day date) JOIN LATERAL(SELECT target,unit,direction FROM activity_kpi_targets WHERE kpi_id=wanted.kpi_id AND effective_from<=wanted.day ORDER BY effective_from DESC LIMIT 1) v ON TRUE",
          )
          .all(JSON.stringify(periods))
      : [];
    return Response.json(
      {
        parent: p,
        activities,
        kpis: kpis.map((k, i) => {
          const period = periods[i],
            total = Number(totals.find((t) => t.kpi_id === k.id)?.n || 0);
          return {
            ...k,
            target: Number(k.target),
            today: period.today,
            day: period.day,
            period: {
              start: period.start,
              end: period.end,
              label: period.label,
            },
            periodTarget: definitions.find((d) => d.kpi_id === k.id) || {
              target: k.target,
              unit: k.unit,
              direction: k.direction,
            },
            current: current.find((r) => r.kpi_id === k.id) || null,
            history: history.filter((r) => r.kpi_id === k.id),
            historyTotal: total,
            historyOffset: offset,
            historyMore: offset + limit < total,
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await authorized();
    if (!a || !(await canMutate(a))) throw new Failure("Not permitted.", 403);
    const v = command.parse(await req.json());
    return await withTransaction(async () => {
      const plan = await parent(a.tenantId, v.type, v.parentId, true);
      const parentId = String(plan.id);
      if (v.type === "activity" && v.activityId && v.activityId !== parentId)
        throw new Failure("Choose this activity.", 404);
      let changed = v.id || id();
      if (v.action === "activity") {
        if (v.id) {
          const t = await db()
            .prepare(
              `SELECT t.id,t.revision FROM tasks t WHERE t.tenant_id=? AND ${relation(v.type)} AND t.id=? AND t.storage_state IN ('active','planning') FOR UPDATE`,
            )
            .get(...params(a.tenantId, v.type, parentId), v.id);
          if (!t) throw new Failure("Activity not found.", 404);
          if (t.revision !== v.revision)
            throw new Failure(
              "This activity changed. Reload before saving.",
              409,
            );
          await db()
            .prepare(
              "UPDATE tasks SET is_csf=?,is_kpi=?,activity_note=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
            )
            .run(
              v.isCsf ?? false,
              v.isKpi ?? false,
              v.note || "",
              a.id,
              v.id,
              a.tenantId,
            );
        } else {
          if (v.type === "activity")
            throw new Failure("Choose the existing activity.");
          if (!v.title || v.revision !== 0)
            throw new Failure("Name the activity.");
          await db()
            .prepare(
              "INSERT INTO tasks(id,tenant_id,title,project_id,storage_state,is_csf,is_kpi,activity_note,last_actor_id) VALUES(?,?,?,?,'planning',?,?,?,?)",
            )
            .run(
              changed,
              a.tenantId,
              v.title,
              v.type === "project" ? v.parentId : "",
              v.isCsf || false,
              v.isKpi || false,
              v.note || "",
              a.id,
            );
          if (v.type === "goal")
            await db()
              .prepare(
                "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
              )
              .run(a.tenantId, changed, v.parentId);
          await db()
            .prepare(
              "INSERT INTO project_wbs(project_id,tenant_id,entity_type) VALUES(?,?,?) ON CONFLICT DO NOTHING",
            )
            .run(v.parentId, a.tenantId, v.type);
          await db()
            .prepare(
              "SELECT project_id FROM project_wbs WHERE project_id=? FOR UPDATE",
            )
            .get(v.parentId);
          await db()
            .prepare(
              "INSERT INTO project_wbs_nodes(id,project_id,position) SELECT ?,?,COALESCE(max(position),0)+1 FROM project_wbs_nodes WHERE project_id=?",
            )
            .run(changed, v.parentId, v.parentId);
          await db()
            .prepare(
              "UPDATE project_wbs SET revision=revision+1 WHERE project_id=?",
            )
            .run(v.parentId);
        }
      } else {
        const t = await db()
          .prepare(
            `SELECT t.id,t.storage_state FROM tasks t WHERE t.tenant_id=? AND ${relation(v.type)} AND t.id=? AND t.storage_state IN ('active','planning') FOR UPDATE`,
          )
          .get(...params(a.tenantId, v.type, parentId), v.activityId || "");
        if (!t) throw new Failure("Choose an activity in this plan.", 404);
        if (v.action === "kpi") {
          if (!v.title || v.target === undefined || !v.cadence || !v.timezone)
            throw new Failure("Set a measurement name, target and period.");
          try {
            localDay(v.timezone);
          } catch {
            throw new Failure("Choose a valid timezone.");
          }
          if (v.id) {
            const existing = await db()
              .prepare(
                "SELECT cadence,timezone FROM activity_kpis WHERE id=? AND activity_id=?",
              )
              .get(v.id, t.id);
            if (
              existing &&
              (existing.cadence !== v.cadence ||
                existing.timezone !== v.timezone) &&
              (await db()
                .prepare(
                  "SELECT kpi_id FROM plan_kpi_results WHERE kpi_id=? LIMIT 1",
                )
                .get(v.id))
            )
              throw new Failure(
                "Keep the period and timezone of a measurement with history. Add another measurement for a new period.",
              );
            const r = await db()
              .prepare(
                "UPDATE activity_kpis SET title=?,unit=?,target=?,cadence=?,direction=?,timezone=?,archived=?,revision=revision+1 WHERE id=? AND activity_id=? AND revision=?",
              )
              .run(
                v.title,
                v.unit || "",
                v.target,
                v.cadence,
                v.direction || "at_least",
                v.timezone,
                v.archived || false,
                v.id,
                t.id,
                v.revision,
              );
            if (!r.changes)
              throw new Failure(
                "This measurement changed. Reload before saving.",
                409,
              );
          } else {
            if (v.revision !== 0)
              throw new Failure("Reload before adding a measurement.", 409);
            await db()
              .prepare(
                "INSERT INTO activity_kpis(id,activity_id,title,unit,target,cadence,direction,timezone) VALUES(?,?,?,?,?,?,?,?)",
              )
              .run(
                changed,
                t.id,
                v.title,
                v.unit || "",
                v.target,
                v.cadence,
                v.direction || "at_least",
                v.timezone,
              );
          }
          await db()
            .prepare(
              "UPDATE tasks SET is_kpi=TRUE,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
            )
            .run(a.id, t.id, a.tenantId);
        } else {
          if (!v.id || !v.day || v.actual === undefined)
            throw new Failure("Enter the measured total.");
          const k = await db()
            .prepare(
              "SELECT * FROM activity_kpis WHERE id=? AND activity_id=? AND archived=FALSE FOR UPDATE",
            )
            .get(v.id, t.id);
          if (!k) throw new Failure("Measurement not found.", 404);
          if (k.revision !== v.kpiRevision)
            throw new Failure(
              "This measurement changed. Reload before logging.",
              409,
            );
          if (
            v.entryMode === "current" &&
            v.day !== localDay(String(k.timezone))
          )
            throw new Failure(
              "The reporting date changed. Refresh and choose the date before saving.",
              409,
            );
          if (v.day > localDay(String(k.timezone)))
            throw new Failure("Log today or an earlier date.");
          const period = kpiPeriod(k.cadence as KpiCadence, v.day),
            existing = await db()
              .prepare(
                "SELECT revision FROM plan_kpi_results WHERE kpi_id=? AND period_start=? AND cadence_snapshot=?",
              )
              .get(v.id, period.start, k.cadence);
          if (Number(existing?.revision || 0) !== v.revision)
            throw new Failure(
              "This result changed. Reload before replacing its total.",
              409,
            );
          const definition = await db()
            .prepare(
              "SELECT target,unit,direction FROM activity_kpi_targets WHERE kpi_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1",
            )
            .get(k.id, v.day);
          await db()
            .prepare(
              `INSERT INTO plan_kpi_results(kpi_id,period_start,period_end,actual,target_snapshot,unit_snapshot,cadence_snapshot,direction_snapshot,note,recorded_by) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kpi_id,period_start,cadence_snapshot) DO UPDATE SET actual=excluded.actual,note=excluded.note,recorded_by=excluded.recorded_by,updated_at=now(),revision=plan_kpi_results.revision+1`,
            )
            .run(
              v.id,
              period.start,
              period.end,
              v.actual,
              definition?.target ?? k.target,
              definition?.unit ?? k.unit,
              k.cadence,
              definition?.direction ?? k.direction,
              v.note || "",
              a.id,
            );
        }
      }
      await audit(
        a.tenantId,
        a.id,
        v.action,
        "activity",
        changed,
        "Updated activity indicators",
      );
      return Response.json({ id: changed });
    });
  } catch (e) {
    return fail(e);
  }
}
