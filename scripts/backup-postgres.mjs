// Consistent database dump; pause app writes while copying the upload directory.
import { migrationUrl } from "../src/lib/database-settings.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  cpSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
export function pgBin(program) {
  for (const dir of [
    process.env.HUMETO_PG_BIN,
    "/opt/homebrew/opt/postgresql@18/bin",
    "/usr/local/opt/postgresql@18/bin",
  ].filter(Boolean))
    if (existsSync(dir + "/" + program)) return dir + "/" + program;
  return program;
}
export function pgEnv(url) {
  const v = new URL(url);
  return {
    ...process.env,
    PGHOST: v.searchParams.get("host") || v.hostname,
    PGPORT: v.port || "5432",
    PGUSER: decodeURIComponent(v.username),
    PGPASSWORD: decodeURIComponent(v.password),
    PGDATABASE: decodeURIComponent(v.pathname.slice(1)),
    ...(v.searchParams.has("sslmode")
      ? { PGSSLMODE: v.searchParams.get("sslmode") }
      : {}),
    ...(v.hostname.endsWith(".neon.tech")
      ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: "system" }
      : {}),
  };
}
export function command(program, args, url) {
  const result = spawnSync(pgBin(program), args, {
    env: pgEnv(url),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(program + " failed.");
}
export function backupPostgres() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const folder = resolve(
    ".data/postgres-backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const dump = resolve(folder, "humeto.dump");
  command(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--file", dump],
    migrationUrl(),
  );
  chmodSync(dump, 0o600);
  for (const name of ["uploads", "ocr"]) {
    const source = resolve(process.env.HUMETO_DATA_DIR || ".data", name),
      target = resolve(folder, name);
    if (existsSync(source)) cpSync(source, target, { recursive: true });
    else mkdirSync(target, { mode: 0o700 });
  }
  writeFileSync(
    resolve(folder, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        format: "pg_dump custom",
        uploads: "uploads",
        ocr: "ocr",
        note: "Pause application writes and the OCR worker during database/file capture.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return { folder, dump };
}
if (process.argv[1]?.endsWith("backup-postgres.mjs"))
  console.log(backupPostgres().folder);
