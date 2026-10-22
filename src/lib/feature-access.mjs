export const features = ["crm", "tasks", "forms"];
export function enabledFeatures(s) {
  try {
    const f = JSON.parse(s?.features_json || '["crm","tasks","forms"]');
    return Array.isArray(f) ? f.filter((x) => features.includes(x)) : [];
  } catch {
    return [];
  }
}
export function featureForView(view) {
  if (
    [
      "tasks",
      "focus",
      "scheduling",
      "progress",
      "projects",
      "goals",
      "assistant",
      "task-notebooks",
      "task-history",
      "task-links",
      "agent",
    ].includes(view)
  )
    return "tasks";
  if (
    [
      "leads",
      "applications",
      "finance",
      "pipelines",
      "crm-ai",
      "crm-agent",
      "updates",
      "update-inbox",
      "insights",
      "journey-insights",
      "whatsapp",
    ].includes(view)
  )
    return "crm";
  if (
    [
      "documents",
      "reading",
      "imports",
      "facts",
      "assist",
      "pairings",
      "assist-tokens",
      "requirements",
      "document-bundles",
    ].includes(view)
  )
    return "forms";
  if (["students", "profile", "search", "requests"].includes(view))
    return "shared";
  return null;
}
export function featureAllowed(s, feature) {
  const f = enabledFeatures(s);
  return (
    !feature ||
    (feature === "shared"
      ? f.includes("crm") || f.includes("forms")
      : f.includes(feature))
  );
}
