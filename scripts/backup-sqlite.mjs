import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync, cpSync, writeFileSync } from "node:fs";
const source = new DatabaseSync(resolve(".data/humeto.sqlite"), {
  readOnly: true,
});
const directory = resolve(
  ".data/migration-backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
mkdirSync(directory, { recursive: true, mode: 0o700 });
try {
  await backup(source, resolve(directory, "humeto.sqlite"));
  cpSync(".data/uploads", resolve(directory, "uploads"), { recursive: true });
  const check = source.prepare("PRAGMA quick_check").all();
  const foreignKeys = source.prepare("PRAGMA foreign_key_check").all();
  if (check.some((r) => Object.values(r)[0] !== "ok") || foreignKeys.length)
    throw new Error("SQLite backup source failed integrity checks.");
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        integrity: "ok",
        foreignKeyViolations: 0,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(directory);
} finally {
  source.close();
}
