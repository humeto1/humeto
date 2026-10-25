import { actor, isStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/feature-guard";
export async function GET() {
  const a = await actor();
  if (!a || !isStaff(a) || !(await hasFeature(a.tenantId, "tasks")))
    return Response.json(
      { error: "Sign in to view your project chats." },
      { status: 403 },
    );
  const projects = await db()
    .prepare(
      "SELECT p.id,p.title FROM projects p WHERE p.tenant_id=? AND (?='owner' OR EXISTS(SELECT 1 FROM work_assignments w WHERE w.tenant_id=p.tenant_id AND w.entity_type='project' AND w.entity_id=p.id AND w.user_id=?)) ORDER BY p.title",
    )
    .all(a.tenantId, a.role, a.id);
  return Response.json(
    { projects },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
