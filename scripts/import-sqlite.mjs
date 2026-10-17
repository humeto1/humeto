// Explicit, empty-target-only import. SQLite remains untouched and readable for rollback.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { database } from "../src/lib/postgres.mjs";
import { migrate } from "./migrate-postgres.mjs";
const sourcePath = process.argv[process.argv.indexOf("--source") + 1];
if (!process.argv.includes("--source") || !sourcePath)
  throw new Error("Pass --source /path/to/consistent-sqlite-backup.");
const s = new DatabaseSync(resolve(sourcePath), { readOnly: true });
const d = database();
const q = (x) => '"' + x.replaceAll('"', '""') + '"';
const digest = (rows) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  if (s.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error(
      "Source has foreign-key violations; stop and reconcile before importing.",
    );
  await migrate(d);
  const tables = s
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((x) => x.name);
  const report = { completedAt: null, tables: {}, files: 0, verified: false };
  await d.transaction(async () => {
    for (const t of tables)
      if ((await d.query(`SELECT count(*) n FROM ${q(t)}`)).rows[0].n !== 0)
        throw new Error("Refusing to import into a nonempty target: " + t);
    await d.query("SET CONSTRAINTS ALL DEFERRED");
    await d.query("ALTER TABLE tasks DISABLE TRIGGER USER");
    for (const t of tables) {
      const columns = [
        "_rowid",
        ...s
          .prepare(`PRAGMA table_info(${q(t)})`)
          .all()
          .map((x) => x.name),
      ];
      const rows = s
        .prepare(`SELECT rowid AS _rowid,* FROM ${q(t)} ORDER BY rowid`)
        .all();
      for (const row of rows)
        await d.query(
          `INSERT INTO ${q(t)} (${columns.map(q).join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
          columns.map((k) => row[k]),
        );
      const actual = (
        await d.query(
          `SELECT ${columns.map(q).join(",")} FROM ${q(t)} ORDER BY _rowid`,
        )
      ).rows;
      const expectedHash = digest(rows.map((r) => columns.map((k) => r[k]))),
        actualHash = digest(actual.map((r) => columns.map((k) => r[k])));
      if (expectedHash !== actualHash)
        throw new Error("Full row reconciliation failed for " + t);
      report.tables[t] = { rows: rows.length, sha256: actualHash };
      const max = rows.at(-1)?._rowid || 0;
      await d.query(
        "SELECT setval(pg_get_serial_sequence($1,'_rowid'),$2,$3)",
        [t, Math.max(1, max), max > 0],
      );
    }
    await d.query("SET CONSTRAINTS ALL IMMEDIATE");
    await d.query("ALTER TABLE tasks ENABLE TRIGGER USER");
    for (const v of s
      .prepare("SELECT stored_name,sha256,byte_size FROM document_versions")
      .all()) {
      const bytes = readFileSync(
        resolve(
          process.env.HUMETO_DATA_DIR || ".data",
          "uploads",
          v.stored_name,
        ),
      );
      if (
        bytes.length !== v.byte_size ||
        createHash("sha256").update(bytes).digest("hex") !== v.sha256
      )
        throw new Error(
          "An original upload failed file integrity verification.",
        );
      report.files++;
    }
  });
  report.completedAt = new Date().toISOString();
  report.verified = true;
  mkdirSync(".data/migration-reports", { recursive: true, mode: 0o700 });
  const filename = ".data/migration-reports/" + Date.now() + ".json";
  writeFileSync(filename, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      verified: true,
      tables: tables.length,
      rows: Object.values(report.tables).reduce((n, t) => n + t.rows, 0),
      files: report.files,
      report: filename,
    }),
  );
} finally {
  s.close();
  await d.close();
}
