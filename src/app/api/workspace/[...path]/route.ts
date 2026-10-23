import { wordingWrite } from "@/lib/routine-wording";
import { impactFields, impactValues } from "@/lib/task-value";
import { planningRead, planningWrite } from "@/lib/planning";
import { industryKeys, legacyIndustryKeys } from "@/lib/industries.mjs";
import { voucherRead, voucherWrite } from "@/lib/vouchers";
import { hasFeature, requestFeature } from "@/lib/feature-guard";
import { subscriptionAccess, trialExpiry } from "@/lib/subscription-access.mjs";
import { schedulingRead, schedulingWrite } from "@/lib/task-scheduling";
import {
  readingRead,
  readingWrite,
  queueReading,
  ReadingError,
} from "@/lib/document-intelligence";
import { financeRead, financeWrite } from "@/lib/finance";
import { assignmentRead, assignmentWrite } from "@/lib/assignments";
import {
  pipelineRead,
  pipelineWrite,
  validStage,
} from "@/lib/pipeline-settings";
import { assistAllowed } from "@/lib/assist-scope";
import { focusRead, focusMutation, focusInterpret } from "@/lib/focus";
import { withTransaction } from "@/lib/db";
import {
  requestRead,
  requestMutation,
  prepareRequestUpload,
  saveReply,
  requestDocumentChanged,
  requestDocumentReviewChanged,
  RequestWorkflowError,
} from "@/lib/request-workflow";
import { progressRead, progressMutation } from "@/lib/task-progress";
import { crmMutation, transaction } from "@/lib/crm";
import { applicationStages } from "@/lib/pipeline";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  actor,
  canSeePerson,
  isStaff,
  canMutate,
  ensureOrigin,
} from "@/lib/auth";
import {
  db,
  id,
  audit,
  dataDir,
  hashPassword,
  createChecklist,
} from "@/lib/db";
import { bootstrap, intake, person, documents } from "@/lib/repository";
import { sections } from "@/lib/sections";
import type { Actor } from "@/lib/types";
export const runtime = "nodejs";
const fail = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
async function writable(a: Actor) {
  const s = (await db()
    .prepare("SELECT status,expires_at FROM subscriptions WHERE tenant_id=?")
    .get(a.tenantId)) as
    | {
        status: string;
        expires_at: string;
      }
    | undefined;
  return subscriptionAccess(s);
}
async function staff(a: Actor) {
  return isStaff(a) && (await canMutate(a));
}
const string = z.string().trim().max(500),
  optionalString = string.default("");
