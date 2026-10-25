// Recover an empty completed reading from its saved OCR text without re-uploading.
// Dry run by default: node --env-file-if-exists=.env.local scripts/reparse-document-job.mjs <job-id> [--apply]
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
        "SELECT COUNT(*)::int AS n FROM document_facts WHERE job_id=$1",
        [job.id],
      )
    ).rows[0].n;
    if (existing)
      throw Error(
        "Reading already has facts; refusing to duplicate or replace reviewed details.",
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
      factCount: facts.length,
      fields: facts.map((f) => `${f.sectionKey}.${f.fieldKey}`),
    };
  });
  console.log(JSON.stringify(result));
} finally {
  await d.close();
}
