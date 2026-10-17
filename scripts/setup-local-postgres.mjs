// One-time local application role setup. Never prints credentials.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
const socket = resolve(".data/postgres-socket");
const client = new pg.Client({
  host: socket,
  port: 55432,
  user: "humeto_local",
  database: "postgres",
});
await client.connect();
try {
  const exists = (
    await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
      "humeto_app",
    ])
  ).rowCount;
  if (exists)
    throw new Error(
      "Local application role already exists; refusing to rotate its credentials.",
    );
  const password = randomBytes(32).toString("hex");
  const create = (
    await client.query(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) sql",
      ["humeto_app", password],
    )
  ).rows[0].sql;
  await client.query(create);
  await client.query("CREATE DATABASE humeto OWNER humeto_app");
  let env = existsSync(".env.local")
    ? readFileSync(".env.local", "utf8")
    : readFileSync(".env.example", "utf8");
  env = env
    .replace(/^DATABASE_URL=.*(?:\n|$)/gm, "")
    .replace(/^HUMETO_PG_ADMIN_URL=.*(?:\n|$)/gm, "");
  env +=
    "\n# Local PostgreSQL; credentials remain outside Git.\nDATABASE_URL=postgresql://humeto_app:" +
    password +
    "@127.0.0.1:55432/humeto\n";
  env +=
    "HUMETO_PG_ADMIN_URL=postgresql://humeto_local@localhost:55432/postgres?host=" +
    encodeURIComponent(socket) +
    "\n";
  writeFileSync(".env.local", env, { mode: 0o600 });
  chmodSync(".env.local", 0o600);
  console.log(
    "Created private local PostgreSQL app role/database and saved local configuration.",
  );
} finally {
  await client.end();
}
