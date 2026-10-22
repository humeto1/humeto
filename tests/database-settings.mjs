import test from "node:test";
import assert from "node:assert/strict";
import {
  migrationUrl,
  poolSettings,
  qaBaseUrl,
} from "../src/lib/database-settings.mjs";
test("Neon uses verified TLS while migration connections prefer the direct endpoint", () => {
  assert.equal(
    migrationUrl({ DATABASE_URL: "pooled", DATABASE_URL_UNPOOLED: "direct" }),
    "direct",
  );
  assert.equal(
    new URL(
      poolSettings("postgres://u:p@example.neon.tech/db?sslmode=require")
        .connectionString,
    ).searchParams.get("sslmode"),
    "verify-full",
  );
  assert.equal(poolSettings("postgres://localhost/db").max, 10);
  assert.equal(poolSettings("postgres://localhost/db", { VERCEL: "1" }).max, 5);
  assert.throws(() =>
    poolSettings("postgres://localhost/db", { HUMETO_DB_POOL_MAX: "100" }),
  );
});
test("Cloud runtime credentials cannot silently become a destructive QA target", () => {
  assert.throws(
    () =>
      qaBaseUrl({
        DATABASE_URL: "postgres://cloud.neon.tech/db",
        HUMETO_PG_ADMIN_URL: "postgres://localhost/postgres",
      }),
    /same server/,
  );
  const local = "postgres://localhost:55432/humeto";
  assert.equal(
    qaBaseUrl({
      DATABASE_URL: "postgres://cloud.neon.tech/db",
      HUMETO_TEST_DATABASE_URL: local,
      HUMETO_PG_ADMIN_URL: "postgres://localhost:55432/postgres",
    }),
    local,
  );
});
