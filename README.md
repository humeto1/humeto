# Humeto

A local Next.js application combining an education/immigration CRM, Tasks to-do and a reviewed form-filling extension. The homepage and populated demos use fictional data. This is a working local pilot, not the completed production product.

## Documentation

- [App guide](docs/APP_GUIDE.md): login, roles, screens, workflows and current limits.
- [Tech stack](docs/TECH_STACK.md): installed technologies, architecture, commands and planned changes.
- [PostgreSQL operation](docs/POSTGRESQL.md): database setup, migration, backup/restore and verification.
- Local product plan: [planning/APP_PLAN.md](planning/APP_PLAN.md).
- Local pending checklist: [planning/PENDING_FEATURES.md](planning/PENDING_FEATURES.md).
- Local requirement audit and delivery history: `planning/REQUIREMENTS_COVERAGE_AUDIT.md` and `planning/BUILD_DELIVERABLES.md`.

The entire `/planning/` folder is excluded through `.gitignore` at the user's request. It contains the private roadmap and reference material and will not be included in a normal clone. Tracked operational documentation lives in `docs/`. The old parent `planning/README.md` points here; use this app's planning folder for future edits.

## Run locally

Requires Node.js 22.13+; the current development machine uses Node 25.9.0. Install locked dependencies with `npm ci`.

| Command                          | Purpose                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run db:start`               | Start the private local PostgreSQL server                                            |
| `npm run db:migrate`             | Apply versioned database migrations                                                  |
| `npm run db:backup`              | Back up PostgreSQL and uploaded files                                                |
| `npm run dev`                    | Webpack development preview at http://localhost:4174                                 |
| `npm run build` then `npm start` | Compiled release at http://localhost:4173                                            |
| `npm run typecheck`              | TypeScript checks                                                                    |
| `npm run test:release`           | Test the compiled build in a disposable database/server; build first                 |
| `npm test`                       | Test against an existing development server; may write test fixtures to its database |
| `npm run package:extension`      | Repackage the local Chrome extension                                                 |
| `npm run seed:assets`            | Create labelled fictional document images after initializing the demo database       |

PostgreSQL must be running and `DATABASE_URL` configured before authenticated app use. On this machine local credentials are already saved in ignored `.env.local`. See the PostgreSQL guide for a fresh checkout.

Install the matching test browser with `npx playwright install chromium` if needed. Both servers bind to loopback `127.0.0.1`. They do not publish the app to the internet.

## Login

Open [the login page](http://localhost:4173/login). The configured local preview offers Institute, Student, Super admin and Individual demo buttons; **no demo password is required**. Local demo entry is restricted to loopback hosts. New individual accounts and platform-created institute owners use their own credentials. Password hashes, not plaintext passwords, are stored. Recovery/MFA/invitation workflows remain production work.

Use `.env.example` for supported configuration names. Current development enables local demos in the ignored `.env.local`. Do not enable demo entry on public hosting. Keep provider credentials server-side and outside Git; never use a `NEXT_PUBLIC_` variable for a model key.

## Current stack

Next.js 16.4.2 App Router, React 19.3.1 and TypeScript 5.9.3; Node.js API routes; PostgreSQL 18.6 through pooled asynchronous `pg` queries; private local file storage; custom CSS/Lucide icons; Zod validation; QRCode; Chrome Manifest V3 extension; Node tests and Playwright. Current AI behavior is **local command testing**. A server-side OpenAI task-intent adapter exists but is inactive and not live-tested. See [full stack details](docs/TECH_STACK.md).

## Working local features

- Three-cover homepage with illustrative CRM/task/extension examples.
- Institute/individual/platform workspaces, tenant/role checks, sessions and manual subscription/seat/case/storage limits.
- 32 intake sections / 260 field definitions, separate admission/visa journeys, repeatable histories, small question groups, autosave, skip/resume and fact search.
- Private PDF/PNG/JPEG uploads, selected-folder import, provenance, duplicates, original downloads and preserved versions.
- Lead manual/custom-field/CSV/inquiry-QR intake, follow-up queues and registration into applicants.
- Independent applicant/application Kanban, desktop drag/drop, stage evidence/history, readiness review and actual external submission references.
- PKR fee agreements, recorded receipts, paid/pending indicators and contingent case incentive estimates.
- Tasks to-do board/list/matrix, local reviewed task commands, in-app reminders, project/goal links and monthly completion/reopening reports.
- CRM local reviewed case commands and saved fee/document reminder drafts.
- Student/staff request conversations, reviewed availability dates, follow-up replacement, received-file review and reopening after replacement versions.
- Private pasted-email update inbox, exact email/reference hints and explicit one-case review/apply with stale/duplicate/chronology protection.
- [Humeto Assist local alpha 0.2.0](extension/README.md): scoped pairing, reviewed identity/contact matching and protected empty-field fills.

## What remains

Document-source fact review and OCR; broader extension controls/attachments; live Gmail/Drive/messaging and outbound email; proactive task conversations, recurrence and paper capture; complete installment/invoice/commission operations; configurable CRM pipelines and speed analytics; mobile/voice/device push; production identity, storage, operations and billing. Details and acceptance criteria are in the local pending checklist and app plan.

Uploads do not extract or authenticate documents today. Stored drafts are not sent. Pasted-email review is not Gmail sync. In-app reminders are not closed-app device push. External applications are completed on their portals, with Humeto assistance; universal portal compatibility has not been established.

## Persistence and verification

PostgreSQL stores live records; `.data/uploads/` stores private original binaries. The local cluster and backups are inside ignored `.data/`, and credentials are in ignored `.env.local`. The retained SQLite file is a historical rollback source, not live storage. Rebuilding/restarting preserves data. Use `npm run db:backup` with app writes paused to back up records and uploads; production restore/security/retention procedures still need validation. The current pilot should use fictional data.

PostgreSQL migration (18 October 2026): 41 tables / 907 source rows and five original files reconciled; PostgreSQL dump/restore verified across 42 tables including migration history. The optimized build passes **61 automated checks**. `npm run test:release` uses a separate loopback server/disposable PostgreSQL database and a temporary extension fixture port, preserving distributed extension permissions.

Latest product increment: [focus companion, broader extension, flexible CRM pipelines, team assignments and finance](docs/FEATURE_DELIVERY_2026-10-18.md). Live Gmail/messaging and production deployment remain unconnected.

Current expanded release: **73 automated checks pass**, including focus UI, finance reconciliation, configurable pipelines, team permissions and extension file authorization.
