import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import InquiryForm from "@/components/inquiry-form";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Start your next chapter · Humeto",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{
    token: string;
  }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  const link = await db()
    .prepare(
      "SELECT t.name FROM inquiry_links l JOIN tenants t ON t.id=l.tenant_id WHERE l.token_hash=? AND l.revoked=0 AND l.expires_at>?",
    )
    .get(createHash("sha256").update(token).digest("hex"), Date.now());
  if (!link) notFound();
  return <InquiryForm token={token} institute={String(link.name)} />;
}
