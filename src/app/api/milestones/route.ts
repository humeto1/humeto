import { actor, isStaff, ensureOrigin, canMutate } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { db, withTransaction, audit } from "@/lib/db";
import { z } from "zod";
const parentInput = z.object({
  type: z.enum(["project", "goal"]),
  parentId: z.string().min(1).max(100),
});
async function authorize() {
  const a = await actor();
  return a && isStaff(a) && (await hasFeature(a.tenantId, "tasks")) ? a : null;
}
export async function GET(req: Request) {
  const a = await authorize();
  if (!a) return Response.json({ error: "Not permitted." }, { status: 403 });
  const u = new URL(req.url),
    taskId = u.searchParams.get("taskId");
  if (taskId) {
    const task = await db()
      .prepare("SELECT id,title FROM tasks WHERE tenant_id=? AND id=?")
      .get(a.tenantId, taskId);
    if (!task)
      return Response.json({ error: "Task not found." }, { status: 404 });
    const timing = await db()
      .prepare(
        "SELECT min(started_at) AS started_at,CASE WHEN bool_or(ended_at IS NULL) THEN NULL ELSE max(ended_at) END AS ended_at,sum(elapsed_seconds+CASE WHEN running_since IS NULL THEN 0 ELSE GREATEST(0,extract(epoch FROM now()-running_since)) END)::float8 AS seconds FROM focus_sessions WHERE tenant_id=? AND user_id=? AND task_id=?",
      )
      .get(a.tenantId, a.id, taskId);
    const links = await db()
      .prepare(
        "SELECT m.id,m.title,m.status FROM milestone_tasks l JOIN plan_milestones m ON m.id=l.milestone_id WHERE l.task_id=? AND m.tenant_id=?",
      )
      .all(taskId, a.tenantId);
    return Response.json(
      { timing, links },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const v = parentInput.safeParse({
    type: u.searchParams.get("type"),
    parentId: u.searchParams.get("parentId"),
  });
  if (!v.success)
    return Response.json(
      { error: "Choose a project or goal." },
      { status: 400 },
    );
  const { type, parentId } = v.data,
    table = type === "project" ? "projects" : "goals";
  const parent = await db()
    .prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND id=?`)
    .get(a.tenantId, parentId);
  if (!parent)
    return Response.json({ error: "Plan not found." }, { status: 404 });
  const tasks = await eligible(a.tenantId, type, parentId);
  const milestones = await db()
    .prepare(
      "SELECT m.*,COALESCE((SELECT json_agg(json_build_object('id',t.id,'title',t.title,'stage',t.stage)) FROM milestone_tasks l JOIN tasks t ON t.id=l.task_id AND t.tenant_id=m.tenant_id WHERE l.milestone_id=m.id),'[]'::json) AS tasks FROM plan_milestones m WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY created_at,id",
    )
    .all(a.tenantId, type, parentId);
  return Response.json(
    { parent, tasks, milestones },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
async function eligible(tenant: string, type: string, parentId: string) {
  return db()
    .prepare(
      `SELECT t.id,t.title,t.stage FROM tasks t WHERE t.tenant_id=? AND t.storage_state='active' AND ${type === "project" ? "t.project_id=?" : "(EXISTS(SELECT 1 FROM task_goals g WHERE g.task_id=t.id AND g.goal_id=?) OR EXISTS(SELECT 1 FROM projects p WHERE p.id=t.project_id AND p.goal_id=? AND p.tenant_id=t.tenant_id))"} ORDER BY t.title`,
    )
    .all(tenant, parentId, ...(type === "goal" ? [parentId] : []));
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await authorize();
    if (!a || !(await canMutate(a)))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const v = parentInput
      .extend({
        id: z.string().max(100).optional(),
        revision: z.number().int().positive().optional(),
        title: z.string().trim().min(2).max(160),
        targetDate: z.union([z.literal(""), z.iso.date()]).default(""),
        status: z.enum(["Pending", "Completed"]).default("Pending"),
        taskIds: z.array(z.string().max(100)).max(200).default([]),
      })
      .strict()
      .parse(await req.json());
    return await withTransaction(async () => {
      const table = v.type === "project" ? "projects" : "goals";
      const p = await db()
        .prepare(
          `SELECT id FROM ${table} WHERE tenant_id=? AND id=? FOR UPDATE`,
        )
        .get(a.tenantId, v.parentId);
      if (!p)
        return Response.json({ error: "Plan not found." }, { status: 404 });
      const tasks = await eligible(a.tenantId, v.type, v.parentId);
      if (v.taskIds.some((id) => !tasks.some((t) => t.id === id)))
        return Response.json(
          { error: "Choose tasks linked to this plan." },
          { status: 400 },
        );
      let mid = v.id;
      if (mid) {
        const result = await db()
          .prepare(
            "UPDATE plan_milestones SET title=?,target_date=?,status=?,completed_at=CASE WHEN ?='Completed' THEN COALESCE(completed_at,now()) ELSE NULL END,revision=revision+1 WHERE tenant_id=? AND entity_type=? AND entity_id=? AND id=? AND revision=?",
          )
          .run(
            v.title,
            v.targetDate,
            v.status,
            v.status,
            a.tenantId,
            v.type,
            v.parentId,
            mid,
            v.revision || 0,
          );
        if (!result.changes)
          return Response.json(
            { error: "Milestone changed. Reload first." },
            { status: 409 },
          );
      } else {
        const row = await db()
          .prepare(
            "INSERT INTO plan_milestones(tenant_id,entity_type,entity_id,title,target_date,status,completed_at) VALUES(?,?,?,?,?,?,CASE WHEN ?='Completed' THEN now() ELSE NULL END) RETURNING id",
          )
          .get(
            a.tenantId,
            v.type,
            v.parentId,
            v.title,
            v.targetDate,
            v.status,
            v.status,
          );
        mid = String(row!.id);
      }
      await db()
        .prepare("DELETE FROM milestone_tasks WHERE milestone_id=?")
        .run(mid);
      for (const tid of new Set(v.taskIds))
        await db()
          .prepare(
            "INSERT INTO milestone_tasks(milestone_id,task_id) VALUES(?,?)",
          )
          .run(mid, tid);
      await audit(
        a.tenantId,
        a.id,
        v.id ? "updated" : "created",
        "milestone",
        String(mid),
        v.title,
      );
      return Response.json({ id: mid });
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Check milestone details."
            : "Unable to save milestone.",
      },
      { status: e instanceof Error && e.message === "ORIGIN" ? 403 : 400 },
    );
  }
}
