// A separate durable local worker; no request-scoped background promises or network OCR.
import { processNotebookOne } from "./notebook-worker.mjs";
import { database } from "../src/lib/postgres.mjs";
import { engineInfo, readDocument } from "../src/lib/ocr/engine.mjs";
import { extractFacts } from "../src/lib/ocr/extract.mjs";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, rm } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
const d = database(),
  root = resolve(process.env.HUMETO_DATA_DIR || ".data"),
  workerId = randomUUID();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
export async function processOne(database = d) {
  const token = randomUUID();
  const job = await database.transaction(async () => {
    await database.query(
      "UPDATE ocr_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error='The previous reader stopped. Retry if needed.',lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE status='running' AND lease_until<now()",
    );
    return (
      await database.query(
        `WITH next AS (SELECT id FROM ocr_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ocr_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '2 minutes',error='',progress=0,revision=revision+1,updated_at=now() WHERE id IN (SELECT id FROM next) RETURNING *`,
        [token],
      )
    ).rows[0];
  });
  if (!job) return false;
  const attempt = job.id + "-" + token,
    dir = join(root, "ocr", attempt);
  let persisted = false;
  const pulse = async () => {
    if (stopping)
      throw Error(
        "The local reader stopped. Retry this document after restarting it.",
      );
    await database.query(
      "UPDATE ocr_worker_heartbeats SET seen_at=now() WHERE worker_id=$1",
      [workerId],
    );
    const r = await database.query(
      "UPDATE ocr_jobs SET lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
      [job.id, token],
    );
    if (!r.rowCount)
      throw Error("Source changed or this reading attempt was superseded.");
  };
  const heartbeat = setInterval(() => void pulse().catch(() => {}), 20000);
  try {
    const source = (
      await database.query(
        "SELECT v.*,d.current_version FROM document_versions v JOIN documents d ON d.id=v.document_id AND d.tenant_id=v.tenant_id WHERE v.document_id=$1 AND v.tenant_id=$2 AND v.version=$3",
        [job.document_id, job.tenant_id, job.document_version],
      )
    ).rows[0];
    if (!source || source.current_version !== job.document_version)
      throw Error("Source changed. Read the current file version instead.");
    const filename = String(source.stored_name);
    if (basename(filename) !== filename)
      throw Error("The stored source path is invalid.");
    const input = resolve(root, "uploads", filename),
      bytes = await readFile(input);
    if (bytes.length > 15 * 1024 * 1024)
      throw Error("The source exceeds the 15 MB reading limit.");
    if (createHash("sha256").update(bytes).digest("hex") !== job.source_sha256)
      throw Error(
        "Source integrity check failed. Replace this file with a fresh upload.",
      );
    await mkdir(join(root, "ocr"), { recursive: true, mode: 0o700 });
    const result = await readDocument(
      input,
      source.mime_type,
      dir,
      async (n, count) => {
        await pulse();
        await database.query(
          "UPDATE ocr_jobs SET progress=$1,page_count=$2 WHERE id=$3 AND lease_token=$4",
          [n, count, job.id, token],
        );
      },
    );
    const facts = extractFacts(result.pages),
      engine = await engineInfo();
    await database.transaction(async () => {
      const current = (
        await database.query(
          "SELECT current_version FROM documents WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
          [job.document_id, job.tenant_id],
        )
      ).rows[0];
      const active = (
        await database.query(
          "SELECT id FROM ocr_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
          [job.id, token],
        )
      ).rows[0];
      if (!active || current?.current_version !== job.document_version)
        throw Error("Source changed or this reading attempt was superseded.");
      await database.query("DELETE FROM ocr_pages WHERE job_id=$1", [job.id]);
      for (const page of result.pages)
        await database.query(
          "INSERT INTO ocr_pages(id,job_id,tenant_id,page_number,width,height,method,text_content,lines,preview_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)",
          [
            randomUUID(),
            job.id,
            job.tenant_id,
            page.pageNumber,
            page.width,
            page.height,
            page.method,
            page.text,
            JSON.stringify(page.lines),
            attempt + "/" + basename(page.preview),
          ],
        );
      for (const f of facts) {
        const fid = randomUUID();
        await database.query(
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
        await database.query(
          "INSERT INTO document_fact_events(id,tenant_id,fact_id,event,value,note) VALUES($1,$2,$3,'extracted',$4,'Unverified source-linked suggestion')",
          [randomUUID(), job.tenant_id, fid, f.value],
        );
      }
      const warnings = [...result.warnings];
      if (!facts.length)
        warnings.push(
          "Text was read, but no supported labelled fields were found. Select a source line to map a fact, or enter details manually.",
        );
      await database.query(
        "UPDATE ocr_jobs SET status='completed',engine=$1,warnings=$2::jsonb,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE id=$3 AND lease_token=$4",
        [engine, JSON.stringify(warnings), job.id, token],
      );
      persisted = true;
    });
  } catch (e) {
    await database.query(
      "UPDATE ocr_jobs SET status='failed',error=$1,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE id=$2 AND lease_token=$3 AND status='running'",
      [
        String(
          e.message || "The local reader could not process this file.",
        ).slice(0, 500),
        job.id,
        token,
      ],
    );
  } finally {
    clearInterval(heartbeat);
    if (!persisted) await rm(dir, { recursive: true, force: true });
  }
  return true;
}
if (process.argv[1]?.endsWith("ocr-worker.mjs")) {
  try {
    if (process.env.HUMETO_OCR_ENABLED !== "true")
      throw Error(
        "Set HUMETO_OCR_ENABLED=true to start the local document reader.",
      );
    const engine = await engineInfo();
    console.log("Local document reader ready: " + engine);
    let lastPulse = 0;
    while (!stopping) {
      if (Date.now() - lastPulse > 15000) {
        await d.query(
          "INSERT INTO ocr_worker_heartbeats(worker_id,engine) VALUES($1,$2) ON CONFLICT(worker_id) DO UPDATE SET seen_at=now(),engine=excluded.engine",
          [workerId, engine],
        );
        lastPulse = Date.now();
      }
      const handledDocument = await processOne();
      const handledNotebook = await processNotebookOne(d);
      const handled = handledDocument || handledNotebook;
      if (process.argv.includes("--once")) break;
      if (!handled) await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    console.error(String(e.message));
    process.exitCode = 1;
  } finally {
    await d
      .query("DELETE FROM ocr_worker_heartbeats WHERE worker_id=$1", [workerId])
      .catch(() => {});
    await d.close();
  }
}
