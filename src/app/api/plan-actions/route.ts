import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { db, id, audit, withTransaction } from "@/lib/db";
import { z } from "zod";
const scope = z.object({
  type: z.enum(["project", "goal"]),
  planId: z.string().min(1).max(100),
});
const command = scope
  .extend({
    action: z.enum(["rename", "pause", "resume", "duplicate", "delete"]),
    revision: z.number().int().positive(),
    title: z.string().trim().min(2).max(160).optional(),
    deleteTasks: z.boolean().default(false),
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
function fail(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof Failure
          ? e.message
          : e instanceof z.ZodError
            ? "Check the project or goal details."
            : e instanceof Error && e.message === "ORIGIN"
              ? "Request origin is not permitted."
              : "Unable to update this plan.",
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
}
async function authorized() {
  const a = await actor();
  if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
    throw new Failure("Not permitted.", 403);
  return a;
}
async function getPlan(
  tenant: string,
  type: string,
  key: string,
  lock = false,
) {
  const p = await db()
    .prepare(
      `SELECT * FROM ${type === "project" ? "projects" : "goals"} WHERE tenant_id=? AND id=?${lock ? " FOR UPDATE" : ""}`,
    )
    .get(tenant, key);
  if (!p) throw new Failure("Project or goal not found.", 404);
  return p;
}
function relation(type: string) {
  return type === "project"
    ? "t.project_id=?"
    : "(EXISTS(SELECT 1 FROM task_goals l WHERE l.task_id=t.id AND l.tenant_id=t.tenant_id AND l.goal_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.tenant_id=t.tenant_id AND p.goal_id=?))";
}
function args(tenant: string, type: string, key: string) {
  return [tenant, key, ...(type === "goal" ? [key] : [])];
}
export async function GET(req: Request) {
  try {
    const a = await authorized(),
      u = new URL(req.url),
      v = scope.parse({
        type: u.searchParams.get("type"),
        planId: u.searchParams.get("planId"),
      });
    const plan = await getPlan(a.tenantId, v.type, v.planId);
    const count = await db()
      .prepare(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE t.storage_state='active')::int AS tasks FROM tasks t WHERE t.tenant_id=? AND ${relation(v.type)} AND t.storage_state IN ('active','planning')`,
      )
      .get(...args(a.tenantId, v.type, v.planId));
    return Response.json(
      { plan, counts: count },
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
    if (!(await canMutate(a))) throw new Failure("Read-only access.", 403);
    const v = command.parse(await req.json());
    return await withTransaction(async () => {
      const p = await getPlan(a.tenantId, v.type, v.planId, true),
        table = v.type === "project" ? "projects" : "goals";
      if (p.revision !== v.revision)
        throw new Failure("This plan changed. Reload before saving.", 409);
      let resultId = v.planId;
      if (v.action === "rename") {
        if (!v.title) throw new Failure("Enter a name.");
        await db()
          .prepare(
            `UPDATE ${table} SET title=?,revision=revision+1 WHERE id=? AND tenant_id=?`,
          )
          .run(v.title, v.planId, a.tenantId);
      }
      if (v.action === "pause" || v.action === "resume") {
        const expected = v.action === "pause" ? "Active" : "Paused";
        if (p.status !== expected)
          throw new Failure(
            `Only ${expected.toLowerCase()} plans can ${v.action}.`,
            409,
          );
        await db()
          .prepare(
            `UPDATE ${table} SET status=?,revision=revision+1 WHERE id=? AND tenant_id=?`,
          )
          .run(
            v.action === "pause" ? "Paused" : "Active",
            v.planId,
            a.tenantId,
          );
      }
      if (v.action === "duplicate") {
        if (!v.title) throw new Failure("Name the copy.");
        resultId = id();
        await db()
          .prepare(
            `INSERT INTO ${table}(id,tenant_id,title,description,target_date,status,created_by,category,${v.type === "project" ? "goal_id" : "success_metric"}) VALUES(?,?,?,?,?,'Active',?,?,?)`,
          )
          .run(
            resultId,
            a.tenantId,
            v.title,
            p.description,
            p.target_date,
            a.id,
            p.category,
            v.type === "project" ? p.goal_id : p.success_metric,
          );
        await db()
          .prepare(
            "SELECT project_id FROM project_wbs WHERE project_id=? AND tenant_id=? FOR UPDATE",
          )
          .get(v.planId, a.tenantId);
        const nodes = await db()
          .prepare(
            "SELECT n.* FROM project_wbs_nodes n JOIN tasks t ON t.id=n.id WHERE n.project_id=? AND t.tenant_id=? ORDER BY n.position,n.id FOR UPDATE OF n",
          )
          .all(v.planId, a.tenantId);
        const activities = await db()
          .prepare(
            `SELECT t.* FROM tasks t WHERE t.tenant_id=? AND t.storage_state IN ('active','planning') AND NOT EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=t.id) AND (${v.type === "project" ? "t.project_id=?" : "EXISTS(SELECT 1 FROM task_goals l WHERE l.task_id=t.id AND l.tenant_id=t.tenant_id AND l.goal_id=?)"} OR EXISTS(SELECT 1 FROM project_wbs_nodes n WHERE n.id=t.id AND n.project_id=?)) ORDER BY t.created_at,t.id FOR UPDATE`,
          )
          .all(a.tenantId, v.planId, v.planId);
        if (activities.length > 500)
          throw new Failure("A planning copy supports up to 500 activities.");
        const mapping = new Map(activities.map((t) => [String(t.id), id()]));
        await db()
          .prepare(
            "INSERT INTO project_wbs(project_id,tenant_id,entity_type) VALUES(?,?,?)",
          )
          .run(resultId, a.tenantId, v.type);
        for (const t of activities) {
          const copy = mapping.get(String(t.id))!;
          await db()
            .prepare(
              "INSERT INTO tasks(id,tenant_id,title,project_id,storage_state,category,important,urgent,due_date,work_kind,is_csf,is_kpi,activity_note,last_actor_id,value_type,value_minor,value_currency,value_note,value_timing,payment_pattern) VALUES(?,?,?,?,'planning',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              copy,
              a.tenantId,
              t.title,
              v.type === "project" ? resultId : "",
              t.category,
              t.important,
              t.urgent,
              t.due_date,
              t.work_kind,
              t.is_csf,
              t.is_kpi,
              t.activity_note,
              a.id,
              t.value_type,
              t.value_minor,
              t.value_currency,
              t.value_note,
              t.value_timing,
              t.payment_pattern,
            );
          await db()
            .prepare(
              "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) SELECT w.tenant_id,'task',?,w.user_id,? FROM work_assignments w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id WHERE w.tenant_id=? AND w.entity_type='task' AND w.entity_id=? AND m.role IN ('owner','consultant')",
            )
            .run(copy, a.id, a.tenantId, t.id);
          if (v.type === "goal")
            await db()
              .prepare(
                "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
              )
              .run(a.tenantId, copy, resultId);
          const r = await db()
            .prepare(
              "SELECT * FROM task_recurrences WHERE template_task_id=? AND tenant_id=? AND status IN ('active','paused') ORDER BY created_at DESC LIMIT 1",
            )
            .get(t.id, a.tenantId);
          if (r)
            await db()
              .prepare(
                "INSERT INTO task_recurrences(id,tenant_id,user_id,template_task_id,frequency,interval_count,first_day,next_day,end_day,local_time,timezone,status,track_occurrences,wbs_suspended) VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,TRUE)",
              )
              .run(
                id(),
                a.tenantId,
                a.id,
                copy,
                r.frequency,
                r.interval_count,
                r.first_day,
                r.first_day,
                r.end_day,
                r.local_time,
                r.timezone,
                r.track_occurrences,
              );
          const metrics = await db()
            .prepare(
              "SELECT * FROM activity_kpis WHERE activity_id=? AND archived=FALSE",
            )
            .all(t.id);
          for (const k of metrics)
            await db()
              .prepare(
                "INSERT INTO activity_kpis(id,activity_id,title,unit,target,cadence,direction,timezone) VALUES(?,?,?,?,?,?,?,?)",
              )
              .run(
                id(),
                copy,
                k.title,
                k.unit,
                k.target,
                k.cadence,
                k.direction,
                k.timezone,
              );
        }
        // Parents are inserted before children to retain the complete hierarchy.
        const remaining = new Map(activities.map((t) => [String(t.id), t]));
        let extra = nodes.reduce(
          (n, t) => Math.max(n, Number(t.position) + 1),
          0,
        );
        while (remaining.size) {
          let progress = false;
          for (const [source] of remaining) {
            const n = nodes.find((n) => n.id === source);
            if (n?.parent_id && remaining.has(String(n.parent_id))) continue;
            await db()
              .prepare(
                "INSERT INTO project_wbs_nodes(id,project_id,parent_id,position) VALUES(?,?,?,?)",
              )
              .run(
                mapping.get(source),
                resultId,
                n?.parent_id ? mapping.get(String(n.parent_id)) || null : null,
                n ? n.position : extra++,
              );
            remaining.delete(source);
            progress = true;
          }
          if (!progress)
            throw new Failure("Repair the source map before duplicating.");
        }
        await db()
          .prepare(
            "INSERT INTO plan_financial_targets(tenant_id,entity_type,entity_id,currency,upfront,completion,conditional,upfront_date,completion_date,conditional_date,condition,basis) SELECT tenant_id,entity_type,?,currency,upfront,completion,conditional,upfront_date,completion_date,conditional_date,condition,basis FROM plan_financial_targets WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .run(resultId, a.tenantId, v.type, v.planId);
        await db()
          .prepare(
            "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) SELECT w.tenant_id,w.entity_type,?,w.user_id,? FROM work_assignments w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id WHERE w.tenant_id=? AND w.entity_type=? AND w.entity_id=? AND m.role IN ('owner','consultant')",
          )
          .run(resultId, a.id, a.tenantId, v.type, v.planId);
        const milestones = await db()
          .prepare(
            "SELECT * FROM plan_milestones WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .all(a.tenantId, v.type, v.planId);
        for (const m of milestones) {
          const copy = id();
          await db()
            .prepare(
              "INSERT INTO plan_milestones(id,tenant_id,entity_type,entity_id,title,target_date) VALUES(?,?,?,?,?,?)",
            )
            .run(copy, a.tenantId, v.type, resultId, m.title, m.target_date);
          const links = await db()
            .prepare("SELECT task_id FROM milestone_tasks WHERE milestone_id=?")
            .all(m.id);
          for (const l of links)
            if (mapping.has(String(l.task_id)))
              await db()
                .prepare(
                  "INSERT INTO milestone_tasks(milestone_id,task_id) VALUES(?,?)",
                )
                .run(copy, mapping.get(String(l.task_id)));
        }
      }
      if (v.action === "delete") {
        if (p.status === "Paused")
          await db()
            .prepare(
              `UPDATE ${table} SET status='Active' WHERE id=? AND tenant_id=?`,
            )
            .run(v.planId, a.tenantId);
        const own = await db()
          .prepare(
            `SELECT t.id,t.storage_state,t.project_id,EXISTS(SELECT 1 FROM project_wbs_nodes n WHERE n.id=t.id AND n.project_id=?) AS own_box FROM tasks t WHERE t.tenant_id=? AND ${relation(v.type)} AND t.storage_state IN ('active','planning') FOR UPDATE`,
          )
          .all(v.planId, ...args(a.tenantId, v.type, v.planId));
        const ids = own
          .filter(
            (t) =>
              v.deleteTasks ||
              (t.storage_state === "planning" &&
                (v.type === "project" || !t.project_id || t.own_box)),
          )
          .map((t) => String(t.id));
        // Keep task records and completion snapshots; detach the live relationships.
        if (v.type === "project" && !v.deleteTasks && p.goal_id)
          await db()
            .prepare(
              "INSERT INTO task_goals(tenant_id,task_id,goal_id) SELECT t.tenant_id,t.id,? FROM tasks t JOIN goals g ON g.id=? AND g.tenant_id=t.tenant_id WHERE t.tenant_id=? AND t.project_id=? AND t.storage_state='active' ON CONFLICT DO NOTHING",
            )
            .run(p.goal_id, p.goal_id, a.tenantId, v.planId);
        if (v.type === "project")
          await db()
            .prepare(
              "UPDATE tasks SET project_id='',last_actor_id=?,revision=revision+1 WHERE project_id=? AND tenant_id=? AND storage_state IN ('active','planning')",
            )
            .run(a.id, v.planId, a.tenantId);
        else {
          await db()
            .prepare("DELETE FROM task_goals WHERE goal_id=? AND tenant_id=?")
            .run(v.planId, a.tenantId);
          await db()
            .prepare(
              "UPDATE projects SET goal_id='',revision=revision+1 WHERE goal_id=? AND tenant_id=?",
            )
            .run(v.planId, a.tenantId);
        }
        if (ids.length)
          await db()
            .prepare(
              "UPDATE tasks SET storage_state=?,stored_at=humeto_action_time(),purge_after=CASE WHEN ? THEN humeto_action_time()+interval '30 days' ELSE NULL END,last_actor_id=?,revision=revision+1 WHERE tenant_id=? AND id=ANY(?::text[])",
            )
            .run(
              v.deleteTasks ? "bin" : "archive",
              v.deleteTasks,
              a.id,
              a.tenantId,
              ids,
            );
        await db()
          .prepare(
            "DELETE FROM plan_milestones WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .run(a.tenantId, v.type, v.planId);
        await db()
          .prepare(
            "DELETE FROM plan_financial_targets WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .run(a.tenantId, v.type, v.planId);
        await db()
          .prepare(
            "DELETE FROM work_assignments WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .run(a.tenantId, v.type, v.planId);
        await db()
          .prepare(
            "DELETE FROM assignment_revisions WHERE tenant_id=? AND entity_type=? AND entity_id=?",
          )
          .run(a.tenantId, v.type, v.planId);
        await db()
          .prepare(`DELETE FROM ${table} WHERE id=? AND tenant_id=?`)
          .run(v.planId, a.tenantId);
      }
      await audit(
        a.tenantId,
        a.id,
        v.action,
        v.type,
        v.planId,
        v.action === "duplicate"
          ? `Copied planning setup to ${resultId}`
          : `Plan ${v.action}`,
      );
      return Response.json({ id: resultId, ok: true });
    });
  } catch (e) {
    return fail(e);
  }
}
