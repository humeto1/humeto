import { runTaskScheduler } from "@/lib/task-scheduler.mjs";
import { actor, isStaff, canMutate } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { tasks, subscription } from "@/lib/repository";
import { pipelineSettings } from "@/lib/pipeline-settings";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const a = await actor();
  if (!a)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isStaff(a) || a.role === "platform_admin")
    return Response.json(
      {
        error:
          "Mobile tasks requires a workspace owner or team member account.",
      },
      { status: 403 },
    );
  if (!(await hasFeature(a.tenantId, "tasks")))
    return Response.json(
      { error: "Tasks is not included in your workspace access." },
      { status: 403 },
    );
  await runTaskScheduler({
    d: db(),
    tenantId: a.tenantId,
    userId: a.id,
    routineOnly: true,
    heartbeat: false,
  });
  const [taskRows, projects, goals, members, sub, pipelines, writable] =
    await Promise.all([
      tasks(a),
      db()
        .prepare(
          "SELECT * FROM projects WHERE tenant_id=? ORDER BY created_at DESC",
        )
        .all(a.tenantId),
      db()
        .prepare(
          "SELECT * FROM goals WHERE tenant_id=? ORDER BY created_at DESC",
        )
        .all(a.tenantId),
      db()
        .prepare(
          "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('owner','consultant','platform_admin') ORDER BY u.name",
        )
        .all(a.tenantId),
      subscription(a),
      pipelineSettings(a.tenantId),
      canMutate(a),
    ]);
  return Response.json(
    {
      actor: a,
      tasks: taskRows,
      projects,
      goals,
      members,
      subscription: sub,
      stages: pipelines.tasks,
      writable,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
