// Pause app/worker writes before capture. Restore only into a fresh guarded QA database.
import { database } from "../src/lib/postgres.mjs";
import { createTestDatabase } from "./lib/test-database.mjs";
import { backupPostgres, command } from "./backup-postgres.mjs";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
const capture = backupPostgres(),
  fixture = await createTestDatabase({ migrateSchema: false }),
  source = database(),
  target = database(fixture.url);
const digest = (value) => createHash("sha256").update(value).digest("hex");
function files(root) {
  const output = {};
  if (!existsSync(root)) return output;
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.isFile())
        output[relative(root, path)] = digest(readFileSync(path));
    }
  }
  walk(root);
  return output;
}
try {
  command(
    "pg_restore",
    [
      "--dbname",
      fixture.name,
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      capture.dump,
    ],
    fixture.url,
  );
  const tables = (
      await source.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename),
    report = {
      completedAt: new Date().toISOString(),
      verified: false,
      tables: {},
      files: {},
    };
  for (const table of tables) {
    const name = '"' + table.replaceAll('"', '""') + '"',
      sql = `SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`;
    const a = (await source.query(sql)).rows,
      b = (await target.query(sql)).rows;
    if (digest(JSON.stringify(a)) !== digest(JSON.stringify(b)))
      throw Error("Restore mismatch in " + table);
    report.tables[table] = {
      rows: a.length,
      sha256: digest(JSON.stringify(a)),
    };
  }
  for (const name of ["uploads", "ocr"]) {
    const original = files(
        resolve(process.env.HUMETO_DATA_DIR || ".data", name),
      ),
      copied = files(resolve(capture.folder, name));
    if (
      JSON.stringify(Object.entries(original).sort()) !==
      JSON.stringify(Object.entries(copied).sort())
    )
      throw Error("File backup mismatch in " + name);
    report.files[name] = {
      count: Object.keys(copied).length,
      sha256: digest(JSON.stringify(Object.entries(copied).sort())),
    };
  }
  report.verified = true;
  writeFileSync(
    resolve(capture.folder, "restore-verification.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      restoreVerified: true,
      tables: tables.length,
      files: report.files,
      backupDirectory: capture.folder,
    }),
  );
} finally {
  await source.close();
  await target.close();
  await fixture.cleanup();
}
