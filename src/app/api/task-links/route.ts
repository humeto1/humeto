import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { db, id, withTransaction } from "@/lib/db";
import { hasFeature } from "@/lib/feature-guard";
import { z } from "zod";
export const runtime = "nodejs";
async function route(req: Request) {
  try {
    const a = await actor();
    if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    const taskId = z
      .string()
      .min(1)
      .max(100)
      .parse(new URL(req.url).searchParams.get("taskId"));
    if (
      !(await db()
        .prepare("SELECT id FROM tasks WHERE id=? AND tenant_id=?")
        .get(taskId, a.tenantId))
    )
      return Response.json({ error: "Task not found." }, { status: 404 });
    if (req.method === "GET")
      return Response.json(
        {
          links: await db()
            .prepare(
              "SELECT id,label,url FROM task_links WHERE tenant_id=? AND task_id=? ORDER BY created_at,id",
            )
            .all(a.tenantId, taskId),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    ensureOrigin(req);
    if (!(await canMutate(a)))
      return Response.json(
        { error: "Workspace is read-only." },
        { status: 403 },
      );
    if (Number(req.headers.get("content-length")) > 5000)
      return Response.json({ error: "Request too large." }, { status: 413 });
    const b = await req.json();
    await withTransaction(async () => {
      await db()
        .prepare("SELECT id FROM tasks WHERE id=? AND tenant_id=? FOR UPDATE")
        .get(taskId, a.tenantId);
      if (b.operation === "remove")
        await db()
          .prepare(
            "DELETE FROM task_links WHERE id=? AND task_id=? AND tenant_id=?",
          )
          .run(z.string().parse(b.id), taskId, a.tenantId);
      else {
        const url = new URL(z.string().max(2000).parse(b.url));
        if (url.protocol !== "https:" || url.username || url.password)
          throw Error("URL");
        const count = await db()
          .prepare(
            "SELECT count(*)::int AS n FROM task_links WHERE task_id=? AND tenant_id=?",
          )
          .get(taskId, a.tenantId);
        if (Number(count?.n) >= 50) throw Error("LIMIT");
        await db()
          .prepare(
            "INSERT INTO task_links(id,tenant_id,task_id,label,url) VALUES(?,?,?,?,?)",
          )
          .run(
            id(),
            a.tenantId,
            taskId,
            z.string().trim().min(1).max(120).parse(b.label),
            url.href,
          );
      }
    });
    return Response.json({ saved: true });
  } catch {
    return Response.json(
      { error: "Use a valid HTTPS link, up to 50 links per task." },
      { status: 400 },
    );
  }
}
export const GET = route,
  POST = route;
