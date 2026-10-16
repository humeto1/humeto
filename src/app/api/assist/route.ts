import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { sections } from "@/lib/sections";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const token = req.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
  if (!token)
    return NextResponse.json(
      {
        error: "Pair the extension using a token from your workspace settings.",
      },
      { status: 401 },
    );
  const row = db()
    .prepare(
      "SELECT t.*,p.name,p.email FROM assist_tokens t JOIN people p ON p.id=t.person_id AND p.tenant_id=t.tenant_id JOIN memberships m ON m.user_id=t.user_id AND m.tenant_id=t.tenant_id WHERE t.token_hash=? AND t.revoked=0 AND t.expires_at>? AND m.role!=? AND (m.role!=? OR m.person_id=t.person_id)",
    )
    .get(
      createHash("sha256").update(token).digest("hex"),
      Date.now(),
      "platform_admin",
      "student",
    ) as
    | {
        tenant_id: string;
        person_id: string;
        name: string;
        email: string;
        section_keys: string;
        expires_at: number;
      }
    | undefined;
  if (!row)
    return NextResponse.json(
      {
        error:
          "Pairing expired or revoked. Create a new one in workspace settings.",
      },
      { status: 401 },
    );
  const keys = JSON.parse(row.section_keys) as string[];
  const facts: Record<string, unknown>[] = [];
  for (const key of keys) {
    const section = sections.find((s) => s.key === key);
    if (
      !section ||
      section.repeatable ||
      !["identity", "contact"].includes(section.key)
    )
      continue;
    const saved = db()
      .prepare(
        "SELECT data,revision,updated_at FROM intake WHERE tenant_id=? AND person_id=? AND section_key=?",
      )
      .get(row.tenant_id, row.person_id, key) as
      { data: string; revision: number; updated_at: string } | undefined;
    if (!saved) continue;
    const data = JSON.parse(saved.data);
    for (const field of section.fields) {
      if (field.sensitive) continue;
      const value = data[field.key];
      if (typeof value === "string" && value.trim())
        facts.push({
          key: field.key,
          label: field.label,
          value,
          section: section.title,
          status: "Provided, not verified",
          updatedAt: saved.updated_at,
        });
    }
  }
  return NextResponse.json(
    {
      applicant: { id: row.person_id, name: row.name },
      facts,
      expiresAt: row.expires_at,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
