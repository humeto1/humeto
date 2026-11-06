import "server-only";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import type { Actor } from "./types";
import { descendants, type WbsNode } from "../../shared/wbs-model";

export class WbsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const key = z.string().min(1).max(100);
const input = z
  .object({
    projectId: key,
    type: z.enum(["project", "goal"]).default("project"),
    isCsf: z.boolean().optional(),
    isKpi: z.boolean().optional(),
    activityNote: z.string().trim().max(1000).optional(),
    revision: z.number().int().positive(),
    action: z.enum(["add", "edit", "select", "move", "link", "remove"]),
    id: key.optional(),
    taskRevision: z.number().int().positive().optional(),
    parentId: key.nullable().optional(),
    titles: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(40)
      .optional(),
    title: z.string().trim().min(1).max(200).optional(),
    selected: z.boolean().optional(),
    beforeId: key.nullable().optional(),
    frequency: z
      .enum(["once", "daily", "weekdays", "weekly", "monthly", "yearly"])
      .optional(),
    firstDay: z.iso.date().optional(),
    timezone: z.string().max(100).optional(),
    dueDate: z.union([z.literal(""), z.iso.date()]).optional(),
    stage: z.enum(["To do", "In progress", "Review", "Done"]).optional(),
  })
  .strict();
async function project(tenant: string, projectId: string, type = "project") {
  const p = await db()
    .prepare(
      `SELECT id,title FROM ${type === "goal" ? "goals" : "projects"} WHERE id=? AND tenant_id=?`,
    )
    .get(projectId, tenant);
  if (!p) throw new WbsError("Project not found.", 404);
  return p;
}
export async function readWbs(
  tenant: string,
  projectId: string,
  type = "project",
) {
  const p = await project(tenant, projectId, type);
  const state = await db()
    .prepare(
      "SELECT revision FROM project_wbs WHERE project_id=? AND tenant_id=?",
    )
    .get(projectId, tenant);
  const nodes = (await db()
    .prepare(
      `SELECT n.*,t.title,t.stage,t.storage_state,t.revision,t.due_date,t.is_csf,t.is_kpi,t.activity_note,
    r.id AS series_id,r.frequency,r.first_day FROM project_wbs_nodes n
    JOIN tasks t ON t.id=n.id AND t.tenant_id=?
    LEFT JOIN LATERAL (SELECT id,frequency,first_day FROM task_recurrences WHERE template_task_id=t.id AND tenant_id=t.tenant_id ORDER BY CASE WHEN status IN ('active','paused') THEN 0 ELSE 1 END,created_at DESC LIMIT 1) r ON TRUE
    WHERE n.project_id=? ORDER BY n.position,n.id`,
    )
    .all(tenant, projectId)) as unknown as WbsNode[];
  const available = await db()
    .prepare(
      `SELECT t.id,t.title FROM tasks t WHERE t.tenant_id=? AND ${type === "project" ? "t.project_id=?" : "EXISTS(SELECT 1 FROM task_goals g WHERE g.task_id=t.id AND g.tenant_id=t.tenant_id AND g.goal_id=?)"} AND t.storage_state IN ('active','planning')
    AND NOT EXISTS(SELECT 1 FROM project_wbs_nodes n WHERE n.id=t.id)
    AND NOT EXISTS(SELECT 1 FROM task_occurrences o WHERE o.task_id=t.id)
    ORDER BY t.title LIMIT 500`,
    )
    .all(tenant, projectId);
  return {
    project: p,
    revision: Number(state?.revision || 1),
    nodes,
    available,
  };
}
export async function writeWbs(a: Actor, body: unknown) {
  const v = input.parse(body);
  return withTransaction(async () => {
    await project(a.tenantId, v.projectId, v.type);
    await db()
      .prepare(
        "INSERT INTO project_wbs(project_id,tenant_id,entity_type) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(v.projectId, a.tenantId, v.type);
    const state = await db()
      .prepare(
        "SELECT revision FROM project_wbs WHERE project_id=? AND tenant_id=? FOR UPDATE",
      )
      .get(v.projectId, a.tenantId);
    if (Number(state?.revision) !== v.revision)
      throw new WbsError(
        "This project changed elsewhere. Reload the tree before saving.",
        409,
      );
    const { nodes } = await readWbs(a.tenantId, v.projectId, v.type);
    const node = nodes.find((n) => n.id === v.id);
    if (!["add", "link"].includes(v.action) && !node)
      throw new WbsError("Activity not found.", 404);
    if (v.parentId && !nodes.some((n) => n.id === v.parentId))
      throw new WbsError("Choose a parent in this project.");
    if (node && v.parentId && descendants(nodes, node.id).has(v.parentId))
      throw new WbsError("An activity cannot be placed inside its own branch.");
    if (
      node &&
      ["edit", "select"].includes(v.action) &&
      node.revision !== v.taskRevision
    )
      throw new WbsError(
        "This activity changed elsewhere. Reload before saving.",
        409,
      );
    const parent = v.parentId ?? null;
    // Keep depth bounded for readable navigation and to reject pathological trees.
    if (v.action === "add" || v.action === "link" || v.action === "move") {
      let at = parent,
        depth = 0;
      while (at) {
        if (++depth > 20)
          throw new WbsError("Use a shallower branch (maximum 20 levels).");
        at = nodes.find((n) => n.id === at)?.parent_id ?? null;
      }
    }
    let changedId = v.id;
    const position = nodes
      .filter((n) => n.parent_id === parent)
      .reduce((m, n) => Math.max(m, n.position + 1), 0);
    if (v.action === "add") {
      if (!v.titles) throw new WbsError("Enter at least one activity.");
      if (nodes.length + v.titles.length > 500)
        throw new WbsError("This project supports up to 500 activities.");
      for (const [index, title] of v.titles.entries()) {
        const tid = id();
        changedId = tid;
        await db()
          .prepare(
            "INSERT INTO tasks(id,tenant_id,title,project_id,storage_state,last_actor_id) VALUES(?,?,?,?,'planning',?)",
          )
          .run(
            tid,
            a.tenantId,
            title,
            v.type === "project" ? v.projectId : "",
            a.id,
          );
        if (v.type === "goal")
          await db()
            .prepare(
              "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
            )
            .run(a.tenantId, tid, v.projectId);
        await db()
          .prepare(
            "INSERT INTO project_wbs_nodes(id,project_id,parent_id,position) VALUES(?,?,?,?)",
          )
          .run(tid, v.projectId, parent, position + index);
      }
    }
    if (v.action === "link") {
      if (nodes.length >= 500)
        throw new WbsError("This project supports up to 500 activities.");
      const t = await db()
        .prepare(
          `SELECT id FROM tasks WHERE id=? AND tenant_id=? AND ${v.type === "project" ? "project_id=?" : "EXISTS(SELECT 1 FROM task_goals g WHERE g.task_id=tasks.id AND g.tenant_id=tasks.tenant_id AND g.goal_id=?)"} AND storage_state IN ('active','planning') AND NOT EXISTS(SELECT 1 FROM task_occurrences WHERE task_id=tasks.id) FOR UPDATE`,
        )
        .get(v.id || "", a.tenantId, v.projectId);
      if (!t) throw new WbsError("Choose an existing task from this project.");
      await db()
        .prepare(
          "INSERT INTO project_wbs_nodes(id,project_id,parent_id,position) VALUES(?,?,?,?)",
        )
        .run(v.id, v.projectId, parent, position);
    }
    if (v.action === "move") {
      const siblings = nodes
        .filter((n) => n.parent_id === parent && n.id !== v.id)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      const before = v.beforeId
        ? siblings.findIndex((n) => n.id === v.beforeId)
        : siblings.length;
      if (before < 0)
        throw new WbsError("Choose a sibling in the destination branch.");
      siblings.splice(before, 0, node!);
      for (const [index, n] of siblings.entries())
        await db()
          .prepare(
            "UPDATE project_wbs_nodes SET parent_id=?,position=? WHERE id=? AND project_id=?",
          )
          .run(parent, index, n.id, v.projectId);
    }
    if (v.action === "select") {
      if (v.selected === undefined)
        throw new WbsError("Choose whether to add this activity to Tasks.");
      // Lock recurrence first, matching scheduler lock order, then all occurrences.
      const series = await db()
        .prepare(
          "SELECT id FROM task_recurrences WHERE template_task_id=? AND tenant_id=? FOR UPDATE",
        )
        .all(v.id, a.tenantId);
      const t = await db()
        .prepare(
          "SELECT storage_state,revision FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE",
        )
        .get(v.id, a.tenantId);
      if (t && Number(t.revision) !== v.taskRevision)
        throw new WbsError(
          "This activity changed elsewhere. Reload before saving.",
          409,
        );
      if (!["planning", "active"].includes(String(t?.storage_state)))
        throw new WbsError(
          "Restore this activity from Archive or Bin first.",
          409,
        );
      if (!v.selected) {
        const active = await db()
          .prepare(
            `SELECT id FROM focus_sessions WHERE tenant_id=? AND ended_at IS NULL AND (task_id=? OR task_id IN(SELECT o.task_id FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id WHERE r.template_task_id=? AND r.tenant_id=?)) LIMIT 1`,
          )
          .get(a.tenantId, v.id, v.id, a.tenantId);
        if (active)
          throw new WbsError(
            "End the active focus session before removing this activity from Tasks.",
            409,
          );
      }
      const state = v.selected ? "active" : "planning",
        previous = v.selected ? "planning" : "active";
      await db()
        .prepare(
          "UPDATE tasks SET storage_state=?,revision=revision+1,last_actor_id=? WHERE id=? AND tenant_id=? AND storage_state=?",
        )
        .run(state, a.id, v.id, a.tenantId, previous);
      for (const s of series)
        await db()
          .prepare(
            "UPDATE tasks SET storage_state=?,revision=revision+1,last_actor_id=? WHERE tenant_id=? AND storage_state=? AND id IN(SELECT task_id FROM task_occurrences WHERE series_id=?)",
          )
          .run(state, a.id, a.tenantId, previous, s.id);
    }
    if (v.action === "edit") {
      if (!v.title) throw new WbsError("Enter an activity name.");
      // Lock series before task (the same order as selection and scheduling).
      const series = await db()
        .prepare(
          "SELECT * FROM task_recurrences WHERE template_task_id=? AND tenant_id=? ORDER BY CASE WHEN status IN ('active','paused') THEN 0 ELSE 1 END,created_at DESC LIMIT 1 FOR UPDATE",
        )
        .get(v.id, a.tenantId);
      const t = await db()
        .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(v.id, a.tenantId);
      if (t && Number(t.revision) !== v.taskRevision)
        throw new WbsError(
          "This activity changed elsewhere. Reload before saving.",
          409,
        );
      if (!t || !["active", "planning"].includes(String(t.storage_state)))
        throw new WbsError(
          "Restore this activity from Archive or Bin first.",
          409,
        );
      const frequency =
        v.frequency ?? (series ? String(series.frequency) : "once");
      if (series && frequency !== series.frequency)
        throw new WbsError(
          "Change an existing repeat schedule from task scheduling to preserve its occurrence history.",
        );
      if (frequency !== "once" && !series) {
        if (!v.firstDay || !v.timezone)
          throw new WbsError(
            "Choose a start date for this repeating activity.",
          );
        try {
          new Intl.DateTimeFormat("en", { timeZone: v.timezone }).format();
        } catch {
          throw new WbsError("Choose a valid timezone.");
        }
        await db()
          .prepare(
            `INSERT INTO task_recurrences(id,tenant_id,user_id,template_task_id,frequency,interval_count,first_day,next_day,local_time,timezone,track_occurrences,wbs_suspended) VALUES(?,?,?,?,?,1,?,?,'00:00',?,TRUE,?)`,
          )
          .run(
            id(),
            a.tenantId,
            a.id,
            v.id,
            frequency,
            v.firstDay,
            v.firstDay,
            v.timezone,
            t.storage_state === "planning",
          );
      }
      if (frequency !== "once" && v.stage === "Done")
        throw new WbsError(
          "Complete individual occurrences in Tasks; the repeating activity stays open.",
        );
      await db()
        .prepare(
          "UPDATE tasks SET title=?,due_date=?,stage=?,work_kind=?,is_csf=?,is_kpi=?,activity_note=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
        )
        .run(
          v.title,
          v.dueDate ?? t.due_date,
          v.stage ?? t.stage,
          frequency === "once" ? "one_off" : "routine",
          v.isCsf ?? t.is_csf,
          v.isKpi ?? t.is_kpi,
          v.activityNote ?? t.activity_note,
          a.id,
          v.id,
          a.tenantId,
        );
    }
    if (v.action === "remove") {
      if (nodes.some((n) => n.parent_id === node!.id))
        throw new WbsError(
          "Move or remove the child activities before removing this category.",
        );
      // A category can be removed without deleting its record or its descendants.
      // Children move up one level; existing task/history records are untouched.
      if (node!.storage_state !== "planning")
        throw new WbsError(
          "Remove this activity from Tasks before removing its box.",
        );
      if (node!.series_id || node!.stage === "Done")
        throw new WbsError(
          "Keep completed or repeating activities in the WBS to preserve their context.",
        );
      await db()
        .prepare(
          "UPDATE project_wbs_nodes SET parent_id=? WHERE parent_id=? AND project_id=?",
        )
        .run(node!.parent_id, v.id, v.projectId);
      await db()
        .prepare("DELETE FROM project_wbs_nodes WHERE id=? AND project_id=?")
        .run(v.id, v.projectId);
    }
    await db()
      .prepare(
        "UPDATE project_wbs SET revision=revision+1 WHERE project_id=? AND tenant_id=?",
      )
      .run(v.projectId, a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      v.action,
      "project_wbs",
      v.projectId,
      "Updated project breakdown",
    );
    return { ok: true, id: changedId, revision: v.revision + 1 };
  });
}
