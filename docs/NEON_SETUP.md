# Neon database setup

Humeto uses Next.js route handlers with its existing cached `pg.Pool`, parameterized SQL, and pinned SERIALIZABLE transactions. PostgreSQL is hosted in the existing Neon project `noisy-rain-85100666`, production branch, AWS Ohio. App authentication remains unchanged.

## Configuration

- `DATABASE_URL`: pooled application connection, server only.
- `DATABASE_URL_UNPOOLED`: direct connection for migrations and backups.
- `HUMETO_DB_POOL_MAX`: optional connection limit (5 on Vercel, 10 locally).
- `HUMETO_TEST_DATABASE_URL`: local PostgreSQL database used as the basis for disposable regression databases. Its host and port must match `HUMETO_PG_ADMIN_URL`. Tests must never use production as a disposable database.
- `GITHUB_TOKEN`: private CLI credential in ignored `.env`. Never use a public environment variable or credential-bearing Git remote.

`.env`, `.env.local`, `.neon`, `.data` and private planning files stay ignored. Preserve environment files when pulling configuration. Neon TLS verifies the server certificate and hostname. PostgreSQL command-line tools use the system trust store. Vercel Node runtimes attach their cached pool through `@vercel/functions`.

## Installed tooling

Neon CLI initialization installed the Neon plugin and agent skills. The Codex plugin includes the Neon MCP endpoint `https://mcp.neon.tech/mcp`; no duplicate server was added. Existing configurations were preserved. MCP tools were not exposed in the current chat, so authenticated CLI calls were used for verification. Initialization also added Neon plugins to Claude clients and merged Gemini/Antigravity MCP configuration.

`neon.ts` declares PostgreSQL only. `neon deploy` confirmed the existing production policy and pulled database environment variables. No additional auth, file storage, AI, realtime or compute service was enabled.

## Operations

Run `npm run db:migrate` for versioned schema changes, `npm run db:backup` for a private database/file snapshot, `npm run build` and `npm run test:release` for release checks. Pause app writes and workers while capturing a migration snapshot. Rehearse on an isolated Neon branch, require an empty destination, restore with ownership/privilege transfer disabled, then reconcile all table contents before cutover.

Local uploads and OCR files remain local. Moving the database does not deploy the web app or its workers, or provide cloud document storage. These need separate deployment work before a Vercel production launch.
