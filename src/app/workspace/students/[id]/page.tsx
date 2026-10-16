import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { bootstrap, person, intake } from "@/lib/repository";
import { sections } from "@/lib/sections";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const a = await requireActor(),
    { id } = await params,
    { section } = await searchParams,
    p = person(a, id);
  if (!p) notFound();
  if (
    sections.find((s) => s.key === section)?.restricted &&
    !["owner", "student"].includes(a.role)
  )
    notFound();
  const data = intake(a, id).filter(
    (s) =>
      !sections.find((def) => def.key === s.section_key)?.restricted ||
      ["owner", "student"].includes(a.role),
  );
  return (
    <Workspace
      key={id + section}
      initialSection={section}
      actor={a}
      initial={JSON.parse(JSON.stringify(bootstrap(a)))}
      view="profile"
      initialPerson={p}
      initialIntake={data}
    />
  );
}
