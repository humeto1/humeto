import { database } from "../src/lib/postgres.mjs";
import { readDocument } from "../src/lib/ocr/engine.mjs";
import { notebookLines } from "../src/lib/ocr/notebook.mjs";
import { randomUUID, createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
export async function processNotebookOne(d = database()) {
  const token = randomUUID(),
    root = resolve(process.env.HUMETO_DATA_DIR || ".data");
  const job = await d.transaction(async () => {
    await d.query(
      "UPDATE task_notebooks SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error='The reader stopped. Retry if needed.',lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE status='running' AND lease_until<now()",
    );
    return (
      await d.query(
        "WITH next AS (SELECT id FROM task_notebooks WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE task_notebooks SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '2 minutes',error='',revision=revision+1,updated_at=now() WHERE id IN (SELECT id FROM next) RETURNING *",
        [token],
      )
    ).rows[0];
  });
  if (!job) return false;
  const dir = join(root, "ocr", "notebook-" + job.id + "-" + token);
  let saved = false;
  const pulse = async () => {
    const r = await d.query(
      "UPDATE task_notebooks SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
      [job.id, token],
    );
    if (!r.rowCount) throw Error("This reading attempt was superseded.");
  };
  const timer = setInterval(() => void pulse().catch(() => {}), 20000);
  try {
    if (basename(job.stored_name) !== job.stored_name)
      throw Error("Invalid source path.");
    const input = join(root, "uploads", job.stored_name),
      bytes = await readFile(input);
    if (
      bytes.length > 10 * 1024 * 1024 ||
      createHash("sha256").update(bytes).digest("hex") !== job.source_sha256
    )
      throw Error("Source integrity check failed.");
    const result = await readDocument(input, job.mime_type, dir, pulse),
      page = result.pages[0],
      lines = notebookLines(page);
    await d.transaction(async () => {
      const current = (
        await d.query(
          "SELECT id FROM task_notebooks WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
          [job.id, token],
        )
      ).rows[0];
      if (!current) throw Error("This reading attempt was superseded.");
      await d.query("DELETE FROM task_notebook_lines WHERE notebook_id=$1", [
        job.id,
      ]);
      await d.query("DELETE FROM task_notebook_pages WHERE notebook_id=$1", [
        job.id,
      ]);
      await d.query(
        "INSERT INTO task_notebook_pages(notebook_id,width,height,preview_name,method) VALUES($1,$2,$3,$4,$5)",
        [
          job.id,
          page.width,
          page.height,
          dir.split("/").pop() + "/" + basename(page.preview),
          page.method,
        ],
      );
      for (const line of lines)
        await d.query(
          "INSERT INTO task_notebook_lines(id,notebook_id,line_index,source_text,box,confidence,completion_hint) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)",
          [
            randomUUID(),
            job.id,
            line.index,
            line.text,
            JSON.stringify(line.box),
            line.confidence,
            line.completionHint,
          ],
        );
      const warnings = [
        ...result.warnings,
        "Printed English text works best. Handwriting and crossed-out marks may be missed. Review the source before changing tasks.",
      ];
      if (page.lines.length > 500)
        warnings.push("Only the first 500 source lines were included.");
      await d.query(
        "UPDATE task_notebooks SET status='completed',warnings=$1::jsonb,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE id=$2 AND lease_token=$3",
        [JSON.stringify(warnings), job.id, token],
      );
      saved = true;
    });
  } catch (e) {
    await d.query(
      "UPDATE task_notebooks SET status='failed',error=$1,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=now() WHERE id=$2 AND lease_token=$3",
      [String(e.message || "Reading failed.").slice(0, 500), job.id, token],
    );
  } finally {
    clearInterval(timer);
    if (!saved) await rm(dir, { recursive: true, force: true });
  }
  return true;
}
