# Humeto technology stack

Verified from the installed workspace and package manifest on 18 October 2026. This describes the running local application, with future architecture separated below.

## Current implementation

| Layer               | Technology                                                                                                           | Role                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Web frontend        | Next.js 16.4.2 App Router, React / React DOM 19.3.1                                                                  | Homepage, server-rendered routes and interactive client workspaces                           |
| Language            | TypeScript 5.9.3; JavaScript for extension/scripts                                                                   | Typed app, domain validation and browser integration                                         |
| Backend             | Node.js; Next.js Route Handlers                                                                                      | Authentication, tenant-scoped APIs, commands, file access and review workflows               |
| Runtime             | Node 25.9.0 on this computer; package minimum Node 22.13                                                             | Current local runtime; supported production runtime still needs deployment validation        |
| Database            | PostgreSQL 18.6 via pg 8.23.1, pooled asynchronous queries, SERIALIZABLE transactions and native task-event triggers | Durable local tenant records, revisions, conversations, reviews, reminders and audit history |
| File storage        | Private filesystem under `.data/uploads/`                                                                            | Original PDF/PNG/JPEG binaries and preserved versions; metadata/hash in PostgreSQL           |
| Validation          | Zod 4.6.7 installed (`^4.3.6` declared)                                                                              | Server input and structured-intent validation                                                |
| Interface           | Custom CSS, Lucide React 0.577.0                                                                                     | Responsive design, icons and state styling                                                   |
| QR codes            | qrcode 1.5.4                                                                                                         | Locally generated inquiry-form QR codes                                                      |
| Chrome extension    | Manifest V3 alpha 0.2.0; JavaScript/ES modules, side panel, content script and service worker                        | Scoped pairing, generic field matching and reviewed empty-field fills                        |
| AI mode             | Deterministic local command/date/keyword interpretation                                                              | Current task/CRM testing and review suggestions without paid model calls                     |
| Optional AI adapter | Server-side `fetch` to OpenAI Responses API with structured intent validation                                        | Present for task interpretation; inactive and not live-tested in the current release         |
| Testing             | Node test runner, Playwright 1.62.1 / Chromium                                                                       | API/role/revision/workflow tests and extension/browser checks                                |
| Formatting          | Prettier 3.9.10                                                                                                      | Source formatting                                                                            |
| Source control      | Git                                                                                                                  | Application history; local plans, environment files, data and artifacts are ignored          |

Exact installed versions come from the lockfile/local packages; declared ranges can resolve differently after dependency updates.

## Authentication and data boundaries

Opaque HTTP-only session cookies map to server records. Passwords use salted scrypt hashes. Server checks enforce workspace tenant, role, person scope, subscription access and current revisions. Audited review actions and replay keys protect supported mutations. API responses use private/no-store headers; originals are downloaded through authorized endpoints. These are implemented controls, not a declaration that production security review is complete.

The extension uses one-hour revocable applicant-scoped pairing. It reads facts and offers reviewed matching; it does not need stored passwords for university/visa portals. Permissions/host access must be reviewed again before public extension distribution.

## Local operation

- `npm ci` installs the locked dependencies.
- `npm run db:start` starts the configured dedicated local PostgreSQL cluster; `npm run db:migrate` applies versioned schema updates.
- `npm run dev` starts Webpack development at `http://localhost:4174`.
- `npm run build` creates the optimized Next.js release.
- `npm start` runs that release at `http://localhost:4173`.
- Both servers bind to `127.0.0.1`; they are local previews.
- `npm run typecheck` runs TypeScript checks.
- `npm run test:release` starts an isolated compiled server with a disposable demo database, runs the suite and removes successful-run fixtures. Build first.
- `npm test` targets an already running development server and can write test records there. Prefer the isolated release runner for normal verification.
- Current application release: 85 passing checks, including actual local OCR and browser review/apply workflows.

## Planned architecture, not connected today

| Need                               | Direction                                                                                | Current boundary                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Multi-server production operations | Connection budgeting, monitoring and production load validation                          | PostgreSQL migration is complete locally; production capacity/ops remain unvalidated                                |
| Production documents               | Private object storage, malware scanning, encryption/key management and retention        | Current originals live on local disk                                                                                |
| Reliable background work           | Durable jobs/outbox, retries, deduplication and delivery records                         | Current reminders are in-app; no closed-app device push                                                             |
| Connected communication            | Authorized Gmail sync/outbox, then validated messaging channels                          | Pasted email review and saved drafts only; no Gmail/WhatsApp connection                                             |
| Document intelligence              | Source-linked fact review, then configured OCR/vision                                    | Local OCR/text extraction and source-linked reviews now work; broader multilingual/model extraction remains pending |
| AI across the products             | Optional configured model adapters with shared authorization/review tools                | Local command testing is the user's current selection                                                               |
| Mobile / voice                     | Shared server APIs; evaluate PWA/native implementation and device push at that milestone | Responsive web now; Capacitor selected by user for later mobile development                                         |
| Live commercial SaaS               | Subscription payment integration, lifecycle and production operations                    | Manual institute subscriptions; local invoices/receipts/P&L and employee allocations implemented                    |

The current stack keeps local setup and service costs small. It does not establish production cost, capacity or compliance. Provider selection and provisioning are separate future decisions.

## Code map

- `src/app/`: routes, API endpoints and global styles.
- `src/components/`: homepage, CRM/intake/tasks, request and inbox interfaces.
- `src/lib/postgres.mjs`, `db.ts`: cached PostgreSQL pool, transaction context, shared helpers and explicit fictional demo seeding.
- `migrations/`: immutable PostgreSQL SQL migrations/checksum ledger; schema changes run explicitly.
- `src/lib/auth.ts`, `repository.ts`: session/access and scoped data reads.
- `src/lib/agent/`, `crm-agent.ts`: local task/CRM command interpretation and reviewed actions.
- `src/lib/request-workflow.ts`, `update-inbox.ts`: reply/file/date and external-update review workflows.
- `extension/`: loadable Chrome extension source; `public/humeto-assist.zip`: packaged local alpha.
- `tests/`, `scripts/`: verification, release runner, packaging and fictional asset setup.
- `planning/`: local product plan/backlog/research; explicitly Git-ignored.

See [the app guide](APP_GUIDE.md) for workflows and [README](../README.md) for startup.

PostgreSQL cutover and verified backup/restore details: [database guide](POSTGRESQL.md). The SQLite backup is retained only for historical recovery; runtime does not use it.

New local modules: `focus.ts`, `pipeline-settings.ts`, `assignments.ts`, `finance.ts`; migrations 003–007. [Behavior and integration boundaries](FEATURE_DELIVERY_2026-10-18.md).

Local document reading uses native Tesseract/Poppler through a separate Node worker and PostgreSQL leased queue. No external model is called. [Operations, review semantics and deployment boundary](DOCUMENT_READING.md). Current release: 85 checks pass.

## Mobile task client (2026-10-23)
React 19 + TypeScript + Vite 8, bundled with Capacitor 8.5.3. Android APK testing build; iOS project prepared and deferred. Shared Next.js APIs, Neon and existing cookie authentication. Native HTTP, App lifecycle, Browser and Local Notifications plugins; no AI or database secrets in native assets. See [mobile delivery](MOBILE_APP.md).
