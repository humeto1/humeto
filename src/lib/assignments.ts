import { hasFeature } from "./feature-guard";
import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db, audit, withTransaction } from "./db";
import { canMutate, isStaff } from "./auth";
import type { Actor } from "./types";
const kinds = {
  task: "tasks",
  application: "applications",
  applicant: "people",
  project: "projects",
  goal: "goals",
  routine: "task_recurrences",
} as const;
const input = z.object({
  type: z.enum([
    "task",
    "application",
    "applicant",
    "project",
    "goal",
    "routine",
  ]),
  id: z.string().min(1).max(100),
  inherit: z.boolean().default(false),
  revision: z.number().int().nonnegative().default(0),
  userIds: z.array(z.string().max(100)).max(50).default([]),
});
export async function assignmentRead(a: Actor, type: string, entityId: string) {
  if (!isStaff(a) || !(type in kinds))
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  if (
    !(await hasFeature(
      a.tenantId,
      ["task", "project", "goal", "routine"].includes(type)
        ? "tasks"
        : type === "applicant"
          ? "shared"
          : "crm",
    ))
  )
    return NextResponse.json(
      { error: "This feature is not included in your workspace access." },
      { status: 403 },
    );
  const table = kinds[type as keyof typeof kinds];
  if (
    !(await db()
      .prepare(`SELECT id FROM ${table} WHERE id=? AND tenant_id=?`)
      .get(entityId, a.tenantId))
  )
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  const assigned = await db()
      .prepare(
        "SELECT user_id FROM work_assignments WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .all(a.tenantId, type, entityId),
    rev = await db()
      .prepare(
        "SELECT revision,inherit FROM assignment_revisions WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .get(a.tenantId, type, entityId);
  const members = await db()
    .prepare(
      "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant') ORDER BY u.name",
    )
    .all(a.tenantId);
  const inherited =
    type === "task" ? await inheritedTaskTeam(a.tenantId, entityId) : [];
  const inherits =
    type === "task" &&
    (rev ? Number(rev.inherit) === 1 : assigned.length === 0);
  return NextResponse.json({
    inherits,
    inherited,
    effectiveUserIds: inherits
      ? [...new Set(inherited.map((r) => String(r.user_id)))]
      : assigned.map((r) => r.user_id),
    userIds: assigned.map((r) => r.user_id),
    revision: rev?.revision || 0,
    members,
  });
}
export async function assignmentWrite(a: Actor, body: unknown) {
  if (!isStaff(a) || !(await canMutate(a)))
    return NextResponse.json(
      { error: "Assignment changes are not permitted." },
      { status: 403 },
    );
  const v = input.parse(body);
  if (
    !(await hasFeature(
      a.tenantId,
      ["task", "project", "goal", "routine"].includes(v.type)
        ? "tasks"
        : v.type === "applicant"
          ? "shared"
          : "crm",
    ))
  )
    return NextResponse.json(
      { error: "This feature is not included in your workspace access." },
      { status: 403 },
    );
  return withTransaction(async () => {
    const table = kinds[v.type];
    if (
      !(await db()
        .prepare(
          `SELECT id FROM ${table} WHERE id=? AND tenant_id=? FOR UPDATE`,
        )
        .get(v.id, a.tenantId))
    )
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    const current = await db()
      .prepare(
        "SELECT revision,inherit FROM assignment_revisions WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .get(a.tenantId, v.type, v.id);
    if ((current?.revision || 0) !== v.revision)
      return NextResponse.json(
        { error: "Team changed elsewhere. Reload before assigning." },
        { status: 409 },
      );
    const userIds =
      v.type === "task" && v.inherit ? [] : [...new Set(v.userIds)];
    for (const uid of userIds)
      if (
        !(await db()
          .prepare(
            "SELECT user_id FROM memberships WHERE tenant_id=? AND user_id=? AND role IN ('owner','consultant')",
          )
          .get(a.tenantId, uid))
      )
        return NextResponse.json(
          { error: "Choose staff from this workspace." },
          { status: 400 },
        );
    await db()
      .prepare(
        "DELETE FROM work_assignments WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .run(a.tenantId, v.type, v.id);
    for (const uid of userIds)
      await db()
        .prepare(
          "INSERT INTO work_assignments(tenant_id,entity_type,entity_id,user_id,assigned_by) VALUES(?,?,?,?,?)",
        )
        .run(a.tenantId, v.type, v.id, uid, a.id);
    await db()
      .prepare(
        "INSERT INTO assignment_revisions(tenant_id,entity_type,entity_id,inherit) VALUES(?,?,?,?) ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET revision=assignment_revisions.revision+1,inherit=excluded.inherit",
      )
      .run(a.tenantId, v.type, v.id, v.type === "task" && v.inherit ? 1 : 0);
    await audit(
      a.tenantId,
      a.id,
      "assigned",
      v.type,
      v.id,
      "Updated responsible staff",
    );
    return NextResponse.json({ ok: true });
  });
}

export async function inheritedTaskTeam(tenant: string, taskId: string) {
  return db()
    .prepare(
      `SELECT DISTINCT a.user_id,u.name,a.entity_type,a.entity_id FROM work_assignments a JOIN users u ON u.id=a.user_id JOIN memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id WHERE a.tenant_id=? AND m.role IN ('owner','consultant') AND (
   (a.entity_type='project' AND a.entity_id IN (SELECT project_id FROM tasks WHERE tenant_id=? AND id=?)) OR
   (a.entity_type='goal' AND a.entity_id IN (SELECT goal_id FROM task_goals WHERE tenant_id=? AND task_id=? UNION SELECT p.goal_id FROM projects p JOIN tasks t ON t.project_id=p.id AND t.tenant_id=p.tenant_id WHERE t.tenant_id=? AND t.id=?)) OR
   (a.entity_type='routine' AND a.entity_id IN (SELECT o.series_id FROM task_occurrences o JOIN task_recurrences r ON r.id=o.series_id WHERE r.tenant_id=? AND o.task_id=? UNION SELECT id FROM task_recurrences WHERE tenant_id=? AND template_task_id=?))
  ) ORDER BY u.name,a.entity_type`,
    )
    .all(
      tenant,
      tenant,
      taskId,
      tenant,
      taskId,
      tenant,
      taskId,
      tenant,
      taskId,
      tenant,
      taskId,
    );
}
