import { requireActor } from "@/lib/auth";
import { bootstrap } from "@/lib/repository";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const a = await requireActor();
  return (
    <Workspace
      actor={a}
      initial={JSON.parse(JSON.stringify(bootstrap(a)))}
      view={a.role === "platform_admin" ? "platform" : "overview"}
    />
  );
}
