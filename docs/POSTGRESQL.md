# PostgreSQL operation and migration

Updated 18 October 2026. Humeto now uses PostgreSQL for runtime data. SQLite is retained only as a read-only migration source/rollback snapshot; the app does not fall back to it.

## Current local installation

- PostgreSQL 18.6 on loopback `127.0.0.1:55432`.
- Dedicated cluster: `.data/postgres/`; private Unix socket: `.data/postgres-socket/`.
- Application database/role: `humeto` / `humeto_app`. Runtime uses the non-superuser application role through `DATABASE_URL` in ignored `.env.local`.
- The local administrative role is used only by setup and disposable QA through `HUMETO_PG_ADMIN_URL`. It is not the runtime connection.
- No paid hosting or external database service was provisioned. These tools are local development helpers; public deployment configuration is separate.

The cluster's socket directory is private to the OS user, host connections use SCRAM authentication, and the server listens only on loopback. This does not replace an independent production security review.

## Start and stop

On the configured machine:

```sh
npm run db:start
npm run db:migrate
npm run dev
```

For the compiled preview, use `npm run build` then `npm start` instead of the development command. App restarts do not reseed or reset data. The PostgreSQL process is separate and stays running until stopped or the computer restarts. After a computer restart, start it again before the app.

```sh
npm run db:status
npm run db:stop
```

Stop the app before stopping its database. The local helper locates Homebrew PostgreSQL 18 binaries, or uses `HUMETO_PG_BIN` if set. It initializes a new app-specific cluster only if no cluster exists at the configured local path.

On a fresh checkout, install dependencies and PostgreSQL, copy `.env.example` to `.env.local`, then run `db:start`, `db:setup-local`, `db:migrate` and (only for fictional local demos) `db:seed`. Set `HUMETO_LOCAL_DEMO=true` to enable fictional seeding/demo entry. Setup generates a strong app-role password and stores it locally; it refuses to rotate an existing role's credentials. Set the resulting environment file permissions appropriately. Other PostgreSQL deployments can supply `DATABASE_URL` and run migrations without the Homebrew helpers.

## Connection and transaction model

`src/lib/postgres.mjs` caches `pg` connection pools across server module reloads. Default maximum is 10 connections per application process. Queries are asynchronous and parameterized. The repository keeps its `prepare(...).get/all/run` call shape while executing native PostgreSQL SQL.

Transactions check out one client and keep it in AsyncLocalStorage, so nested domain calls use the same connection. They use SERIALIZABLE isolation and bounded retries for serialization/deadlock errors. Queries scheduled concurrently inside one transaction are queued on that client and drained before commit/rollback. Transaction callbacks must keep side effects in the database; network sends or non-idempotent file changes do not belong inside a retried callback. Rollback releases the checked-out connection.

Optimistic revisions and idempotency keys remain business-level protections. Receipt retries use an atomic conflict-safe insert. Fee revision checks and staff-seat counts are inside their transaction. Public inquiry throttling uses an atomic upsert. PostgreSQL does not automatically provide application tenant authorization; existing server-side scope checks remain necessary.

## Versioned migrations

- `migrations/001-baseline.sql`: 41 application tables, indexes/constraints, BIGINT counters and retained text JSON/timestamp contracts.
- `migrations/002-task-events.sql`: native PL/pgSQL completion/reopening timestamps, task event snapshots and reminder completion.
- `schema_migrations`: versions, checksums and application times. Do not edit an applied migration; add the next migration.

Migrations run explicitly, in a transaction with a migration advisory lock. They do not run on each request. `_rowid` identities preserve historical event tie ordering imported from SQLite. Legacy text timestamps/serialized JSON are deliberately preserved to keep API/reporting behavior and source fidelity; a later typed-column migration requires its own compatibility work.

## Verified data cutover

The final consistent SQLite backup was imported into an empty PostgreSQL target. Full row hashes/counts reconciled across **41 tables / 907 rows**, with **five original uploaded files** verified by size and SHA-256. Task triggers were disabled only during the import, with deferred foreign keys checked before commit, preserving historical events and avoiding fabricated completion timestamps. Identity sequences were advanced after import.

Import command:

```sh
npm run db:import-sqlite -- --source /absolute/path/to/backup/humeto.sqlite
```

This command refuses a nonempty application target; it never clears existing records or silently merges data. The original SQLite file and frozen database/upload snapshots remain in ignored `.data/migration-backups/`. They are historical snapshots, not the current live database.

A PostgreSQL logical dump plus upload copy was also restored into a disposable database. All **42 tables**, including the migration ledger, reconciled by complete row hashes. Reconciliation reports and the restore verification are stored alongside ignored migration reports/backups.

## Backups and rollback

Pause application writes while taking the database/upload backup:

```sh
npm run db:backup
```

This uses `pg_dump` custom format plus an upload-directory copy in `.data/postgres-backups/`. Credentials are supplied through environment variables, not command-line arguments. Protect and privately back up this folder; Git-ignore is not a backup. Do not copy a running PostgreSQL cluster directory as if it were a consistent logical backup.

Restore into an **empty, isolated** target first using `pg_restore --dbname TARGET_DATABASE --no-owner --no-privileges --exit-on-error`, supplying its credentials securely. Reconcile records, file hashes, migration versions, identities and event history before considering a real restore. Avoid printing connection strings/passwords in logs or shell history.

Rollback to pre-migration SQLite also requires the pre-migration app source. Once PostgreSQL accepts new writes, simply starting an old SQLite snapshot loses those changes. Freeze writes, export/reconcile intervening records and choose a tested recovery direction before rollback. No automatic destructive rollback is implemented.

## Verification

The compiled application passed **61 checks** against a disposable PostgreSQL database, including the prior 55 workflows and new actual-engine/parameter, transaction rollback/connection, simultaneous task edit, duplicate receipt, fee revision and staff-seat tests. Fixtures use a separate upload directory. Successful runs remove the QA database; failed runs retain its name/log path for diagnosis. The admin URL is needed only to create/drop these disposable databases.

```sh
npm run build
npm run test:release
```

Production capacity/load targets, deployment-grade backup retention, monitoring, role separation, storage scanning/encryption and full operational hardening remain separate work. The migration does not enable Gmail, WhatsApp, OCR or mobile clients.
