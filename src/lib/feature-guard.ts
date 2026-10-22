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
  const p = new URL(url).pathname.split("/").filter(Boolean);
  return featureForView(p[1] === "workspace" ? p[2] : p[1]);
}
