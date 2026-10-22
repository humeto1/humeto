import "server-only";
import { db } from "./db";
import { featureAllowed, featureForView } from "./feature-access.mjs";
export async function hasFeature(tenant: string, feature: string | null) {
  const s = await db()
    .prepare("SELECT features_json FROM subscriptions WHERE tenant_id=?")
    .get(tenant);
  return !!s && featureAllowed(s, feature);
}
export function requestFeature(url: string) {
  const parsed = new URL(url);
  const p = parsed.pathname.split("/").filter(Boolean);
  if (p[2] === "pipelines" && parsed.searchParams.get("kind") === "tasks")
    return "tasks";
  return featureForView(p[1] === "workspace" ? p[2] : p[1]);
}
