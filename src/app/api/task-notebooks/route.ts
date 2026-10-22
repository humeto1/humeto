import { actor } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { notebookRoute } from "@/lib/task-notebooks";
export const runtime = "nodejs";
async function guarded(req: Request) {
  const a = await actor();
  if (a && !(await hasFeature(a.tenantId, "tasks")))
    return Response.json(
      { error: "This feature is not included in your workspace access." },
      { status: 403 },
    );
  return notebookRoute(req);
}
export const GET = guarded,
  POST = guarded;
