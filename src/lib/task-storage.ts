import "server-only";
import { z } from "zod";
import { db, audit, withTransaction } from "./db";
import { isStaff, canMutate } from "./auth";
import type { Actor } from "./types";
export async function storageRead(a: Actor) {
  if (!isStaff(a) || a.role === "platform_admin")
    return Response.json(
      { error: "Task storage is not permitted." },
      { status: 403 },
    );
  await db().query("SELECT humeto_purge_task_bin(now(),$1)", [a.tenantId]);
  const items = await db()
    .prepare(
      "SELECT id,title,stage,project_id,revision,storage_state,stored_at,purge_after FROM tasks WHERE tenant_id=? AND storage_state!='active' AND (purge_after IS NULL OR purge_after>now()) ORDER BY stored_at DESC LIMIT 1000",
    )
    .all(a.tenantId);
  return Response.json({ items });
}
export async function storageWrite(a: Actor, id: string, body: unknown) {
  if (!isStaff(a) || a.role === "platform_admin" || !(await canMutate(a)))
    return Response.json(
      { error: "Task changes are not permitted." },
      { status: 403 },
    );
  const v = z
    .object({
      action: z.enum(["archive", "bin", "restore"]),
      revision: z.number().int().positive(),
    })
    .parse(body);
  return withTransaction(async () => {
    const task = await db()
      .prepare(
        "SELECT id,storage_state,revision,purge_after FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE",
      )
      .get(id, a.tenantId);
    if (!task)
      return Response.json({ error: "Task not found." }, { status: 404 });
    if (task.revision !== v.revision)
      return Response.json(
        { error: "Task changed elsewhere. Refresh and retry." },
        { status: 409 },
      );
    if (
      task.storage_state === "bin" &&
      new Date(String(task.purge_after)).getTime() <= Date.now()
    )
      return Response.json(
        { error: "The 30-day restore period has ended." },
        { status: 410 },
      );
    const state = v.action === "restore" ? "active" : v.action;
    if (task.storage_state === state)
      return Response.json(
        { error: "Task is already in this location." },
        { status: 409 },
      );
    await db()
      .prepare(
        "UPDATE tasks SET storage_state=?,stored_at=CASE WHEN ?='active' THEN NULL ELSE now() END,purge_after=CASE WHEN ?='bin' THEN now()+interval '30 days' ELSE NULL END,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=?",
      )
      .run(state, state, state, a.id, id, a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      v.action,
      "task",
      id,
      "Task " + (v.action === "restore" ? "restored" : "moved to " + state),
    );
    return Response.json({ ok: true });
  });
}
