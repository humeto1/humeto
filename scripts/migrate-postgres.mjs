import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { database } from "../src/lib/postgres.mjs";
export async function migrate(d = database()) {
  return d.transaction(async () => {
    await d.query("SELECT pg_advisory_xact_lock(781340119)");
    await d.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    for (const file of readdirSync("migrations")
      .filter((x) => /^\d+.*\.sql$/.test(x))
      .sort()) {
      const sql = readFileSync("migrations/" + file, "utf8"),
        checksum = createHash("sha256").update(sql).digest("hex");
      const prior = (
        await d.query(
          "SELECT checksum FROM schema_migrations WHERE version=$1",
          [file],
        )
      ).rows[0];
      if (prior) {
        if (prior.checksum !== checksum)
          throw new Error("Applied migration checksum changed: " + file);
        continue;
      }
      await d.query(sql);
      await d.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [file, checksum],
      );
    }
  });
}
if (process.argv[1]?.endsWith("migrate-postgres.mjs")) {
  const d = database();
  try {
    await migrate(d);
    console.log("PostgreSQL migrations applied.");
  } finally {
    await d.close();
  }
}
