import { db } from "@/lib/db";
import { actor, isStaff, canMutate, ensureOrigin } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { readWbs, writeWbs, WbsError } from "@/lib/project-wbs";
import { z } from "zod";
async function authorized() {
  const a = await actor();
  return a &&
    isStaff(a) &&
    a.role !== "platform_admin" &&
    (await hasFeature(a.tenantId, "tasks"))
    ? a
    : null;
}
function error(e: unknown) {
  if (
    e instanceof Error &&
    e.message === "Resume the project or goal before working on this task."
  )
    return Response.json({ error: e.message }, { status: 409 });
  return Response.json(
    {
      error:
        e instanceof WbsError
          ? e.message
          : e instanceof z.ZodError
            ? "Check the activity details."
            : e instanceof Error && e.message === "ORIGIN"
              ? "Request origin is not permitted."
              : "Unable to update the project tree.",
    },
    {
      status:
        e instanceof WbsError
          ? e.status
          : e instanceof Error && e.message === "ORIGIN"
            ? 403
            : 400,
    },
  );
}
export async function GET(req: Request) {
  try {
    const a = await authorized();
    if (!a) return Response.json({ error: "Not permitted." }, { status: 403 });
    const goalId = new URL(req.url).searchParams.get("goalId");
    if (goalId) {
      const gid = z.string().min(1).max(100).parse(goalId);
      const goal = await db()
        .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
        .get(gid, a.tenantId);
      if (!goal)
        return Response.json({ error: "Goal not found." }, { status: 404 });
      const projects = await db()
        .prepare(
          "SELECT id,title FROM projects WHERE tenant_id=? AND goal_id=? ORDER BY created_at DESC,id",
        )
        .all(a.tenantId, gid);
      return Response.json(
        { projects },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const id = z
      .string()
      .min(1)
      .max(100)
      .parse(new URL(req.url).searchParams.get("projectId"));
    return Response.json(
      await readWbs(
        a.tenantId,
        id,
        z
          .enum(["project", "goal"])
          .parse(new URL(req.url).searchParams.get("type") || "project"),
      ),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: Request) {
  try {
    ensureOrigin(req);
    const a = await authorized();
    if (!a || !(await canMutate(a)))
      return Response.json({ error: "Not permitted." }, { status: 403 });
    return Response.json(await writeWbs(a, await req.json()));
  } catch (e) {
    return error(e);
  }
}
