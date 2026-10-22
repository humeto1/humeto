import { actor } from "@/lib/auth";
import { hasFeature } from "@/lib/feature-guard";
import { bundleRoute } from "@/lib/document-bundles";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const a = await actor();
  if (a && !(await hasFeature(a.tenantId, "forms")))
    return Response.json(
      { error: "This feature is not included in your workspace access." },
      { status: 403 },
    );
  return bundleRoute(req);
}