async function handle(req: Request, parts: string[], a: Actor) {
  const [resource, rid, action] = parts;
  if (req.method === "GET") {
    if (resource === "planning") return planningRead(req, a);
    if (resource === "vouchers") return voucherRead(a);
    if (resource === "reading") return readingRead(req, parts, a);
    if (resource === "finance")
      return financeRead(a, new URL(req.url).searchParams.get("month") || "");
    if (resource === "assignments") {
      const u = new URL(req.url);
      return assignmentRead(
        a,
        u.searchParams.get("type") || "",
        u.searchParams.get("id") || "",
      );
    }
    if (resource === "pipelines")
      return pipelineRead(
        a,
        new URL(req.url).searchParams.get("kind") === "tasks",
      );
    if (resource === "focus") return focusRead(a);
    if (resource === "scheduling")
      return schedulingRead(
        a,
        new URL(req.url).searchParams.get("summary") === "1",
      );
    const conversation = await requestRead(parts, a);
    if (conversation) return conversation;
    const progress = await progressRead(req, parts, a);
    if (progress) return progress;
    if (resource === "bootstrap") return NextResponse.json(await bootstrap(a));
    if (resource === "search") {
      const q = (new URL(req.url).searchParams.get("q") || "")
        .trim()
        .toLowerCase()
        .slice(0, 100);
      if (q.length < 2) return NextResponse.json({ results: [] });
      const hits: Record<string, unknown>[] = [];
      if (a.role === "platform_admin")
        return NextResponse.json({ results: [] });
      const rows = await db()
        .prepare(
          "SELECT i.*,p.name AS person_name FROM intake i JOIN people p ON p.id=i.person_id AND p.tenant_id=i.tenant_id WHERE i.tenant_id=?",
        )
        .all(a.tenantId);
      for (const row of rows) {
        if (!(await canSeePerson(a, String(row.person_id)))) continue;
        const section = sections.find((s) => s.key === row.section_key);
        if (!section || section.restricted) continue;
        const data = JSON.parse(String(row.data));
        const records = section.repeatable ? data.items || [] : [data];
        for (const record of records)
          for (const field of section.fields) {
            if (field.sensitive) continue;
            const value = String(record[field.key] || "");
            const aliases =
              field.key === "birthDate"
                ? "dob date of birth"
                : field.key === "number"
                  ? "passport number identity number"
                  : "";
            if (
              value &&
              (
                field.label +
                " " +
                aliases +
                " " +
                value +
                " " +
                row.person_name
              )
                .toLowerCase()
                .includes(q)
            )
              hits.push({
                personId: row.person_id,
                personName: row.person_name,
                sectionKey: section.key,
                sectionTitle: section.title,
                label: field.label,
                value: value.slice(0, 500),
                revision: row.revision,
                updatedAt: row.updated_at,
                status: "Provided · not verified",
              });
            if (hits.length >= 40) break;
          }
        if (hits.length >= 40) break;
      }
      return NextResponse.json({ results: hits.slice(0, 40) });
    }
    if (resource === "assist-tokens") {
      if (a.role === "platform_admin") return fail("Not permitted.", 403);
      const clauses = a.role === "student" ? " AND person_id=?" : "";
      return NextResponse.json({
        tokens: await db()
          .prepare(
            "SELECT id,person_id,section_keys,expires_at,revoked,created_at FROM assist_tokens WHERE tenant_id=? AND user_id=?" +
              clauses +
              " ORDER BY created_at DESC",
          )
          .all(
            a.tenantId,
            a.id,
            ...(a.role === "student" ? [a.personId || ""] : []),
          ),
      });
    }
    if (resource === "imports" && rid) {
      const run = (await db()
        .prepare("SELECT person_id FROM import_runs WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId)) as
        | {
            person_id: string;
          }
        | undefined;
      if (!run || !(await canSeePerson(a, run.person_id)))
        return fail("Import not found.", 404);
      return NextResponse.json({
        items: await db()
          .prepare(
            "SELECT source_path,status,document_id FROM import_items WHERE run_id=? AND tenant_id=? ORDER BY _rowid",
          )
          .all(rid, a.tenantId),
      });
    }
    if (resource === "imports") {
      const s =
        a.role === "student"
          ? " AND person_id=?"
          : a.role === "platform_admin"
            ? " AND 0=1"
            : "";
      return NextResponse.json({
        runs: await db()
          .prepare(
            "SELECT r.*,(SELECT count(*) FROM import_items i WHERE i.run_id=r.id) AS processed_count FROM import_runs r WHERE tenant_id=?" +
              s +
              " ORDER BY created_at DESC LIMIT 20",
          )
          .all(a.tenantId, ...(a.role === "student" ? [a.personId || ""] : [])),
      });
    }
    if (resource === "applications" && rid) {
      const app = (await db()
        .prepare(
          "SELECT person_id FROM applications WHERE id=? AND tenant_id=?",
        )
        .get(rid, a.tenantId)) as
        | {
            person_id: string;
          }
        | undefined;
      if (!app || !(await canSeePerson(a, app.person_id)))
        return fail("Application not found.", 404);
      return NextResponse.json({
        events: await db()
          .prepare(
            "SELECT * FROM application_events WHERE tenant_id=? AND application_id=? ORDER BY _rowid DESC LIMIT 30",
          )
          .all(a.tenantId, rid),
        requirements: await db()
          .prepare(
            "SELECT * FROM requirements WHERE tenant_id=? AND application_id=? ORDER BY created_at,id",
          )
          .all(a.tenantId, rid),
        snapshots: await db()
          .prepare(
            "SELECT id,created_at,created_by FROM application_snapshots WHERE tenant_id=? AND application_id=? ORDER BY created_at DESC",
          )
          .all(a.tenantId, rid),
      });
    }
    if (resource === "team") {
      if (!isStaff(a)) return fail("Team access is not permitted.", 403);
      return NextResponse.json({
        members: await db()
          .prepare(
            "SELECT u.id,u.name,u.email,m.role,m.person_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role!=? ORDER BY u.name",
          )
          .all(a.tenantId, "platform_admin"),
      });
    }
    if (resource === "documents" && rid && action === "versions") {
      const doc = (await db()
        .prepare(
          "SELECT person_id,section_key FROM documents WHERE id=? AND tenant_id=?",
        )
        .get(rid, a.tenantId)) as
        | {
            person_id: string;
            section_key: string;
          }
        | undefined;
      if (
        !doc ||
        !(await canSeePerson(a, doc.person_id)) ||
        (sections.find((s) => s.key === doc.section_key)?.restricted &&
          !["owner", "student"].includes(a.role))
      )
        return fail("Document not found.", 404);
      return NextResponse.json({
        versions: await db()
          .prepare(
            "SELECT version,original_name,mime_type,byte_size,created_at FROM document_versions WHERE tenant_id=? AND document_id=? ORDER BY version DESC",
          )
          .all(a.tenantId, rid),
      });
    }
    if (resource === "students" && rid) {
      if (!(await canSeePerson(a, rid)))
        return fail("Applicant not found.", 404);
      return NextResponse.json({
        person: await person(a, rid),
        sections: (await intake(a, rid)).filter(
          (s) =>
            !sections.find((def) => def.key === s.section_key)?.restricted ||
            a.role === "owner" ||
            a.role === "student",
        ),
      });
    }
    if (resource === "documents" && rid && action === "download") {
      const requested =
        Number(new URL(req.url).searchParams.get("version")) || null;
      const row = (await db()
        .prepare(
          "SELECT d.person_id,d.section_key,v.* FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.version=coalesce(?,d.current_version) AND v.tenant_id=d.tenant_id WHERE d.id=? AND d.tenant_id=?",
        )
        .get(requested, rid, a.tenantId)) as
        | {
            person_id: string;
            section_key: string;
            stored_name: string;
            mime_type: string;
            original_name: string;
          }
        | undefined;
      if (
        !row ||
        !(await canSeePerson(a, row.person_id)) ||
        (sections.find((s) => s.key === row.section_key)?.restricted &&
          !["owner", "student"].includes(a.role))
      )
        return fail("Document not found.", 404);
      const bytes = readFileSync(resolve(dataDir, "uploads", row.stored_name));
      const inline = new URL(req.url).searchParams.get("inline") === "1";
      return new Response(bytes, {
        headers: {
          "Content-Type": row.mime_type,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="document${row.mime_type === "application/pdf" ? ".pdf" : row.mime_type === "image/png" ? ".png" : ".jpg"}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (resource === "platform" && a.role === "platform_admin")
      return NextResponse.json({
        tenants: await db()
          .prepare(
            "SELECT t.*,s.plan,s.status,s.features_json,s.seats,s.case_limit,s.storage_mb,s.expires_at,(SELECT requested_at FROM upgrade_requests u WHERE u.tenant_id=t.id AND u.status='pending') AS upgrade_requested_at,(SELECT count(*) FROM people p WHERE p.tenant_id=t.id) AS case_count FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id ORDER BY t.created_at DESC",
          )
          .all(),
        activity: await db()
          .prepare(
            "SELECT * FROM audit WHERE entity_type IN ('workspace','subscription') ORDER BY _rowid DESC LIMIT 20",
          )
          .all(),
      });
    return fail("Not found.", 404);
  }
  ensureOrigin(req);
  if (
    resource === "documents" &&
    req.method === "POST" &&
    (!rid || action === "version")
  ) {
    if (a.role === "platform_admin" || !(await writable(a)))
      return fail("Workspace is read-only.", 403);
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 16 * 1024 * 1024)
      return fail("Files must be 15 MB or smaller.", 413);
    const form = await req.formData(),
      file = form.get("file"),
      pid = String(form.get("personId") || "");
    if (!(await canSeePerson(a, pid))) return fail("Applicant not found.", 404);
    const sectionKey = String(form.get("sectionKey") || "");
    if (
      sections.find((s) => s.key === sectionKey)?.restricted &&
      !["owner", "student"].includes(a.role)
    )
      return fail("Restricted evidence section.", 403);
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > 15 * 1024 * 1024
    )
      return fail("Choose a PDF, PNG or JPEG up to 15 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    let mime = "";
    if (bytes.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
    else if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      mime = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = "image/jpeg";
    if (!mime)
      return fail("Only PDF, PNG and JPEG file contents are supported.");
    const quota = (await db()
      .prepare("SELECT storage_mb FROM subscriptions WHERE tenant_id=?")
      .get(a.tenantId)) as {
      storage_mb: number;
    };
    const usage = (await db()
      .prepare(
        "SELECT coalesce(sum(byte_size),0) AS total FROM document_versions WHERE tenant_id=?",
      )
      .get(a.tenantId)) as {
      total: number;
    };
    if (usage.total + file.size > quota.storage_mb * 1024 * 1024)
      return fail("Workspace storage allowance reached.", 403);
    let docId = rid || id(),
      version = 1;
    if (rid) {
      const existing = (await db()
        .prepare(
          "SELECT person_id,section_key,current_version FROM documents WHERE id=? AND tenant_id=?",
        )
        .get(rid, a.tenantId)) as
        | {
            person_id: string;
            section_key: string;
            current_version: number;
          }
        | undefined;
      if (
        !existing ||
        existing.person_id !== pid ||
        (sections.find((s) => s.key === existing.section_key)?.restricted &&
          !["owner", "student"].includes(a.role))
      )
        return fail("Document not found.", 404);
      version = existing.current_version + 1;
    }
    const runId = String(form.get("importRunId") || ""),
      sourcePath = String(form.get("sourcePath") || file.name)
        .replace(/[\r\n]/g, "")
        .slice(0, 1000);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const requestUpload = await prepareRequestUpload(a, form, pid, sha);
    if (requestUpload && rid)
      return fail(
        "Upload a new response document here; existing file versions update their linked requests separately.",
      );
    if (requestUpload && runId)
      return fail(
        "Folder imports and request replies are separate operations.",
      );
    if (requestUpload?.replay)
      return NextResponse.json({
        id: requestUpload.replay.document_id,
        version: requestUpload.replay.document_version,
        replyId: requestUpload.replay.id,
        replayed: true,
      });
    if (runId) {
      const run = (await db()
        .prepare("SELECT person_id FROM import_runs WHERE id=? AND tenant_id=?")
        .get(runId, a.tenantId)) as
        | {
            person_id: string;
          }
        | undefined;
      if (!run || run.person_id !== pid)
        return fail("Import does not match selected applicant.");
      const duplicate = (await db()
        .prepare(
          "SELECT d.id,d.current_version FROM document_versions v JOIN documents d ON d.id=v.document_id AND d.tenant_id=v.tenant_id WHERE v.sha256=? AND v.tenant_id=? AND d.person_id=? LIMIT 1",
        )
        .get(sha, a.tenantId, pid)) as
        | {
            id: string;
            current_version: number;
          }
        | undefined;
      if (duplicate) {
        await db()
          .prepare(
            "INSERT INTO import_items(id,tenant_id,run_id,source_path,document_id,status) VALUES(?,?,?,?,?,?) ON CONFLICT (run_id,source_path) DO UPDATE SET document_id=EXCLUDED.document_id,status=EXCLUDED.status",
          )
          .run(
            id(),
            a.tenantId,
            runId,
            sourcePath,
            duplicate.id,
            "Duplicate linked",
          );
        let readingJobId = "";
        if (form.get("readInformation") === "true") {
          try {
            readingJobId = String(
              (await queueReading(a, duplicate.id, duplicate.current_version))
                .id,
            );
          } catch {
            /* The existing original remains available even when reading is disabled. */
          }
        }
        return NextResponse.json({
          id: duplicate.id,
          duplicate: true,
          readingJobId,
        });
      }
    }
    const stored = id();
    mkdirSync(resolve(dataDir, "uploads"), { recursive: true, mode: 0o700 });
    writeFileSync(resolve(dataDir, "uploads", stored), bytes, { mode: 0o600 });
    try {
      const transactionResult = await withTransaction(async () => {
        if (!rid)
          await db()
            .prepare(
              "INSERT INTO documents(id,tenant_id,person_id,title,category,section_key) VALUES(?,?,?,?,?,?)",
            )
            .run(
              docId,
              a.tenantId,
              pid,
              String(form.get("title") || file.name).slice(0, 200),
              String(form.get("category") || "Other").slice(0, 80),
              String(form.get("sectionKey") || "").slice(0, 80),
            );
        else
          await db()
            .prepare(
              "UPDATE documents SET current_version=?,status='Received' WHERE id=? AND tenant_id=?",
            )
            .run(version, docId, a.tenantId);
        await db()
          .prepare(
            "INSERT INTO document_versions(id,tenant_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            a.tenantId,
            docId,
            version,
            file.name.replace(/[\r\n]/g, "").slice(0, 220),
            stored,
            mime,
            file.size,
            createHash("sha256").update(bytes).digest("hex"),
          );
        await db()
          .prepare(
            "UPDATE document_versions SET source_path=? WHERE document_id=? AND version=? AND tenant_id=?",
          )
          .run(sourcePath, docId, version, a.tenantId);
        if (runId)
          await db()
            .prepare(
              "INSERT INTO import_items(id,tenant_id,run_id,source_path,document_id,status) VALUES(?,?,?,?,?,?) ON CONFLICT (run_id,source_path) DO UPDATE SET document_id=EXCLUDED.document_id,status=EXCLUDED.status",
            )
            .run(id(), a.tenantId, runId, sourcePath, docId, "Imported");
        await audit(
          a.tenantId,
          a.id,
          "uploaded",
          "document",
          docId,
          `Uploaded document version ${version}`,
        );
        if (rid) await requestDocumentChanged(a, docId, version);
        if (requestUpload)
          await saveReply(a, requestUpload.r, {
            message: requestUpload.data.message,
            documentId: docId,
            documentVersion: version,
            timezone: requestUpload.data.timezone,
            clientKey: requestUpload.data.clientKey,
            payloadHash: requestUpload.hash,
          });
      });
      if (transactionResult !== undefined) return transactionResult;
    } catch (e) {
      unlinkSync(resolve(dataDir, "uploads", stored));
      throw e;
    }
    let readingJobId = "",
      readingError = "";
    if (form.get("readInformation") === "true") {
      try {
        readingJobId = String((await queueReading(a, docId, version)).id);
      } catch (e) {
        readingError =
          e instanceof ReadingError
            ? e.message
            : "File saved. Use Document reader to retry reading.";
      }
    }
    return NextResponse.json({
      id: docId,
      version,
      readingJobId,
      readingError,
    });
  }
  const body = await req.json();
  if (resource === "vouchers" && req.method === "POST")
    return voucherWrite(a, body);
  if (resource === "billing" && rid === "request" && req.method === "POST") {
    if (a.role !== "owner")
      return fail("Only the workspace owner can request activation.", 403);
    await db()
      .prepare(
        "INSERT INTO upgrade_requests(tenant_id,requested_by,requested_at) VALUES(?,?,?) ON CONFLICT(tenant_id) DO NOTHING",
      )
      .run(a.tenantId, a.id, Date.now());
    return NextResponse.json({
      ok: true,
      message:
        "Your activation request is saved for the platform administrator. No payment has been taken.",
    });
  }
  if (
    resource === "planning" &&
    req.method === "POST" &&
    typeof body.action === "string" &&
    body.action.startsWith("wording-")
  )
    return wordingWrite(a, body);
  if (resource === "planning" && req.method === "POST")
    return planningWrite(a, body);
  if (resource === "reading" && req.method === "POST")
    return readingWrite(a, body);
  if (resource === "finance" && req.method === "POST")
    return financeWrite(a, body);
  if (resource === "assignments" && req.method === "POST")
    return assignmentWrite(a, body);
  if (resource === "pipelines" && req.method === "POST")
    return pipelineWrite(a, body);
  if (resource === "scheduling" && req.method === "POST")
    return schedulingWrite(a, body);
  if (resource === "focus" && rid === "interpret" && req.method === "POST")
    return focusInterpret(a, body);
  if (resource === "focus" && req.method === "POST")
    return focusMutation(a, body);
  const requestChange = await requestMutation(
    req,
    parts,
    a,
    body,
    await writable(a),
  );
  if (requestChange) return requestChange;
  const progress = await progressMutation(req, parts, a, body);
  if (progress) return progress;
  const crm = await crmMutation(req, parts, a, body);
  if (crm) return crm;
  if (resource === "imports" && req.method === "POST" && !rid) {
    if (a.role === "platform_admin" || !(await writable(a)))
      return fail("Workspace is read-only.", 403);
    const input = z
      .object({
        personId: z.string(),
        name: string.min(1).max(200),
        count: z.number().int().min(1).max(100),
      })
      .parse(body);
    if (!(await canSeePerson(a, input.personId)))
      return fail("Applicant not found.", 404);
    const runId = id();
    await db()
      .prepare(
        "INSERT INTO import_runs(id,tenant_id,person_id,name,expected_count,created_by) VALUES(?,?,?,?,?,?)",
      )
      .run(runId, a.tenantId, input.personId, input.name, input.count, a.id);
    return NextResponse.json({ id: runId });
  }
  if (resource === "imports" && rid && req.method === "PATCH") {
    const run = (await db()
      .prepare("SELECT person_id FROM import_runs WHERE id=? AND tenant_id=?")
      .get(rid, a.tenantId)) as
      | {
          person_id: string;
        }
      | undefined;
    if (!run || !(await canSeePerson(a, run.person_id)))
      return fail("Import not found.", 404);
    const input = z
      .object({ status: z.enum(["Complete", "Needs attention"]) })
      .parse(body);
    await db()
      .prepare("UPDATE import_runs SET status=? WHERE id=? AND tenant_id=?")
      .run(input.status, rid, a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      "imported",
      "person",
      run.person_id,
      "Finished a selected-file import (" + input.status + ")",
    );
    return NextResponse.json({ ok: true });
  }
  if (resource === "requirements" && req.method === "POST" && !rid) {
    if (!(await staff(a)))
      return fail("Checklist management is not permitted.", 403);
    const input = z
      .object({
        applicationId: z.string(),
        label: string.min(2).max(200),
        sectionKey: optionalString,
        required: z.boolean(),
      })
      .parse(body);
    const app = await db()
      .prepare("SELECT person_id FROM applications WHERE id=? AND tenant_id=?")
      .get(input.applicationId, a.tenantId);
    if (!app) return fail("Application not found.", 404);
    const rId = id();
    await db()
      .prepare(
        "INSERT INTO requirements(id,tenant_id,application_id,label,section_key,required) VALUES(?,?,?,?,?,?)",
      )
      .run(
        rId,
        a.tenantId,
        input.applicationId,
        input.label,
        input.sectionKey,
        Number(input.required),
      );
    return NextResponse.json({ id: rId });
  }
  if (resource === "requirements" && rid && req.method === "PATCH") {
    if (!(await writable(a))) return fail("Workspace is read-only.", 403);
    const input = z
      .object({
        status: z.enum(["Pending", "Provided", "Reviewed", "Waived"]),
        note: z.string().max(2000).default(""),
      })
      .parse(body);
    const r = (await db()
      .prepare(
        "SELECT a.person_id FROM requirements r JOIN applications a ON a.id=r.application_id AND a.tenant_id=r.tenant_id WHERE r.id=? AND r.tenant_id=?",
      )
      .get(rid, a.tenantId)) as
      | {
          person_id: string;
        }
      | undefined;
    if (!r || !(await canSeePerson(a, r.person_id)))
      return fail("Requirement not found.", 404);
    if (!isStaff(a) && !["Pending", "Provided"].includes(input.status))
      return fail("Only staff can review or waive an item.", 403);
    if (input.status === "Waived" && !input.note.trim())
      return fail("Give a reason before waiving this item.");
    await db()
      .prepare(
        "UPDATE requirements SET status=?,note=? WHERE id=? AND tenant_id=?",
      )
      .run(input.status, input.note, rid, a.tenantId);
    await audit(
      a.tenantId,
      a.id,
      "reviewed",
      "requirement",
      rid,
      "Updated an application checklist item",
    );
    return NextResponse.json({ ok: true });
  }
  if (resource === "assist-tokens" && req.method === "POST" && !rid) {
    if (!(await writable(a)) || a.role === "platform_admin")
      return fail("Not permitted.", 403);
    const input = z
      .object({
        personId: z.string(),
        sectionKeys: z.array(z.string()).min(1).max(12),
        includeDocuments: z.boolean().default(false),
      })
      .parse(body);
    if (!(await canSeePerson(a, input.personId)))
      return fail("Applicant not found.", 404);
    if (input.sectionKeys.some((k) => !assistAllowed(k)))
      return fail("Choose only supported reusable-information sections.");
    const token = randomBytes(32).toString("base64url"),
      tid = id(),
      expires = Date.now() + 3600000;
    await db()
      .prepare(
        "INSERT INTO assist_tokens(id,token_hash,tenant_id,user_id,person_id,section_keys,expires_at,allow_documents) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        tid,
        createHash("sha256").update(token).digest("hex"),
        a.tenantId,
        a.id,
        input.personId,
        JSON.stringify(input.sectionKeys),
        expires,
        input.includeDocuments,
      );
    await audit(
      a.tenantId,
      a.id,
      "paired",
      "person",
      input.personId,
      "Created a one-hour, read-only browser assistant token",
    );
    return NextResponse.json({ id: tid, token, expiresAt: expires });
  }
  if (resource === "assist-tokens" && rid && req.method === "PATCH") {
    const result = await db()
      .prepare(
        "UPDATE assist_tokens SET revoked=1 WHERE id=? AND tenant_id=? AND user_id=?",
      )
      .run(rid, a.tenantId, a.id);
    if (!result.changes) return fail("Pairing not found.", 404);
    return NextResponse.json({ ok: true });
  }
  if (resource === "team" && req.method === "POST" && !rid) {
    if (a.role !== "owner" || !(await writable(a)))
      return fail("Only the active workspace owner can add members.", 403);
    const input = z
      .object({
        name: string.min(2).max(100),
        email: z.email().max(254),
        password: z.string().min(12).max(128),
        role: z.enum(["consultant", "student"]),
        personId: optionalString,
      })
      .parse(body);
    if (
      input.role === "student" &&
      (!input.personId || !(await canSeePerson(a, input.personId)))
    )
      return fail("Choose a valid applicant for student access.");
    if (
      await db()
        .prepare("SELECT id FROM users WHERE email=?")
        .get(input.email.toLowerCase())
    )
      return fail("This email is already registered.", 409);
    const uid = id();
    try {
      const transactionResult = await withTransaction(async () => {
        const sub = (await db()
          .prepare("SELECT seats FROM subscriptions WHERE tenant_id=?")
          .get(a.tenantId)) as {
          seats: number;
        };
        const used = (await db()
          .prepare(
            "SELECT count(*) AS n FROM memberships WHERE tenant_id=? AND role IN ('owner','consultant')",
          )
          .get(a.tenantId)) as {
          n: number;
        };
        if (input.role === "consultant" && used.n >= sub.seats)
          return fail("Staff seat allowance reached.", 403);

        await db()
          .prepare(
            "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
          )
          .run(
            uid,
            input.name,
            input.email.toLowerCase(),
            hashPassword(input.password),
          );
        await db()
          .prepare(
            "INSERT INTO memberships(user_id,tenant_id,role,person_id) VALUES(?,?,?,?)",
          )
          .run(
            uid,
            a.tenantId,
            input.role,
            input.role === "student" ? input.personId : null,
          );
        await audit(
          a.tenantId,
          a.id,
          "created",
          "membership",
          uid,
          "Added a workspace member",
        );
      });
      if (transactionResult !== undefined) return transactionResult;
    } catch (e) {
      throw e;
    }
    return NextResponse.json({ id: uid });
  }
  if (resource === "students" && !rid && req.method === "POST") {
    if (!(await staff(a)))
      return fail("Creating applicants is not permitted.", 403);
    const input = z
      .object({
        name: string.min(2).max(100),
        email: z.email().max(254),
        destination: optionalString,
        course: optionalString,
      })
      .parse(body);
    const email = input.email.toLowerCase();
    if (
      await db()
        .prepare(
          "SELECT id FROM people WHERE tenant_id=? AND lower(email)=lower(?)",
        )
        .get(a.tenantId, email)
    )
      return fail("This email already belongs to an applicant.", 409);
    if (
      await db()
        .prepare(
          "SELECT id FROM leads WHERE tenant_id=? AND lower(email)=lower(?)",
        )
        .get(a.tenantId, email)
    )
      return fail(
        "This email belongs to a lead. Register that lead to retain its history and fees.",
        409,
      );
    input.email = email;
    const sub = (await db()
      .prepare("SELECT case_limit FROM subscriptions WHERE tenant_id=?")
      .get(a.tenantId)) as {
      case_limit: number;
    };
    const count = (await db()
      .prepare("SELECT count(*) AS n FROM people WHERE tenant_id=?")
      .get(a.tenantId)) as {
      n: number;
    };
    if (count.n >= sub.case_limit)
      return fail("Your active case allowance has been reached.", 403);
    const pid = id();
    await db()
      .prepare(
        "INSERT INTO people(id,tenant_id,name,email,destination,course,initials) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        pid,
        a.tenantId,
        input.name,
        input.email,
        input.destination,
        input.course,
        input.name
          .split(" ")
          .map((s) => s[0])
          .join("")
          .slice(0, 2),
      );
    await audit(
      a.tenantId,
      a.id,
      "created",
      "person",
      pid,
      "Created an applicant",
    );
    return NextResponse.json({ id: pid });
  }
  if (
    resource === "students" &&
    rid &&
    action === "intake" &&
    req.method === "PUT"
  ) {
    if (!(await canSeePerson(a, rid))) return fail("Applicant not found.", 404);
    if (!(await writable(a))) return fail("Workspace is read-only.", 403);
    const input = z
      .object({
        sectionKey: z.string(),
        data: z.record(z.string(), z.unknown()),
        state: z.enum(["draft", "skipped", "ready"]),
        revision: z.number().int().nonnegative(),
      })
      .parse(body);
    const section = sections.find((s) => s.key === input.sectionKey);
    if (!section) return fail("Unknown section.");
    if (section.restricted && !["owner", "student"].includes(a.role))
      return fail("Restricted section.", 403);
    if (JSON.stringify(input.data).length > 100000)
      return fail("Section is too large.");
    const allowed = new Set([...section.fields.map((f) => f.key), "_id"]);
    const validateRecord = (r: unknown) => {
      if (typeof r !== "object" || !r || Array.isArray(r)) return false;
      return Object.entries(r).every(
        ([k, v]) =>
          allowed.has(k) && typeof v === "string" && v.length <= 10000,
      );
    };
    if (section.repeatable) {
      const items = input.data.items;
      if (
        !Array.isArray(items) ||
        items.length > 100 ||
        !items.every(validateRecord)
      )
        return fail("Invalid repeated record data.");
    } else if (!validateRecord(input.data))
      return fail("Invalid section data.");
    const current = (await db()
      .prepare(
        "SELECT revision FROM intake WHERE tenant_id=? AND person_id=? AND section_key=?",
      )
      .get(a.tenantId, rid, input.sectionKey)) as
      | {
          revision: number;
        }
      | undefined;
    const rev = current?.revision || 0;
    if (rev !== input.revision)
      return fail(
        "This section changed elsewhere. Reload the latest version before saving.",
        409,
      );
    if (current) {
      const result = await db()
        .prepare(
          "UPDATE intake SET data=?,state=?,revision=revision+1,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=? AND person_id=? AND section_key=? AND revision=?",
        )
        .run(
          JSON.stringify(input.data),
          input.state,
          a.tenantId,
          rid,
          input.sectionKey,
          rev,
        );
      if (result.changes !== 1)
        return fail("Another edit arrived. Reload before saving.", 409);
    } else {
      await db()
        .prepare(
          "INSERT INTO intake(tenant_id,person_id,section_key,data,state) VALUES(?,?,?,?,?)",
        )
        .run(
          a.tenantId,
          rid,
          input.sectionKey,
          JSON.stringify(input.data),
          input.state,
        );
    }
    await audit(
      a.tenantId,
      a.id,
      "saved",
      "intake",
      rid,
      `Saved ${section.title} (${input.state})`,
    );
    return NextResponse.json({
      revision: rev + 1,
      savedAt: new Date().toISOString(),
    });
  }
  if (resource === "tasks" && req.method === "POST" && !rid) {
    if (!(await staff(a)))
      return fail("Task management is not permitted.", 403);
    const input = z
      .object({
        ...impactFields,
        title: string.min(2).max(200),
        category: z.string().trim().max(60).default(""),
        personId: optionalString,
        important: z.boolean(),
        urgent: z.boolean(),
        dueDate: optionalString,
        assignee: optionalString,
        projectId: optionalString,
        goalIds: z.array(z.string().max(100)).max(20).default([]),
      })
      .parse(body);
    if (input.personId && !(await canSeePerson(a, input.personId)))
      return fail("Applicant not found.", 404);
    if (
      input.projectId &&
      !(await db()
        .prepare("SELECT id FROM projects WHERE id=? AND tenant_id=?")
        .get(input.projectId, a.tenantId))
    )
      return fail("Project not found in this workspace.", 404);
    const goalIds = [...new Set(input.goalIds)];
    for (const gid of goalIds)
      if (
        !(await db()
          .prepare("SELECT id FROM goals WHERE id=? AND tenant_id=?")
          .get(gid, a.tenantId))
      )
        return fail("Goal not found in this workspace.", 404);
    return await transaction(async () => {
      const tid = id();
      await db()
        .prepare(
          "INSERT INTO tasks(id,tenant_id,person_id,title,important,urgent,due_date,assignee,last_actor_id,project_id,category,value_type,value_minor,value_currency,value_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          tid,
          a.tenantId,
          input.personId || null,
          input.title,
          Number(input.important),
          Number(input.urgent),
          input.dueDate,
          input.assignee,
          a.id,
          input.projectId,
          input.category,
          ...impactValues(input),
        );
      for (const gid of goalIds)
        await db()
          .prepare(
            "INSERT INTO task_goals(tenant_id,task_id,goal_id) VALUES(?,?,?)",
          )
          .run(a.tenantId, tid, gid);
      await audit(a.tenantId, a.id, "created", "task", tid, "Created a task");
      return NextResponse.json({ id: tid });
    });
  }
  if (resource === "tasks" && rid && req.method === "PATCH") {
    if (!(await staff(a)))
      return fail("Task management is not permitted.", 403);
    const input = z
      .object({
        ...impactFields,
        stage: z.string().min(1).max(100),
        revision: z.number().int().positive(),
        title: z.string().trim().min(2).max(200).optional(),
        category: z.string().trim().max(60).optional(),
        dueDate: z.union([z.literal(""), z.iso.date()]).optional(),
        assignee: z.string().max(100).optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
      })
      .parse(body);
    if (!(await validStage(a.tenantId, "tasks", input.stage)))
      return fail("Choose an active task stage.", 400);
    const task = (await db()
      .prepare("SELECT * FROM tasks WHERE id=? AND tenant_id=?")
      .get(rid, a.tenantId)) as
      | {
          value_type: string;
          value_minor: number | null;
          value_currency: string;
          value_note: string;
          title: string;
          category: string;
          due_date: string;
          assignee: string;
          important: number;
          urgent: number;
        }
      | undefined;
    if (!task) return fail("Task not found.", 404);
    if (
      input.assignee &&
      !(await db()
        .prepare(
          "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND u.name=? AND m.role IN ('owner','consultant')",
        )
        .get(a.tenantId, input.assignee))
    )
      return fail("Choose a team member from this workspace.", 400);
    const result = await db()
      .prepare(
        "UPDATE tasks SET stage=?,title=?,category=?,value_type=?,value_minor=?,value_currency=?,value_note=?,due_date=?,assignee=?,important=?,urgent=?,last_actor_id=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
      )
      .run(
        input.stage,
        input.title ?? task.title,
        input.category ?? task.category,
        ...impactValues(input, task),
        input.dueDate ?? task.due_date,
        input.assignee ?? task.assignee,
        input.important === undefined
          ? task.important
          : Number(input.important),
        input.urgent === undefined ? task.urgent : Number(input.urgent),
        a.id,
        rid,
        a.tenantId,
        input.revision,
      );
    if (result.changes !== 1)
      return fail("Task changed elsewhere. Refresh and retry.", 409);
    await audit(
      a.tenantId,
      a.id,
      "updated",
      "task",
      rid,
      "Updated task stage / priority",
    );
    return NextResponse.json({ ok: true });
  }
  if (resource === "applications" && !rid && req.method === "POST") {
    if (!(await staff(a)))
      return fail("Application management is not permitted.", 403);
    const input = z
      .object({
        personId: string.min(1),
        kind: z.enum([
          "Admission",
          "Study visa",
          "Visitor visa",
          "Schengen visa",
          "Scholarship",
        ]),
        country: string.min(1),
        institution: optionalString,
        program: optionalString,
        intake: optionalString,
      })
      .parse(body);
    if (!(await canSeePerson(a, input.personId)))
      return fail("Applicant not found.", 404);
    const aid = id();
    await db()
      .prepare(
        "INSERT INTO applications(id,tenant_id,person_id,kind,country,institution,program,intake) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        aid,
        a.tenantId,
        input.personId,
        input.kind,
        input.country,
        input.institution,
        input.program,
        input.intake,
      );
    await createChecklist(aid, a.tenantId, input.kind);
    await audit(
      a.tenantId,
      a.id,
      "created",
      "application",
      aid,
      "Created an application draft",
    );
    return NextResponse.json({ id: aid });
  }
  if (
    resource === "applications" &&
    rid &&
    action === "details" &&
    req.method === "PATCH"
  ) {
    if (!(await staff(a)))
      return fail("Application management is not permitted.", 403);
    const v = z
      .object({
        institution: optionalString,
        program: optionalString,
        intake: optionalString,
        revision: z.number().int().positive(),
      })
      .parse(body);
    return await transaction(async () => {
      const app = await db()
        .prepare("SELECT * FROM applications WHERE id=? AND tenant_id=?")
        .get(rid, a.tenantId);
      if (!app) return fail("Application not found.", 404);
      if (app.revision !== v.revision)
        return fail("Application changed elsewhere. Refresh first.", 409);
      if (
        !["Draft", "Collecting", "Review", "Ready"].includes(String(app.status))
      )
        return fail(
          "Tracking details can be edited during preparation. Create a separate case for a different external application.",
          409,
        );
      const status = app.status === "Ready" ? "Review" : String(app.status);
      await db()
        .prepare(
          "UPDATE applications SET institution=?,program=?,intake=?,status=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(
          v.institution,
          v.program,
          v.intake,
          status,
          rid,
          a.tenantId,
          v.revision,
        );
      if (status !== app.status)
        await db()
          .prepare(
            "INSERT INTO application_events(id,tenant_id,application_id,from_status,to_status,note,created_by) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            a.tenantId,
            rid,
            app.status,
            status,
            "Tracking details changed; readiness review required again.",
            a.id,
          );
      await audit(
        a.tenantId,
        a.id,
        "details updated",
        "application",
        rid,
        "Updated application institution, program and intake",
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (resource === "applications" && rid && req.method === "PATCH") {
    if (!(await staff(a)))
      return fail("Application management is not permitted.", 403);
    const input = z
      .object({
        status: z.string().min(1).max(100),
        revision: z.number().int().positive(),
        submissionReference: optionalString,
        note: z.string().trim().max(2000).default(""),
        sourceUrl: z
          .string()
          .trim()
          .max(2000)
          .refine(
            (v) => !v || /^https?:\/\//i.test(v),
            "Use a full http or https link.",
          )
          .default(""),
        documentId: optionalString,
      })
      .parse(body);
    if (!(await validStage(a.tenantId, "applications", input.status)))
      return fail("Choose an active application stage.");
    if (input.status === "Submitted" && !input.submissionReference)
      return fail(
        "Add the actual portal submission reference before recording submission.",
      );
    const app = (await db()
      .prepare("SELECT * FROM applications WHERE id=? AND tenant_id=?")
      .get(rid, a.tenantId)) as
      | {
          person_id: string;
          status: string;
        }
      | undefined;
    if (!app) return fail("Application not found.", 404);
    let evidenceVersion = 0;
    if (input.documentId) {
      const doc = await db()
        .prepare(
          "SELECT current_version FROM documents WHERE id=? AND tenant_id=? AND person_id=?",
        )
        .get(input.documentId, a.tenantId, app.person_id);
      if (!doc) return fail("Evidence must belong to this applicant.", 400);
      evidenceVersion = Number(doc.current_version);
    }
    if (input.status === "Ready") {
      const missing = (await db()
        .prepare(
          "SELECT count(*) AS n FROM requirements WHERE application_id=? AND tenant_id=? AND required=1 AND status NOT IN ('Reviewed','Waived')",
        )
        .get(rid, a.tenantId)) as {
        n: number;
      };
      if (missing.n > 0)
        return fail(
          "Review or explicitly waive all mandatory working-checklist items before marking Ready.",
        );
    }
    return await transaction(async () => {
      const result = await db()
        .prepare(
          "UPDATE applications SET status=?,submission_reference=CASE WHEN ?!='' THEN ? ELSE submission_reference END,submitted_at=CASE WHEN ?='Submitted' THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE submitted_at END,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=?",
        )
        .run(
          input.status,
          input.submissionReference,
          input.submissionReference,
          input.status,
          rid,
          a.tenantId,
          input.revision,
        );
      if (result.changes !== 1)
        return fail("Application changed elsewhere.", 409);
      await db()
        .prepare(
          "INSERT INTO application_events(id,tenant_id,application_id,from_status,to_status,note,source_url,document_id,document_version,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          a.tenantId,
          rid,
          app.status,
          input.status,
          input.note,
          input.sourceUrl,
          input.documentId,
          evidenceVersion,
          a.id,
        );
      await audit(
        a.tenantId,
        a.id,
        "updated",
        "application",
        rid,
        `Set status to ${input.status}${input.submissionReference ? " · reference " + input.submissionReference : ""}`,
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (
    resource === "applications" &&
    rid &&
    action === "snapshot" &&
    req.method === "POST"
  ) {
    if (!(await staff(a)))
      return fail("Snapshot creation is not permitted.", 403);
    const app = (await db()
      .prepare("SELECT * FROM applications WHERE id=? AND tenant_id=?")
      .get(rid, a.tenantId)) as
      | {
          person_id: string;
        }
      | undefined;
    if (!app) return fail("Application not found.", 404);
    const snapshotId = id();
    const payload = {
      application: app,
      person: await person(a, app.person_id),
      sections: (await intake(a, app.person_id)).filter(
        (s) => !sections.find((def) => def.key === s.section_key)?.restricted,
      ),
      documents: (await documents(a))
        .filter((d) => d.person_id === app.person_id)
        .map((d) => ({
          id: d.id,
          version: d.current_version,
          title: d.title,
          status: d.status,
        })),
      note: "Preparation snapshot, not proof of submission or verified legal readiness.",
    };
    await db()
      .prepare(
        "INSERT INTO application_snapshots(id,tenant_id,application_id,payload,created_by) VALUES(?,?,?,?,?)",
      )
      .run(snapshotId, a.tenantId, rid, JSON.stringify(payload), a.id);
    await audit(
      a.tenantId,
      a.id,
      "snapshotted",
      "application",
      rid,
      "Saved a preparation snapshot",
    );
    return NextResponse.json({ id: snapshotId, payload });
  }
  if (resource === "documents" && rid && req.method === "PATCH") {
    if (!(await staff(a)))
      return fail("Document review is not permitted.", 403);
    const input = z
      .object({
        status: z.enum([
          "Received",
          "Needs review",
          "Changes requested",
          "Reviewed",
        ]),
        title: string.min(1).max(200),
        category: string.max(80),
        sectionKey: optionalString,
      })
      .parse(body);
    const prior = (await db()
      .prepare("SELECT section_key FROM documents WHERE id=? AND tenant_id=?")
      .get(rid, a.tenantId)) as
      | {
          section_key: string;
        }
      | undefined;
    if (!prior) return fail("Document not found.", 404);
    if (
      (sections.find((s) => s.key === prior.section_key)?.restricted ||
        sections.find((s) => s.key === input.sectionKey)?.restricted) &&
      a.role !== "owner"
    )
      return fail("Restricted evidence section.", 403);
    return await transaction(async () => {
      const result = await db()
        .prepare(
          "UPDATE documents SET status=?,title=?,category=?,section_key=? WHERE id=? AND tenant_id=?",
        )
        .run(
          input.status,
          input.title,
          input.category,
          input.sectionKey,
          rid,
          a.tenantId,
        );
      if (!result.changes) return fail("Document not found.", 404);
      await requestDocumentReviewChanged(a, rid, input.status);
      await audit(
        a.tenantId,
        a.id,
        "reviewed",
        "document",
        rid,
        "Updated document review / organization",
      );
      return NextResponse.json({ ok: true });
    });
  }
  if (resource === "requests" && !rid && req.method === "POST") {
    if (!(await staff(a)))
      return fail("Creating requests is not permitted.", 403);
    const input = z
      .object({
        personId: string.min(1),
        sectionKey: optionalString,
        title: string.min(2).max(200),
        message: string.min(2).max(2000),
        requiresDocument: z.boolean().default(false),
      })
      .parse(body);
    if (!(await canSeePerson(a, input.personId)))
      return fail("Applicant not found.", 404);
    const section = sections.find((s) => s.key === input.sectionKey);
    if (input.sectionKey && !section)
      return fail("Choose a known question group.");
    if (section?.restricted && a.role !== "owner")
      return fail("Restricted information request.", 403);
    const requestId = id();
    await db()
      .prepare(
        "INSERT INTO requests(id,tenant_id,person_id,section_key,title,message,created_by,requires_document) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        requestId,
        a.tenantId,
        input.personId,
        input.sectionKey,
        input.title,
        input.message,
        a.id,
        Number(input.requiresDocument),
      );
    await audit(
      a.tenantId,
      a.id,
      "requested",
      "person",
      input.personId,
      "Created an information request",
    );
    return NextResponse.json({ id: requestId });
  }
  if (resource === "platform" && a.role === "platform_admin") {
    if (req.method === "POST" && !rid) {
      const input = z
        .object({
          name: string.min(2).max(100),
          ownerName: string.min(2).max(100),
          ownerEmail: z.email().max(254),
          password: z.string().min(12).max(128),
          plan: z.enum(["Institute", "Individual", "Enterprise"]),
          seats: z.number().int().min(1).max(1000),
          caseLimit: z.number().int().min(1).max(100000),
          industry: z.enum([...industryKeys, ...legacyIndustryKeys]).optional(),
        })
        .parse(body);
      if (
        await db()
          .prepare("SELECT id FROM users WHERE email=?")
          .get(input.ownerEmail.toLowerCase())
      )
        return fail("Owner email already registered.", 409);
      const tid = id(),
        uid = id();
      try {
        const transactionResult = await withTransaction(async () => {
          await db()
            .prepare(
              "INSERT INTO tenants(id,name,type,industry) VALUES(?,?,?,?)",
            )
            .run(
              tid,
              input.name,
              input.plan === "Individual" ? "individual" : "institute",
              input.plan === "Individual"
                ? "individual"
                : input.industry || "education",
            );
          await db()
            .prepare(
              "INSERT INTO users(id,name,email,password_hash) VALUES(?,?,?,?)",
            )
            .run(
              uid,
              input.ownerName,
              input.ownerEmail.toLowerCase(),
              hashPassword(input.password),
            );
          await db()
            .prepare(
              "INSERT INTO memberships(user_id,tenant_id,role) VALUES(?,?,?)",
            )
            .run(uid, tid, "owner");
          await db()
            .prepare(
              "INSERT INTO subscriptions(tenant_id,plan,status,seats,case_limit,expires_at,trial_started_at) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              tid,
              input.plan,
              "trial",
              input.seats,
              input.caseLimit,
              trialExpiry(),
              Date.now(),
            );
          await audit(
            tid,
            a.id,
            "created",
            "workspace",
            tid,
            "Created a workspace and owner",
          );
        });
        if (transactionResult !== undefined) return transactionResult;
      } catch (e) {
        throw e;
      }
      return NextResponse.json({ id: tid });
    }
    if (req.method === "PATCH" && rid) {
      const input = z
        .object({
          plan: z.enum(["Institute", "Individual", "Enterprise"]),
          status: z.enum([
            "trial",
            "active",
            "grace",
            "read-only",
            "cancelled",
          ]),
          seats: z.number().int().min(1).max(1000),
          caseLimit: z.number().int().min(1).max(100000),
          industry: z.enum([...industryKeys, ...legacyIndustryKeys]).optional(),
          storageMb: z.number().int().min(1).max(1000000),
          expiresAt: z.string().max(10),
          features: z
            .array(z.enum(["crm", "tasks", "forms"]))
            .min(1)
            .max(3)
            .optional(),
        })
        .parse(body);
      const result = await db()
        .prepare(
          "UPDATE subscriptions SET features_json=COALESCE(?,features_json),plan=?,status=?,seats=?,case_limit=?,storage_mb=?,expires_at=?,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=?",
        )
        .run(
          input.features ? JSON.stringify([...new Set(input.features)]) : null,
          input.plan,
          input.status,
          input.seats,
          input.caseLimit,
          input.storageMb,
          input.status === "trial"
            ? input.expiresAt || trialExpiry()
            : input.expiresAt,
          rid,
        );
      if (!result.changes) return fail("Workspace not found.", 404);
      if (input.industry)
        await db()
          .prepare("UPDATE tenants SET industry=? WHERE id=?")
          .run(input.industry, rid);
      if (input.status === "active")
        await db()
          .prepare(
            "UPDATE upgrade_requests SET status='resolved' WHERE tenant_id=?",
          )
          .run(rid);
      await audit(
        rid,
        a.id,
        "updated",
        "subscription",
        rid,
        "Updated manual subscription entitlements",
      );
      return NextResponse.json({ ok: true });
    }
  }
  return fail("Action not found.", 404);
}
async function route(
  req: Request,
  ctx: {
    params: Promise<{
      path: string[];
    }>;
  },
) {
  try {
    const a = await actor();
    if (!a) return fail("Sign in to continue.", 401);
    if (
      a.role !== "platform_admin" &&
      !(await hasFeature(a.tenantId, requestFeature(req.url)))
    )
      return fail(
        "This feature is not included in your workspace access.",
        403,
      );
    const { path } = await ctx.params;
    return await handle(req, path, a);
  } catch (e) {
    if (e instanceof ReadingError) return fail(e.message, e.status);
    if (e instanceof RequestWorkflowError) return fail(e.message, e.status);
    if (e instanceof z.ZodError)
      return fail(e.issues[0]?.message || "Invalid input.");
    if (e instanceof Error && e.message === "ORIGIN")
      return fail("Origin not allowed.", 403);
    console.error(
      "Workspace request failed:",
      e instanceof Error ? e.message : "unknown",
    );
    return fail("Unable to complete the request. Please retry.", 500);
  }
}
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route;
