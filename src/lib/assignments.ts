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
} as const;
const input = z.object({
  type: z.enum(["task", "application", "applicant", "project"]),
  id: z.string().min(1).max(100),
  revision: z.number().int().nonnegative().default(0),
  userIds: z.array(z.string().max(100)).max(50).default([]),
});
export async function assignmentRead(a: Actor, type: string, entityId: string) {
  if (!isStaff(a) || !(type in kinds))
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  if (
    !(await hasFeature(
      a.tenantId,
      ["task", "project"].includes(type)
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
        "SELECT revision FROM assignment_revisions WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .get(a.tenantId, type, entityId);
  const members = await db()
    .prepare(
      "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant') ORDER BY u.name",
    )
    .all(a.tenantId);
  return NextResponse.json({
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
      ["task", "project"].includes(v.type)
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
        "SELECT revision FROM assignment_revisions WHERE tenant_id=? AND entity_type=? AND entity_id=?",
      )
      .get(a.tenantId, v.type, v.id);
    if ((current?.revision || 0) !== v.revision)
      return NextResponse.json(
        { error: "Team changed elsewhere. Reload before assigning." },
        { status: 409 },
      );
    const userIds = [...new Set(v.userIds)];
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
        "INSERT INTO assignment_revisions(tenant_id,entity_type,entity_id) VALUES(?,?,?) ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET revision=assignment_revisions.revision+1",
      )
      .run(a.tenantId, v.type, v.id);
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
