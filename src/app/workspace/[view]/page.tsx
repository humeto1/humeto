import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { bootstrap } from "@/lib/repository";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (
    ![
      "students",
      "documents",
      "applications",
      "tasks",
      "requests",
      "activity",
      "settings",
      "platform",
    ].includes(view)
  )
    notFound();
  const a = await requireActor();
  if (view === "platform" && a.role !== "platform_admin") notFound();
  return (
    <Workspace
      actor={a}
      initial={JSON.parse(JSON.stringify(bootstrap(a)))}
      view={view}
    />
  );
}
