// Recover an empty completed reading from its saved OCR text without re-uploading.
// Dry run by default: node --env-file-if-exists=.env.local scripts/reparse-document-job.mjs <job-id> [--refresh-unreviewed] [--apply]
import { randomUUID } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
import { extractFacts } from "../src/lib/ocr/extract.mjs";
const jobId = process.argv[2];
if (!jobId || jobId.startsWith("--"))
  throw Error("Supply a completed reading job ID.");
const d = database();
try {
  const result = await d.transaction(async () => {
    const job = (
      await d.query(
        "SELECT j.* FROM ocr_jobs j JOIN documents doc ON doc.id=j.document_id AND doc.tenant_id=j.tenant_id WHERE j.id=$1 AND j.status='completed' AND doc.current_version=j.document_version FOR UPDATE OF j,doc",
        [jobId],
      )
    ).rows[0];
    if (!job)
      throw Error(
        "Reading must be completed and belong to the current source version.",
      );
    const existing = (
      await d.query(
        "SELECT * FROM document_facts WHERE job_id=$1 AND NOT source_stale FOR UPDATE",
        [job.id],
      )
    ).rows;
    if (existing.length && !process.argv.includes("--refresh-unreviewed"))
      throw Error(
        "Reading already has facts; use --refresh-unreviewed to repair an unreviewed extraction.",
      );
    if (
      existing.some(
        (f) =>
          f.applicant_review !== "pending" ||
          f.staff_review !== "pending" ||
          f.chosen_value !== f.extracted_value,
      )
    )
      throw Error(
        "Reading contains human-reviewed or corrected facts; preserve them and edit the main form manually.",
      );
    const pages = (
      await d.query(
        "SELECT * FROM ocr_pages WHERE job_id=$1 AND tenant_id=$2 ORDER BY page_number",
        [job.id, job.tenant_id],
      )
    ).rows;
    const facts = extractFacts(
      pages.map((p) => ({
        pageNumber: p.page_number,
        method: p.method,
        text: p.text_content,
        lines: p.lines,
      })),
    );
    if (!facts.length)
      throw Error(
        "Saved OCR text still contains no supported details. Re-read the source instead.",
      );
    if (process.argv.includes("--apply")) {
      for (const old of existing) {
        const links = (
          await d.query(
            "SELECT * FROM fact_applications WHERE fact_id=$1 ORDER BY created_at DESC",
            [old.id],
          )
        ).rows;
        for (const link of links) {
          const row = (
            await d.query(
              "SELECT * FROM intake WHERE tenant_id=$1 AND person_id=$2 AND section_key=$3 FOR UPDATE",
              [job.tenant_id, job.person_id, link.section_key],
            )
          ).rows[0];
          if (!row || row.state === "ready") continue;
          const data = JSON.parse(row.data),
            record = link.record_id
              ? data.items?.find((item) => item._id === link.record_id)
              : data;
          if (
            !record ||
            record[link.field_key] !== link.applied_value ||
            link.applied_value !== old.chosen_value
          )
            continue;
          delete record[link.field_key];
          await d.query(
            "UPDATE intake SET data=$1,revision=revision+1,state='draft',updated_at=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE tenant_id=$2 AND person_id=$3 AND section_key=$4",
            [
              JSON.stringify(data),
              job.tenant_id,
              job.person_id,
              link.section_key,
            ],
          );
        }
        await d.query(
          "UPDATE document_facts SET source_stale=true,revision=revision+1 WHERE id=$1",
          [old.id],
        );
        await d.query(
          "INSERT INTO document_fact_events(id,tenant_id,fact_id,event,value,note) VALUES($1,$2,$3,'extraction_superseded',$4,$5)",
          [
            randomUUID(),
            job.tenant_id,
            old.id,
            old.chosen_value,
            "Replaced an unreviewed extraction with corrected parsing of the same source. Manual profile edits preserved.",
          ],
        );
      }
      for (const f of facts) {
        const fid = randomUUID();
        await d.query(
          `INSERT INTO document_facts(id,job_id,tenant_id,person_id,document_id,document_version,page_number,section_key,field_key,group_key,label,extracted_value,chosen_value,source_excerpt,source_box,confidence,method,warnings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14::jsonb,$15,$16,$17::jsonb)`,
          [
            fid,
            job.id,
            job.tenant_id,
            job.person_id,
            job.document_id,
            job.document_version,
            f.pageNumber,
            f.sectionKey,
            f.fieldKey,
            f.groupKey,
            f.label,
            f.value,
            f.sourceExcerpt,
            JSON.stringify(f.box),
            f.confidence,
            f.method,
            JSON.stringify(f.warnings),
          ],
        );
        await d.query(
          "INSERT INTO document_fact_events(id,tenant_id,fact_id,event,value,note) VALUES($1,$2,$3,'extracted',$4,$5)",
          [
            randomUUID(),
            job.tenant_id,
            fid,
            f.value,
            "Recovered from saved OCR text using the corrected parser. Pending review; profile answers unchanged.",
          ],
        );
      }
      const warnings = (job.warnings || []).filter(
        (w) =>
          !w.startsWith(
            "Text was read, but no supported labelled fields were found.",
          ),
      );
      await d.query(
        "UPDATE ocr_jobs SET warnings=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=$2",
        [JSON.stringify(warnings), job.id],
      );
    }
    return {
      jobId: job.id,
      applied: process.argv.includes("--apply"),
      supersededFacts: existing.length,
      factCount: facts.length,
      fields: facts.map((f) => `${f.sectionKey}.${f.fieldKey}`),
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await d.close();
}
