import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { bootstrap } from "@/lib/repository";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{
    view: string;
  }>;
}) {
  const { view } = await params;
  if (
    ![
      "students",
      "leads",
      "documents",
      "applications",
      "tasks",
      "progress",
      "assistant",
      "crm-ai",
      "updates",
      "requests",
      "activity",
      "settings",
      "finance",
      "platform",
    ].includes(view)
  )
    notFound();
  const a = await requireActor();
  if (view === "finance" && a.role !== "owner") notFound();
  if (view === "platform" && a.role !== "platform_admin") notFound();
  if (
    ["assistant", "leads", "progress", "crm-ai", "updates"].includes(view) &&
    !["owner", "consultant"].includes(a.role)
  )
    notFound();
  return (
    <Workspace
      actor={a}
      initial={JSON.parse(JSON.stringify(await bootstrap(a)))}
      view={view}
    />
  );
}
