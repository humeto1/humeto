import pg from "pg";
import { qaBaseUrl } from "../../src/lib/database-settings.mjs";
import { randomUUID } from "node:crypto";
import { database } from "../../src/lib/postgres.mjs";
import { migrate } from "../migrate-postgres.mjs";
export async function createTestDatabase({ migrateSchema = true } = {}) {
  const baseUrl = qaBaseUrl();
  const name = "humeto_qa_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({
    connectionString: process.env.HUMETO_PG_ADMIN_URL,
  });
  await admin.connect();
  const owner = decodeURIComponent(new URL(baseUrl).username);
  const quoted = (s) => '"' + s.replaceAll('"', '""') + '"';
  await admin.query(
    "CREATE DATABASE " + quoted(name) + " OWNER " + quoted(owner),
  );
  const target = new URL(baseUrl);
  target.pathname = "/" + name;
  const d = database(target.toString());
  if (migrateSchema) await migrate(d);
  await d.close();
  return {
    url: target.toString(),
    name,
    async cleanup() {
      if (!/^humeto_qa_[a-f0-9]{32}$/.test(name))
        throw new Error("Refusing to drop a non-QA database.");
      await database(target.toString()).close();
      await admin.query("DROP DATABASE " + quoted(name) + " WITH (FORCE)");
      await admin.end();
    },
    async disconnect() {
      await admin.end();
    },
  };
}
