import { subscriptionAccess } from "./subscription-access.mjs";
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, id, audit, withTransaction } from "./db";
import { canSeePerson, isStaff } from "./auth";
import { sections } from "./sections";
import { getObject } from "./storage.mjs";
import type { Actor } from "./types";
export class ReadingError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const bad = (message: string, status = 400): never => {
  throw new ReadingError(message, status);
};
const enabled = () => process.env.HUMETO_OCR_ENABLED === "true";
async function writable(a: Actor) {
  if (a.role === "platform_admin") bad("Not permitted.", 403);
  const s = await db()
    .prepare("SELECT status,expires_at FROM subscriptions WHERE tenant_id=?")
    .get(a.tenantId);
  if (!subscriptionAccess(s)) bad("This workspace is read-only.", 403);
}
async function document(a: Actor, did: string, lock = false) {
  const doc = await db()
    .prepare(
      "SELECT * FROM documents WHERE id=? AND tenant_id=?" +
        (lock ? " FOR UPDATE" : ""),
    )
    .get(did, a.tenantId);
  if (
    !doc ||
    !(await canSeePerson(a, String(doc.person_id))) ||
    (sections.find((s) => s.key === doc.section_key)?.restricted &&
      !["owner", "student"].includes(a.role))
  )
    bad("Document not found.", 404);
  return doc!;
}
function field(sectionKey: string, fieldKey: string) {
  const section = sections.find((s) => s.key === sectionKey),
    f = section?.fields.find((f) => f.key === fieldKey);
  if (
    !section ||
    !f ||
    section.restricted ||
    f.sensitive ||
    section.key === "declarations"
  )
    bad("This field cannot receive document suggestions.");
  return { section: section!, field: f! };
}
function valueCheck(sectionKey: string, fieldKey: string, value: string) {
  const { field: f } = field(sectionKey, fieldKey);
  if (!value.trim() || value.length > 10000)
    bad("Enter a value after checking the source.");
  if (f.type === "date" && !z.iso.date().safeParse(value).success)
    bad("Choose the correct date in YYYY-MM-DD format.");
  if (f.type === "email" && !z.email().safeParse(value).success)
    bad("Check the email address.");
  if (f.type === "select" && !f.options?.includes(value))
    bad("Choose a supported form option.");
}
async function fact(a: Actor, fid: string, lock = false) {
  const f = await db()
    .prepare(
      "SELECT * FROM document_facts WHERE id=? AND tenant_id=?" +
        (lock ? " FOR UPDATE" : ""),
    )
    .get(fid, a.tenantId);
  if (!f) bad("Fact not found.", 404);
  const doc = await document(a, String(f!.document_id), lock);
  if (f!.source_stale || doc.current_version !== f!.document_version)
    bad("This source was replaced. Read and review the current version.", 409);
  return f!;
}
async function event(
  a: Actor,
  fid: string,
  kind: string,
  value = "",
  note = "",
) {
  await db()
    .prepare(
      "INSERT INTO document_fact_events(id,tenant_id,fact_id,actor_id,event,value,note) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id(), a.tenantId, fid, a.id, kind, value, note);
}
export async function queueReading(
  a: Actor,
  did: string,
  expectedVersion: number,
  retryRevision?: number,
) {
  if (!enabled())
    bad("Local document reading is not enabled on this server.", 503);
  await writable(a);
  return withTransaction(async () => {
    const doc = await document(a, did, true);
    if (doc.current_version !== expectedVersion)
      bad("The document changed. Refresh before reading it.", 409);
    const previous = await db()
      .prepare(
        "SELECT * FROM ocr_jobs WHERE tenant_id=? AND document_id=? AND document_version=? FOR UPDATE",
      )
      .get(a.tenantId, did, doc.current_version);
    if (previous) {
      if (previous.status !== "failed")
        return { id: previous.id, reused: true };
      if (retryRevision !== previous.revision)
        bad("Refresh the failed reading before retrying.", 409);
      await db()
        .prepare(
          "UPDATE ocr_jobs SET status='queued',error='',attempts=0,requested_by=?,revision=revision+1,updated_at=now() WHERE id=?",
        )
        .run(a.id, previous.id);
      await audit(
        a.tenantId,
        a.id,
        "retried",
        "document-reading",
        String(previous.id),
        "Queued a local reading retry",
      );
      return { id: previous.id, retried: true };
    }
    const pending = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM ocr_jobs WHERE tenant_id=? AND status IN ('queued','running')",
      )
      .get(a.tenantId);
    if (pending!.n >= 50)
      bad(
        "This workspace has 50 documents waiting. Let some finish first.",
        429,
      );
    const source = await db()
      .prepare(
        "SELECT sha256 FROM document_versions WHERE document_id=? AND tenant_id=? AND version=?",
      )
      .get(did, a.tenantId, doc.current_version);
    if (!source) bad("Source version not found.", 404);
    const jid = id();
    await db()
      .prepare(
        "INSERT INTO ocr_jobs(id,tenant_id,person_id,document_id,document_version,source_sha256,requested_by) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        jid,
        a.tenantId,
        doc.person_id,
        did,
        doc.current_version,
        source!.sha256,
        a.id,
      );
    await audit(
      a.tenantId,
      a.id,
      "queued",
      "document-reading",
      jid,
      "Queued local document text extraction",
    );
    return { id: jid };
  });
}
export async function readingRead(req: Request, parts: string[], a: Actor) {
  if (a.role === "platform_admin") bad("Not permitted.", 403);
  const u = new URL(req.url);
  if (parts[1] === "page") {
    const page = await db()
      .prepare(
        "SELECT p.*,j.document_id FROM ocr_pages p JOIN ocr_jobs j ON j.id=p.job_id AND j.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=?",
      )
      .get(u.searchParams.get("id") || "", a.tenantId);
    if (!page) bad("Page not found.", 404);
    await document(a, String(page!.document_id));
    const previewName = String(page!.preview_name);
    let bytes: Buffer;
    try {
      bytes = await getObject("ocr/" + previewName);
    } catch {
      bad("Page not found.", 404);
    }
    return new NextResponse(new Uint8Array(bytes!), {
      headers: {
        "Content-Type": previewName.endsWith(".jpg")
          ? "image/jpeg"
          : "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const did = u.searchParams.get("documentId") || "",
    pid = u.searchParams.get("personId") || "";
  if (did) await document(a, did);
  if (pid && !(await canSeePerson(a, pid))) bad("Applicant not found.", 404);
  const scopedPerson =
    pid || (a.role === "student" ? a.personId || "__none__" : "");
  const scope = (alias: string, documentColumn = "document_id") => ({
    sql:
      `${alias}.tenant_id=?` +
      (did ? ` AND ${alias}.${documentColumn}=?` : "") +
      (scopedPerson ? ` AND ${alias}.person_id=?` : ""),
    values: [
      a.tenantId,
      ...(did ? [did] : []),
      ...(scopedPerson ? [scopedPerson] : []),
    ],
  });
  const ds = scope("d", "id"),
    js = scope("j"),
    fs = scope("f");
  const allDocs = await db()
    .prepare(
      "SELECT d.id,d.person_id,d.section_key FROM documents d JOIN people p ON p.id=d.person_id AND p.tenant_id=d.tenant_id WHERE " +
        ds.sql,
    )
    .all(...ds.values);
  const allowed = new Set(
    allDocs
      .filter(
        (d) =>
          !sections.find((s) => s.key === d.section_key)?.restricted ||
          ["owner", "student"].includes(a.role),
      )
      .map((d) => String(d.id)),
  );
  const jobs = (
    await db()
      .prepare(
        "SELECT j.id,j.person_id,j.document_id,j.document_version,j.status,j.language,j.attempts,j.progress,j.page_count,j.error,j.engine,j.warnings,j.revision,j.created_at,j.updated_at FROM ocr_jobs j WHERE " +
          js.sql +
          " ORDER BY j.created_at DESC",
      )
      .all(...js.values)
  ).filter((j) => allowed.has(String(j.document_id)));
  const facts = (
    await db()
      .prepare(
        "SELECT f.*,d.title AS document_title,d.current_version FROM document_facts f JOIN documents d ON d.id=f.document_id AND d.tenant_id=f.tenant_id WHERE " +
          fs.sql +
          " ORDER BY f.created_at,f.page_number,f.field_key",
      )
      .all(...fs.values)
  ).filter((f) => allowed.has(String(f.document_id)));
  const pages = did
    ? await db()
        .prepare(
          "SELECT p.* FROM ocr_pages p JOIN ocr_jobs j ON j.id=p.job_id AND j.tenant_id=p.tenant_id WHERE p.tenant_id=? AND j.document_id=? ORDER BY j.created_at DESC,p.page_number",
        )
        .all(a.tenantId, did)
    : [];
  const factIds = new Set(facts.map((f) => f.id));
  const applications = (
    await db()
      .prepare(
        "SELECT a.* FROM fact_applications a JOIN document_facts f ON f.id=a.fact_id AND f.tenant_id=a.tenant_id WHERE " +
          fs.sql +
          " ORDER BY a.created_at DESC",
      )
      .all(...fs.values)
  ).filter((r) => factIds.has(r.fact_id));
  const events = did
    ? await db()
        .prepare(
          "SELECT e.*,u.name AS actor_name FROM document_fact_events e JOIN document_facts f ON f.id=e.fact_id AND f.tenant_id=e.tenant_id LEFT JOIN users u ON u.id=e.actor_id WHERE e.tenant_id=? AND f.document_id=? ORDER BY e.created_at DESC LIMIT 200",
        )
        .all(a.tenantId, did)
    : [];
  const intake = pid
    ? (
        await db()
          .prepare("SELECT * FROM intake WHERE tenant_id=? AND person_id=?")
          .all(a.tenantId, pid)
      )
        .filter(
          (r) =>
            !sections.find((s) => s.key === r.section_key)?.restricted ||
            ["owner", "student"].includes(a.role),
        )
        .map((r) => ({
          ...r,
          section_key: String(r.section_key),
          data: JSON.parse(String(r.data)),
        }))
    : [];
  const worker = await db()
    .prepare(
      "SELECT engine FROM ocr_worker_heartbeats WHERE seen_at>now()-interval '60 seconds' LIMIT 1",
    )
    .get();
  const linked = applications.map((link) => {
    const row = intake.find((r) => r.section_key === link.section_key),
      data = row?.data as Record<string, unknown> | undefined;
    const record = link.record_id
      ? ((data?.items || []) as Record<string, string>[]).find(
          (r) => r._id === link.record_id,
        )
      : data;
    return {
      ...link,
      currentMatches: record?.[String(link.field_key)] === link.applied_value,
      reviewMatches: facts.some(
        (f) =>
          f.id === link.fact_id &&
          f.chosen_value === link.applied_value &&
          f.applicant_review !== "rejected" &&
          f.staff_review !== "rejected",
      ),
    };
  });
  return NextResponse.json(
    {
      jobs,
      facts,
      pages: pages.map(({ preview_name, ...p }) => p),
      applications: linked,
      events,
      intake,
      enabled: enabled(),
      workerOnline: !!worker,
      engine: worker?.engine || "",
      canConfirm: a.role === "student" || a.workspaceType === "individual",
      canStaffReview: isStaff(a) && a.workspaceType !== "individual",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
const reviewInput = z.object({
  factId: z.string().max(100),
  revision: z.number().int().positive(),
  review: z.enum(["confirm", "reject", "staff-accept", "staff-reject"]),
  value: z.string().trim().max(10000),
});
// Copy source-linked values to drafts without treating extraction as human approval.
export async function autofillProfile(a: Actor, personId: string) {
  await writable(a);
  if (!(await canSeePerson(a, personId))) bad("Applicant not found.", 404);
  return withTransaction(async () => {
    await db()
      .prepare("SELECT id FROM people WHERE id=? AND tenant_id=? FOR UPDATE")
      .get(personId, a.tenantId);
    const rows = await db()
      .prepare(
        `SELECT f.*,d.section_key AS source_section FROM document_facts f
      JOIN documents d ON d.id=f.document_id AND d.tenant_id=f.tenant_id
      JOIN ocr_jobs j ON j.id=f.job_id AND j.tenant_id=f.tenant_id
      WHERE f.tenant_id=? AND f.person_id=? AND NOT f.source_stale
      AND d.current_version=f.document_version AND j.status='completed'
      AND f.applicant_review<>'rejected' AND f.staff_review<>'rejected'
      AND NOT EXISTS(SELECT 1 FROM fact_applications x WHERE x.fact_id=f.id AND x.tenant_id=f.tenant_id)
      ORDER BY f.created_at,f.id FOR UPDATE OF f FOR SHARE OF d`,
      )
      .all(a.tenantId, personId);
    const eligible = rows.filter((f) => {
      if (
        sections.find((s) => s.key === f.source_section)?.restricted &&
        !["owner", "student"].includes(a.role)
      )
        return false;
      try {
        valueCheck(
          String(f.section_key),
          String(f.field_key),
          String(f.chosen_value),
        );
        return true;
      } catch {
        return false;
      }
    });
    for (const section of sections) {
      const facts = eligible.filter((f) => f.section_key === section.key);
      if (!facts.length) continue;
      const current = await db()
        .prepare(
          "SELECT * FROM intake WHERE tenant_id=? AND person_id=? AND section_key=? FOR UPDATE",
        )
        .get(a.tenantId, personId, section.key);
      const data = current
        ? JSON.parse(String(current.data))
        : section.repeatable
          ? { items: [] }
          : {};
      if (section.repeatable && !Array.isArray(data.items)) continue;
      const groups = section.repeatable
        ? [
            ...new Set(
              facts.map(
                (f) => String(f.document_id) + "|" + String(f.group_key),
              ),
            ),
          ]
        : [""];
      const applied: { fact: (typeof facts)[number]; recordId: string }[] = [];
      for (const group of groups) {
        const candidates = facts.filter(
          (f) =>
            !section.repeatable ||
            String(f.document_id) + "|" + String(f.group_key) === group,
        );
        let record = data,
          recordId = "",
          fresh = false;
        if (section.repeatable) {
          const first = candidates[0];
          const prior = await db()
            .prepare(
              `SELECT x.record_id FROM fact_applications x JOIN document_facts f ON f.id=x.fact_id AND f.tenant_id=x.tenant_id
            WHERE x.tenant_id=? AND x.person_id=? AND x.section_key=? AND f.document_id=? AND f.group_key=? ORDER BY x.created_at DESC LIMIT 1`,
            )
            .get(
              a.tenantId,
              personId,
              section.key,
              first.document_id,
              first.group_key,
            );
          if (prior) {
            record = data.items.find(
              (r: Record<string, unknown>) => r._id === prior.record_id,
            );
            if (!record) continue; // A manually removed record stays removed.
          } else {
            const number = candidates.find(
              (f) => f.field_key === "number",
            )?.chosen_value;
            record = number
              ? data.items.find(
                  (r: Record<string, unknown>) => r.number === number,
                )
              : undefined;
            if (!record) {
              if (data.items.length >= 100) continue;
              record = { _id: id() };
              fresh = true;
            }
          }
          recordId = record._id;
        }
        const before = applied.length;
        for (const f of candidates) {
          const key = String(f.field_key),
            value = String(f.chosen_value);
          if (
            record[key] !== undefined &&
            record[key] !== null &&
            String(record[key]).trim() !== ""
          )
            continue;
          if (
            candidates.some(
              (other) =>
                other.field_key === key && other.chosen_value !== value,
            )
          )
            continue;
          record[key] = value;
          applied.push({ fact: f, recordId });
        }
        if (fresh && applied.length > before) data.items.push(record);
      }
      if (!applied.length || JSON.stringify(data).length > 100000) continue;
      const revision = Number(current?.revision || 0) + 1;
      if (current)
        await db()
          .prepare(
            "UPDATE intake SET data=?,state='draft',revision=revision+1,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=? AND person_id=? AND section_key=?",
          )
          .run(JSON.stringify(data), a.tenantId, personId, section.key);
      else
        await db()
          .prepare(
            "INSERT INTO intake(tenant_id,person_id,section_key,data,state,revision) VALUES(?,?,?,?,'draft',1)",
          )
          .run(a.tenantId, personId, section.key, JSON.stringify(data));
      for (const { fact: f, recordId } of applied) {
        await db()
          .prepare(
            "INSERT INTO fact_applications(id,tenant_id,person_id,fact_id,section_key,field_key,record_id,applied_value,intake_revision,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            a.tenantId,
            personId,
            f.id,
            section.key,
            f.field_key,
            recordId,
            f.chosen_value,
            revision,
            a.id,
          );
        await event(
          a,
          String(f.id),
          "autofilled",
          String(f.chosen_value),
          "Filled an empty draft field from a document. Human review remains unchanged.",
        );
      }
    }
    return (
      await db()
        .prepare("SELECT * FROM intake WHERE tenant_id=? AND person_id=?")
        .all(a.tenantId, personId)
    )
      .filter(
        (r) =>
          !sections.find((s) => s.key === r.section_key)?.restricted ||
          ["owner", "student"].includes(a.role),
      )
      .map((r) => ({ ...r, data: JSON.parse(String(r.data)) }));
  });
}
export async function readingWrite(a: Actor, body: unknown) {
  await writable(a);
  const base = z
    .object({ action: z.enum(["queue", "review", "apply", "map", "autofill"]) })
    .parse(body);
  if (base.action === "autofill") {
    const v = z.object({ personId: z.string().min(1).max(100) }).parse(body);
    return NextResponse.json({ intake: await autofillProfile(a, v.personId) });
  }
  if (base.action === "queue") {
    const v = z
      .object({
        documentId: z.string().min(1),
        version: z.number().int().positive(),
        retryRevision: z.number().int().positive().optional(),
      })
      .parse(body);
    return NextResponse.json(
      await queueReading(a, v.documentId, v.version, v.retryRevision),
    );
  }
  return withTransaction(async () => {
    if (base.action === "review") {
      const v = reviewInput.parse(body),
        f = await fact(a, v.factId, true);
      if (f.revision !== v.revision)
        bad("This fact changed. Refresh and review again.", 409);
      const applicant =
          a.role === "student" || a.workspaceType === "individual",
        staff = isStaff(a) && a.workspaceType !== "individual";
      if (
        (["confirm", "reject"].includes(v.review) && !applicant) ||
        (["staff-accept", "staff-reject"].includes(v.review) && !staff)
      )
        bad("Use the review action allowed for your account.", 403);
      const accepted = ["confirm", "staff-accept"].includes(v.review);
      if (accepted)
        valueCheck(String(f.section_key), String(f.field_key), v.value);
      const value = accepted ? v.value : String(f.chosen_value),
        changed = value !== f.chosen_value;
      await db()
        .prepare(
          `UPDATE document_facts SET chosen_value=?,
   applicant_review=?,staff_review=?,applicant_reviewer=?,staff_reviewer=?,
   applicant_reviewed_at=CASE WHEN ? THEN now() WHEN ? THEN NULL ELSE applicant_reviewed_at END,
   staff_reviewed_at=CASE WHEN ? THEN now() WHEN ? THEN NULL ELSE staff_reviewed_at END,revision=revision+1 WHERE id=? AND tenant_id=?`,
        )
        .run(
          value,
          applicant
            ? accepted
              ? "confirmed"
              : "rejected"
            : changed
              ? "pending"
              : f.applicant_review,
          staff
            ? accepted
              ? "accepted"
              : "rejected"
            : changed
              ? "pending"
              : f.staff_review,
          applicant ? a.id : changed ? null : f.applicant_reviewer,
          staff ? a.id : changed ? null : f.staff_reviewer,
          applicant,
          changed,
          staff,
          changed,
          f.id,
          a.tenantId,
        );
      await event(
        a,
        String(f.id),
        v.review,
        value,
        changed
          ? "Value corrected; the other review was reset."
          : "Source value reviewed.",
      );
      return NextResponse.json({ ok: true });
    }
    if (base.action === "map") {
      const v = z
          .object({
            pageId: z.string(),
            sectionKey: z.string(),
            fieldKey: z.string(),
            excerpt: z.string().trim().min(1).max(1000),
            value: z.string().trim().max(300),
          })
          .parse(body),
        target = field(v.sectionKey, v.fieldKey);
      const page = await db()
        .prepare(
          "SELECT p.*,j.document_id,j.document_version,j.person_id FROM ocr_pages p JOIN ocr_jobs j ON j.id=p.job_id AND j.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=?",
        )
        .get(v.pageId, a.tenantId);
      if (!page) bad("Page not found.", 404);
      const doc = await document(a, String(page!.document_id), true);
      if (doc.current_version !== page!.document_version)
        bad("Read the current source version first.", 409);
      if (!String(page!.text_content).includes(v.excerpt))
        bad("The source excerpt must appear on this page.");
      const count = await db()
        .prepare(
          "SELECT COUNT(*) AS n FROM document_facts WHERE job_id=? AND tenant_id=?",
        )
        .get(page!.job_id, a.tenantId);
      if (count!.n >= 500)
        bad("This document has reached its 500-suggestion limit.");
      const line = (
          page!.lines as {
            text: string;
            box: number[];
            confidence: number | null;
          }[]
        ).find((l) => l.text.includes(v.excerpt)),
        fid = id();
      await db()
        .prepare(
          `INSERT INTO document_facts(id,job_id,tenant_id,person_id,document_id,document_version,page_number,section_key,field_key,group_key,label,extracted_value,chosen_value,source_excerpt,source_box,confidence,method) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,'manual-map')`,
        )
        .run(
          fid,
          page!.job_id,
          a.tenantId,
          page!.person_id,
          page!.document_id,
          page!.document_version,
          page!.page_number,
          v.sectionKey,
          v.fieldKey,
          v.sectionKey + ":" + page!.page_number,
          target.field.label,
          v.value,
          v.value,
          v.excerpt,
          JSON.stringify(line?.box || null),
          line?.confidence || null,
        );
      await event(
        a,
        fid,
        "mapped",
        v.value,
        "A source excerpt was manually mapped; review is still pending.",
      );
      return NextResponse.json({ id: fid });
    }
    const v = z
      .object({
        factIds: z.array(z.string()).min(1).max(50),
        sectionKey: z.string(),
        recordId: z.string().max(100).default(""),
        newRecord: z.boolean().default(false),
        intakeRevision: z.number().int().nonnegative(),
        replaceExisting: z.boolean().default(false),
      })
      .parse(body);
    const selected: Record<string, any>[] = [];
    for (const fid of [...new Set(v.factIds)].sort())
      selected.push(await fact(a, fid, true));
    if (
      selected.some(
        (f) =>
          f.person_id !== selected[0].person_id ||
          f.section_key !== v.sectionKey,
      )
    )
      bad("Apply facts to one applicant and one section at a time.");
    if (new Set(selected.map((f) => f.field_key)).size !== selected.length)
      bad(
        "Choose only one value per field; conflicting candidates need a decision.",
      );
    const applicant = a.role === "student" || a.workspaceType === "individual";
    for (const f of selected) {
      if (f.applicant_review === "rejected" || f.staff_review === "rejected")
        bad("Rejected facts cannot be applied.", 409);
      if (
        applicant
          ? f.applicant_review !== "confirmed"
          : !isStaff(a) || f.staff_review !== "accepted"
      )
        bad("Review each selected fact before applying it.", 409);
      valueCheck(
        String(f.section_key),
        String(f.field_key),
        String(f.chosen_value),
      );
    }
    const pid = String(selected[0].person_id);
    await db()
      .prepare("SELECT id FROM people WHERE id=? AND tenant_id=? FOR UPDATE")
      .get(pid, a.tenantId);
    const current = await db()
      .prepare(
        "SELECT * FROM intake WHERE tenant_id=? AND person_id=? AND section_key=? FOR UPDATE",
      )
      .get(a.tenantId, pid, v.sectionKey);
    if ((current?.revision || 0) !== v.intakeRevision)
      bad("Saved answers changed. Refresh before applying suggestions.", 409);
    const section = sections.find((s) => s.key === v.sectionKey)!;
    let data = current
        ? JSON.parse(String(current.data))
        : section.repeatable
          ? { items: [] }
          : {},
      record: Record<string, string>,
      recordId = "";
    if (section.repeatable) {
      if (!v.newRecord && !v.recordId)
        bad("Choose an existing record or explicitly create a new one.");
      if (!Array.isArray(data.items))
        bad("Existing section needs manual review.");
      if (v.newRecord) {
        if (data.items.length >= 100)
          bad("This section has reached its record limit.");
        recordId = id();
        record = { _id: recordId };
        data.items.push(record);
      } else {
        record = data.items.find(
          (r: Record<string, string>) => r._id === v.recordId,
        );
        if (!record)
          bad("That repeated record changed. Refresh before applying.", 409);
        recordId = v.recordId;
      }
    } else record = data;
    for (const f of selected) {
      const prior = record[String(f.field_key)];
      if (prior && prior !== f.chosen_value && !v.replaceExisting)
        bad(
          "A saved answer differs. Review the conflict and explicitly allow replacement.",
          409,
        );
      record[String(f.field_key)] = String(f.chosen_value);
    }
    if (JSON.stringify(data).length > 100000) bad("This section is too large.");
    const revision = v.intakeRevision + 1;
    if (current)
      await db()
        .prepare(
          "UPDATE intake SET data=?,state='draft',revision=revision+1,updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=? AND person_id=? AND section_key=?",
        )
        .run(JSON.stringify(data), a.tenantId, pid, v.sectionKey);
    else
      await db()
        .prepare(
          "INSERT INTO intake(tenant_id,person_id,section_key,data,state,revision) VALUES(?,?,?,?,'draft',1)",
        )
        .run(a.tenantId, pid, v.sectionKey, JSON.stringify(data));
    for (const f of selected) {
      await db()
        .prepare(
          "INSERT INTO fact_applications(id,tenant_id,person_id,fact_id,section_key,field_key,record_id,applied_value,intake_revision,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          a.tenantId,
          pid,
          f.id,
          v.sectionKey,
          f.field_key,
          recordId,
          f.chosen_value,
          revision,
          a.id,
        );
      await event(
        a,
        String(f.id),
        "applied",
        String(f.chosen_value),
        "Applied to a draft profile section; no application was submitted.",
      );
    }
    await audit(
      a.tenantId,
      a.id,
      "applied",
      "document-facts",
      pid,
      "Applied reviewed document facts to a draft section",
    );
    return NextResponse.json({ ok: true, revision, recordId });
  });
}
