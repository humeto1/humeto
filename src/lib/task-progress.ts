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
  description: z.string().trim().max(2000).default(""),
  targetDate: z.union([z.literal(""), z.iso.date()]).default(""),
  status: z
    .enum(["Active", "Paused", "Completed", "Archived"])
    .default("Active"),
});
export function progressRead(req: Request, parts: string[], a: Actor) {
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
  const events = db()
    .prepare(
      "SELECT e.*,COALESCE(u.name,'System') AS actor_name,t.stage AS current_stage FROM task_events e JOIN tasks t ON t.id=e.task_id AND t.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=? ORDER BY e.created_at DESC,e.rowid DESC",
    )
    .all(a.tenantId)
    .map((e) => ({
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
      { id: string; title: string; count: number; taskIds: string[] }
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
export function progressMutation(
  req: Request,
  parts: string[],
  a: Actor,
  body: unknown,
) {
  const [resource, rid] = parts;
  if (!["projects", "goals", "task-links"].includes(resource)) return null;
  if (!canMutate(a)) return fail("Task planning is not permitted.", 403);
  if (resource === "task-links" && req.method === "PATCH") {
    const v = z
      .object({
        revision: z.number().int().positive(),
        projectId: z.string().max(100).default(""),
        goalIds: z.array(z.string().max(100)).max(20).default([]),
      })
      .parse(body);
    return transaction(() => {
      const t = db()
        .prepare("SELECT revision FROM tasks WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId);
      if (!t) return fail("Task not found.", 404);
      if (t.revision !== v.revision)
        return fail("Task changed elsewhere. Refresh and retry.", 409);
      if (
        v.projectId &&
        !db()
          .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
          .get(v.projectId, a.tenantId)
      )
        return fail("Project not found in this workspace.", 404);
      const goalIds = [...new Set(v.goalIds)];
      for (const gid of goalIds)
        if (
          !db()
            .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
            .get(gid, a.tenantId)
        )
          return fail("Goal not found in this workspace.", 404);
      db()
        .prepare("DELETE FROM task_goals WHERE tenant_id=? AND task_id=?")
        .run(a.tenantId, rid);
      for (const gid of goalIds)
        db()
          .prepare(
            "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
          )
          .run(a.tenantId, rid, gid);
      db()
        .prepare(
          "UPDATE tasks SET project_id=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(v.projectId, a.id, rid, a.tenantId, v.revision);
      audit(
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
    if (!rid && req.method === "POST") {
      const v = input.parse(body);
      const uid = id();
      db()
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
      audit(
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
      const result = db()
        .prepare(
          `UPDATE ${resource} SET title=?,description=?,target_date=?,status=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?`,
        )
        .run(
          v.title,
          v.description,
          v.targetDate,
          v.status,
          rid,
          a.tenantId,
          v.revision,
        );
      if (!result.changes)
        return fail(
          "Plan changed elsewhere or is unavailable. Refresh first.",
          409,
        );
      audit(
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
