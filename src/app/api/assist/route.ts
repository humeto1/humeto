import { assistAllowed } from "@/lib/assist-scope";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "@/lib/db";
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
  const row = (await db()
    .prepare(
      "SELECT t.*,p.name,p.email FROM assist_tokens t JOIN people p ON p.id=t.person_id AND p.tenant_id=t.tenant_id JOIN memberships m ON m.user_id=t.user_id AND m.tenant_id=t.tenant_id WHERE t.token_hash=? AND t.revoked=0 AND t.expires_at>? AND m.role!=? AND (m.role!=? OR m.person_id=t.person_id)",
    )
    .get(
      createHash("sha256").update(token).digest("hex"),
      Date.now(),
      "platform_admin",
      "student",
    )) as
    | {
        tenant_id: string;
        person_id: string;
        name: string;
        email: string;
        section_keys: string;
        expires_at: number;
        allow_documents: boolean;
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
  const documents = await db()
    .prepare(
      `SELECT d.id,d.title,d.section_key,d.category,d.status,d.current_version AS version,v.original_name,v.mime_type,v.byte_size FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.version=d.current_version WHERE d.tenant_id=? AND d.person_id=? ORDER BY d.created_at DESC`,
    )
    .all(row.tenant_id, row.person_id);
  const permittedDocuments = documents.filter(
    (d) =>
      row.allow_documents &&
      keys.includes(String(d.section_key)) &&
      assistAllowed(String(d.section_key)),
  );
  const url = new URL(req.url),
    documentId = url.searchParams.get("documentId");
  if (documentId) {
    const doc = permittedDocuments.find((d) => d.id === documentId);
    if (!doc)
      return NextResponse.json(
        { error: "Document is outside this pairing scope." },
        { status: 404 },
      );
    if (Number(url.searchParams.get("version")) !== doc.version)
      return NextResponse.json(
        { error: "Document changed. Refresh before attaching." },
        { status: 409 },
      );
    if (Number(doc.byte_size) > 10 * 1024 * 1024)
      return NextResponse.json(
        { error: "Files over 10 MB must be attached manually." },
        { status: 413 },
      );
    const source = await db()
      .prepare(
        "SELECT stored_name FROM document_versions WHERE tenant_id=? AND document_id=? AND version=?",
      )
      .get(row.tenant_id, doc.id, doc.version);
    return new NextResponse(
      new Uint8Array(
        readFileSync(resolve(dataDir, "uploads", String(source!.stored_name))),
      ),
      {
        headers: {
          "Content-Type": String(doc.mime_type),
          "Cache-Control": "private, no-store",
          "Content-Disposition": 'attachment; filename="document"',
        },
      },
    );
  }
  const facts: Record<string, unknown>[] = [];
  for (const key of keys) {
    const section = sections.find((s) => s.key === key);
    if (!section || !assistAllowed(key) || section.restricted) continue;
    const saved = await db()
      .prepare(
        "SELECT data,revision,updated_at FROM intake WHERE tenant_id=? AND person_id=? AND section_key=?",
      )
      .get(row.tenant_id, row.person_id, key);
    if (!saved) continue;
    const data = JSON.parse(String(saved.data));
    const records = section.repeatable ? data.items || [] : [data];
    for (const [index, record] of records.entries()) {
      for (const field of section.fields) {
        if (field.sensitive) continue;
        const value = record[field.key];
        if (typeof value === "string" && value.trim())
          facts.push({
            key: field.key,
            label: section.repeatable
              ? `${section.title} #${index + 1} · ${field.label}`
              : field.label,
            value,
            section: section.title,
            sectionKey: key,
            recordIndex: index,
            status: "Provided, not verified",
            revision: saved.revision,
            updatedAt: saved.updated_at,
          });
      }
    }
  }
  return NextResponse.json(
    {
      applicant: { id: row.person_id, name: row.name },
      facts,
      documents: permittedDocuments,
      expiresAt: row.expires_at,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
