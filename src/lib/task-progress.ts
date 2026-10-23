import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, id, audit } from "./db";
import { canMutate, isStaff } from "./auth";
import { transaction } from "./crm";
import type { Actor, TaskEvent } from "./types";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const input = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().max(60).optional(),
  successMetric: z.string().trim().max(500).optional(),
  goalId: z.string().max(100).optional(),
  description: z.string().trim().max(2000).default(""),
  targetDate: z.union([z.literal(""), z.iso.date()]).default(""),
  status: z
    .enum(["Active", "Paused", "Completed", "Archived"])
    .default("Active"),
});
export async function progressRead(req: Request, parts: string[], a: Actor) {
  if (parts[0] !== "task-history") return null;
  if (!isStaff(a)) return fail("Task history is not permitted.", 403);
  const url = new URL(req.url),
    timezone = url.searchParams.get("timezone") || "Asia/Karachi",
    month = url.searchParams.get("month") || "";
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return fail("Choose a valid report month.");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    });
  } catch {
    return fail("Choose a valid timezone.");
  }
  // Compute date boundaries in the requested timezone, including DST; never use the server's local month.
  const localMonth = (iso: string) => {
    const p = formatter.formatToParts(new Date(iso));
    return (
      p.find((x) => x.type === "year")!.value +
      "-" +
      p.find((x) => x.type === "month")!.value
    );
  };
  const events = (
    await db()
      .prepare(
        "SELECT e.*,COALESCE(u.name,'System') AS actor_name,t.stage AS current_stage FROM task_events e JOIN tasks t ON t.id=e.task_id AND t.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=? ORDER BY e.created_at DESC,e._rowid DESC",
      )
      .all(a.tenantId)
  ).map((e) => ({
    ...e,
    goals: JSON.parse(String(e.goals_json)),
  })) as unknown as TaskEvent[];
  const selected = month
    ? events.filter((e) => localMonth(e.created_at) === month)
    : events;
  const unique = new Map<string, TaskEvent>();
  for (const e of selected)
    if (e.event === "completed" && !unique.has(e.task_id))
      unique.set(e.task_id, e);
  const completions = [...unique.values()];
  const group = (key: "projects" | "goals") => {
    const groups = new Map<
      string,
      {
        id: string;
        title: string;
        count: number;
        taskIds: string[];
      }
    >();
    for (const e of completions) {
      const refs =
        key === "projects"
          ? [
              {
                id: e.project_id,
                title: e.project_title || "No project at completion",
              },
            ]
          : e.goals;
      for (const ref of refs) {
        const g = groups.get(ref.id) || { ...ref, count: 0, taskIds: [] };
        g.count++;
        g.taskIds.push(e.task_id);
        groups.set(ref.id, g);
      }
    }
    return [...groups.values()];
  };
  return NextResponse.json({
    events: selected,
    completions,
    uniqueCompleted: completions.length,
    completionEvents: selected.filter((e) => e.event === "completed").length,
    reopenedEvents: selected.filter((e) => e.event === "reopened").length,
    projects: group("projects"),
    goals: group("goals"),
    timezone,
    month,
  });
}
export async function progressMutation(
  req: Request,
  parts: string[],
  a: Actor,
  body: unknown,
) {
  const [resource, rid] = parts;
  if (!["projects", "goals", "task-links"].includes(resource)) return null;
  if (!(await canMutate(a)))
    return fail("Task planning is not permitted.", 403);
  if (resource === "task-links" && req.method === "PATCH") {
    const v = z
      .object({
        revision: z.number().int().positive(),
        projectId: z.string().max(100).default(""),
        goalIds: z.array(z.string().max(100)).max(20).default([]),
      })
      .parse(body);
    return await transaction(async () => {
      const t = await db()
        .prepare("SELECT revision FROM tasks WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId);
      if (!t) return fail("Task not found.", 404);
      if (t.revision !== v.revision)
        return fail("Task changed elsewhere. Refresh and retry.", 409);
      if (
        v.projectId &&
        !(await db()
          .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
          .get(v.projectId, a.tenantId))
      )
        return fail("Project not found in this workspace.", 404);
      const goalIds = [...new Set(v.goalIds)];
      for (const gid of goalIds)
        if (
          !(await db()
            .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
            .get(gid, a.tenantId))
        )
          return fail("Goal not found in this workspace.", 404);
      await db()
        .prepare("DELETE FROM task_goals WHERE tenant_id=? AND task_id=?")
        .run(a.tenantId, rid);
      for (const gid of goalIds)
        await db()
          .prepare(
            "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
          )
          .run(a.tenantId, rid, gid);
      await db()
        .prepare(
          "UPDATE tasks SET project_id=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(v.projectId, a.id, rid, a.tenantId, v.revision);
      await audit(
        a.tenantId,
        a.id,
        "linked",
        "task",
        rid,
        "Updated project/goal links; previous completion snapshots retained",
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (["projects", "goals"].includes(resource)) {
    const plan = input.parse(body);
    if (
      resource === "projects" &&
      plan.goalId &&
      !(await db()
        .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
        .get(plan.goalId, a.tenantId))
    )
      return fail("Goal not found in this workspace.", 404);
    if (!rid && req.method === "POST") {
      if (resource === "goals" && !plan.targetDate)
        return fail("A goal needs a deadline. Choose a target date.");
      const v = input.parse(body);
      const uid = id();
      await db()
        .prepare(
          `INSERT INTO ${resource}(id,tenant_id,title,description,target_date,status,created_by) VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          uid,
          a.tenantId,
          v.title,
          v.description,
          v.targetDate,
          v.status,
          a.id,
        );
      await db()
        .prepare(
          `UPDATE ${resource} SET category=?${resource === "goals" ? ",success_metric=?" : ",goal_id=?"} WHERE id=? AND tenant_id=?`,
        )
        .run(
          v.category || (resource === "goals" ? "Personal" : "Work"),
          resource === "goals" ? v.successMetric || "" : v.goalId || "",
          uid,
          a.tenantId,
        );
      await audit(
        a.tenantId,
        a.id,
        "created",
        resource,
        uid,
        `Created ${resource === "projects" ? "project" : "goal"}: ${v.title}`,
      );
      return NextResponse.json({ id: uid });
    }
    if (rid && req.method === "PATCH") {
      const v = input
        .extend({ revision: z.number().int().positive() })
        .parse(body);
      const result = await db()
        .prepare(
          `UPDATE ${resource} SET title=?,description=?,target_date=?,status=?,category=COALESCE(?,category),${resource === "goals" ? "success_metric" : "goal_id"}=COALESCE(?,${resource === "goals" ? "success_metric" : "goal_id"}),revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?`,
        )
        .run(
          v.title,
          v.description,
          v.targetDate,
          v.status,
          v.category ?? null,
          (resource === "goals" ? v.successMetric : v.goalId) ?? null,
          rid,
          a.tenantId,
          v.revision,
        );
      if (!result.changes)
        return fail(
          "Plan changed elsewhere or is unavailable. Refresh first.",
          409,
        );
      await audit(
        a.tenantId,
        a.id,
        "updated",
        resource,
        rid,
        "Updated plan; historical completion attribution preserved",
      );
      return NextResponse.json({ ok: true });
    }
  }
  return fail("Planning action not found.", 404);
}
