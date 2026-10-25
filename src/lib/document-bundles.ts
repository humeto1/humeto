import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { actor, canSeePerson, ensureOrigin } from "./auth";
import { db } from "./db";
import { sections } from "./sections";
import { bundleZip, bundleName } from "./bundle-zip.mjs";
import { getObject } from "./storage.mjs";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const schema = z.object({
  action: z.enum(["preview", "download"]),
  personId: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        version: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(20),
  nameMode: z.enum(["title", "original"]).default("title"),
  maxFileMB: z.number().int().min(1).max(15).default(15),
  pdfOnly: z.boolean().default(false),
  fingerprint: z.string().max(100).optional(),
});
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export async function bundleRoute(req: Request) {
  try {
    const a = await actor();
    if (!a) return fail("Sign in to continue.", 401);
    if (a.role === "platform_admin") return fail("Not permitted.", 403);
    ensureOrigin(req);
    const v = schema.parse(await req.json());
    if (!(await canSeePerson(a, v.personId)))
      return fail("Applicant not found.", 404);
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      return fail("Select each document once.");
    const files = [];
    let total = 0;
    for (const item of v.items) {
      const row = await db()
        .prepare(
          "SELECT d.id,d.person_id,d.title,d.section_key,d.status,d.current_version,v.* FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.version=? WHERE d.id=? AND d.tenant_id=? AND d.person_id=?",
        )
        .get(item.version, item.id, a.tenantId, v.personId);
      if (
        !row ||
        (sections.find((s) => s.key === row.section_key)?.restricted &&
          !["owner", "student"].includes(a.role))
      )
        return fail("A selected document is unavailable.", 404);
      if (row.current_version !== item.version)
        return fail(
          "A selected document has a newer version. Refresh and review the bundle again.",
          409,
        );
      if (
        !["application/pdf", "image/png", "image/jpeg"].includes(row.mime_type)
      )
        return fail("This bundle supports PDF, PNG and JPEG originals.");
      if (v.pdfOnly && row.mime_type !== "application/pdf")
        return fail(
          "The PDF-only portal preset excludes a selected image. Remove it or change the preset.",
        );
      if (row.byte_size > v.maxFileMB * 1024 * 1024)
        return fail(
          "A selected file exceeds the portal size limit. Original files are not compressed or changed.",
        );
      total += Number(row.byte_size);
      if (total > 50 * 1024 * 1024)
        return fail("Choose up to 50 MB of originals per bundle.");
      const ext =
          row.mime_type === "application/pdf"
            ? ".pdf"
            : row.mime_type === "image/png"
              ? ".png"
              : ".jpg",
        stem =
          v.nameMode === "original"
            ? String(row.original_name).replace(/\.[^.]+$/, "")
            : row.title;
      files.push({
        id: row.document_id,
        version: item.version,
        title: row.title,
        originalName: row.original_name,
        status: row.status,
        size: Number(row.byte_size),
        sha256: row.sha256,
        name:
          String(files.length + 1).padStart(2, "0") +
          " - " +
          bundleName(stem) +
          ext,
        storedName: row.stored_name,
      });
    }
    const manifest = files.map(({ storedName, ...entry }) => entry),
      fingerprint = sha(
        JSON.stringify({
          personId: v.personId,
          manifest,
          nameMode: v.nameMode,
          maxFileMB: v.maxFileMB,
          pdfOnly: v.pdfOnly,
        }),
      );
    if (v.action === "preview")
      return NextResponse.json(
        { manifest, totalBytes: total, fingerprint },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!v.fingerprint || v.fingerprint !== fingerprint)
      return fail(
        "The bundle changed. Preview it again before downloading.",
        409,
      );
    const entries = [];
    for (const file of files) {
      if (basename(file.storedName) !== file.storedName)
        return fail("Source unavailable.", 404);
      let bytes: Buffer;
      try {
        bytes = await getObject("uploads/" + file.storedName);
        if (bytes.length > 15 * 1024 * 1024)
          return fail(
            "A source file changed. Review or restore it before downloading.",
            409,
          );
      } catch {
        return fail(
          "A source file is missing. Restore it before downloading.",
          409,
        );
      }
      if (bytes.length !== file.size || sha(bytes) !== file.sha256)
        return fail(
          "A source file failed its integrity check. Replace or restore it before downloading.",
          409,
        );
      entries.push({ name: file.name, bytes });
    }
    entries.push({
      name: "manifest.json",
      bytes: Buffer.from(
        JSON.stringify(
          {
            notice:
              "Original files only. Document status and OCR review do not prove authenticity or portal readiness.",
            personId: v.personId,
            files: manifest,
          },
          null,
          2,
        ),
      ),
    });
    const bytes = bundleZip(entries);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="humeto-document-bundle.zip"',
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return fail(e.issues[0]?.message || "Invalid selection.");
    if (e instanceof Error && e.message === "ORIGIN")
      return fail("Origin not allowed.", 403);
    console.error("Document bundle request failed.");
    return fail("Unable to prepare this bundle.", 500);
  }
}
