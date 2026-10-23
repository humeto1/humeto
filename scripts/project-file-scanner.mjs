// Run on the trusted worker server with ClamAV installed and signatures updated.
// Unavailable/failed scans never release a quarantined attachment.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { database } from "../src/lib/postgres.mjs";
const d = database();
const directory = await mkdtemp(join(tmpdir(), "humeto-task-scan-"));
try {
  const files = await d
    .prepare(
      "SELECT id,bytes FROM project_attachments WHERE status='quarantined' ORDER BY created_at LIMIT 20",
    )
    .all();
  for (const file of files) {
    const path = join(directory, "attachment");
    await writeFile(path, file.bytes, { mode: 0o600 });
    const code = await new Promise((resolve) => {
      const child = spawn(
        process.env.HUMETO_CLAMSCAN_BIN || "clamscan",
        ["--no-summary", "--", path],
        { stdio: "ignore", timeout: 60000 },
      );
      child.once("error", () => resolve(-1));
      child.once("exit", (code) => resolve(code));
    });
    if (code !== 0 && code !== 1)
      throw Error(
        "Antivirus unavailable or scan failed; attachments remain quarantined.",
      );
    await d
      .prepare(
        "UPDATE project_attachments SET status=? WHERE id=? AND status='quarantined'",
      )
      .run(code === 0 ? "clean" : "rejected", file.id);
    console.log(`Attachment ${file.id}: ${code === 0 ? "clean" : "rejected"}`);
  }
  console.log("Attachment scan batch finished.");
} finally {
  await rm(directory, { recursive: true, force: true });
  await d.close();
}
