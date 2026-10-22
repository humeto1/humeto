// Pure configuration shared by runtime, operational tools and isolated QA.
export function migrationUrl(env = process.env) {
  const value = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!value) throw Error("DATABASE_URL is required.");
  return value;
}
export function poolSettings(url, env = process.env) {
  const parsed = new URL(url);
  const neon = parsed.hostname.endsWith(".neon.tech");
  // Verify Neon's public TLS certificate and hostname; leave local settings intact.
  if (neon) parsed.searchParams.set("sslmode", "verify-full");
  const max = Number(env.HUMETO_DB_POOL_MAX || (env.VERCEL ? 5 : 10));
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw Error("HUMETO_DB_POOL_MAX must be between 1 and 20.");
  return {
    connectionString: parsed.toString(),
    max,
    connectionTimeoutMillis: neon ? 15000 : 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: "humeto",
  };
}
export function qaBaseUrl(env = process.env) {
  const value = env.HUMETO_TEST_DATABASE_URL || env.DATABASE_URL;
  if (!value || !env.HUMETO_PG_ADMIN_URL)
    throw Error(
      "HUMETO_TEST_DATABASE_URL (or DATABASE_URL) and HUMETO_PG_ADMIN_URL are required for isolated QA.",
    );
  const base = new URL(value),
    admin = new URL(env.HUMETO_PG_ADMIN_URL);
  if (
    base.hostname !== admin.hostname ||
    (base.port || "5432") !== (admin.port || "5432")
  )
    throw Error(
      "QA database and admin must use the same server. Set HUMETO_TEST_DATABASE_URL to the local test database; cloud runtime credentials are not a QA fallback.",
    );
  return value;
}
