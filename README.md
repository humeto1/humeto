# Humeto local application

Next.js App Router + React + TypeScript + Node.js + SQLite WAL. The approved homepage is preserved, and its primary calls to action open the real local application.

## Start locally

Requires Node.js 22.13+ (tested here on Node 25.9). Install dependencies with `npm ci`.

- `npm run dev` — development with hot reload at http://localhost:4174.
- `npm run build` then `npm start` — compiled local release at http://localhost:4173.
- `npm test` — integration/matcher/Chromium-extension checks against the running development server on port 4174. Tests require fictional seeded demo data. Install the matching Chromium with `npx playwright install chromium` if it is unavailable.
- `npm run seed:assets` — creates clearly labelled fictional image documents after the local database is initialized through the login page.

The current local environment enables demo entry through `.env.local`. Only loopback hosts can use demo sign-in. Both start scripts bind to 127.0.0.1, not the public network. Do not enable local demo entry for a public deployment.

## Explore

Open `/login` and choose Institute, Student, Individual or Super admin. These are separate local sessions backed by an HTTP-only cookie. You can also create a local individual account, or use super admin to create an institute and its password-protected owner account. Passwords are hashed, not stored in plaintext. No email is sent.

## Implemented

- Persistent tenant-scoped applicant profiles, applications, tasks, information requests, audit events and subscriptions.
- Separate shared-profile, admission and visa journeys; country/purpose filtering; six questions at a time; one repeatable record at a time; autosave, skip/resume and revision-conflict detection.
- Repeatable education, tests, passports, family, employment, gaps, funding, travel and contact records.
- Germany/NZ/USA reference-derived preparation groups, including restricted USA disclosures. These are preparation concepts, not a verified full live visa questionnaire or eligibility determination.
- Fact search including aliases such as DOB; copy values with applicant/section context. Restricted values are excluded from general search.
- Private PDF/PNG/JPEG upload, category/group links, display labels, review state, preserved versions and authorized original download.
- Selected folder/file import, one confirmed applicant per batch, relative-path provenance, tenant/applicant-scoped duplicate linking and import history.
- Application working checklists, reviewed/waived gates for Ready, preparation snapshots and stored actual portal reference when recording Submitted. No external submission occurs.
- Tasks in board/list/Eisenhower matrix views; stage independent of importance/urgency.
- Staff/student account creation by workspace owner with staff seat checks; student access restricted to linked applicant.
- Super-admin institute creation and manual plan/status/seat/case/storage allowances. Read-only access blocks mutations while preserving existing reads/downloads.
- Humeto Assist Manifest V3 local alpha: one-hour revocable, applicant-scoped pairing; generic label/autocomplete matching; review-before-fill; existing values preserved. See `extension/README.md`.

## Persistent files

`.data/humeto.sqlite` is the database. `.data/uploads/` stores original binaries with generated private filenames; original names/paths stay in database metadata. These are excluded from Git and the Next public directory. Rebuilding/restarting does not reset the database. Back up the database and upload directory together before relying on records. This local build is for fictional test data until the production gates below are complete.

## Still to implement / validate

- Production auth recovery, MFA, invite links, password lifecycle and a full independent access review.
- Malware scanning, encrypted-storage/key management, robust backup/restore operations, retention/deletion and rate/size controls at a deployment proxy.
- Fine-grained evidence assertions and verification, immutable per-field history, application-specific narrative overrides and exact current official requirement templates.
- OCR/AI extraction and authoring, actual Google Drive OAuth/sync, live payments and communications. No fake successes or fabricated extraction are shown.
- More generic extension coverage: split dates, nested/cross-origin frames, dynamic custom widgets and controlled attachment workflows. No automatic signatures, submissions or payments.
- PostgreSQL migration before multi-server production. SQLite is intentional for the current single-host local development phase.

The wider product plan and deliverable ledger are in the parent `planning/` directory. Do not publish that directory or the original applicant source documents with the application.

## Task assistant (local command testing)

Open `/workspace/assistant` as an institute owner/consultant or individual owner. Try:

- `Create an important task to create a group with the new prospect team and remind me tomorrow`
- `How many important tasks are pending?`
- `Show my important not urgent pending tasks`
- `Mark "exact task title or task ID" done`
- `Remind me about "task ID" in 30 minutes`

Task changes require applying the review card. It records a task to create the group; it does not operate WhatsApp or create a real group. Chats are private to the signed-in user. Counts are computed from the existing task data; personal scope currently matches the assignee display name. Staff can deliberately ask for team/workspace tasks within the tenant's existing permissions.

Tomorrow without a time means 09:00 in the browser's detected timezone, displayed before applying. Reminders persist in SQLite, surface in the in-app inbox/bell when due and can be dismissed or snoozed through a new reviewed command. There is **no external/background push delivery while the app is closed**; due reminders remain available when the user returns. Completing the task removes its reminders from the active inbox.

The default engine is explicitly labelled **Local command testing**, with predictable supported commands. It is not a live AI chatbot. The user chose this mode for the current delivery. The optional OpenAI structured-intent adapter needs `HUMETO_AGENT_PROVIDER=openai`, `OPENAI_API_KEY` and `HUMETO_AGENT_MODEL` configured server-side before use; it has not been live-tested. No key belongs in a `NEXT_PUBLIC_` variable or source control. Provider errors do not trigger a silent mock-AI fallback.

WhatsApp account linking, Telegram and email remain planned. See `../planning/AI_TASK_ASSISTANT_PLAN.md` for architecture, scope and verification. The development script uses `next dev --webpack` to avoid the refresh loop observed with this installed Turbopack version; the production build still uses Next's default compiler.

## Leads, journeys and commercial tracking

`/workspace/leads` supports manual/custom-field intake, reviewed local add-lead commands, previewed CSV imports (500 rows), and expiring inquiry links with downloadable QR codes. The QR code is rendered locally; it calls no third-party image service. Public forms submit to this installation, so localhost links work only on this computer. Email and WhatsApp source tags are manual attribution until actual connectors are implemented.

Registration creates one applicant transactionally and transfers the agreed PKR fee, upfront target, timeline and contingent incentive. It does not record payment. Receipts have unique replay keys; applicant indicators show recorded paid/pending totals and independent application counts. Agreements, receipt corrections/refunds and invoices are not implemented as a full accounting module yet.

Applicants and applications have independent Kanban boards with drag/drop and stage selectors. Task board dragging changes stage; matrix dragging changes priority while preserving stage. Marking an application Ready still requires working-checklist review and Submitted still needs an actual external reference. Staff can record a note, link and uploaded supporting file version with an application stage change; history retains before/after status. Humeto does not submit university or visa applications itself.

CRM AI, Task AI and Extension AI entry points are visible at the top. Only the documented local commands and reviewed extension matching are active. Gmail reading/sending, automatic forwarded-mail identity matching and AI attachment interpretation remain planned in `../planning/INTELLIGENT_CRM_AND_LEADS_PLAN.md`.

## Projects, goals and monthly progress

Open `/workspace/progress` to create/edit/archive shared projects and goals, link tasks, view monthly contributions and search completion/reopening history. Tasks can link to one project and multiple goals, including during creation. The workspace team sees these plans; private journal/project permissions are not implemented yet.

Stage events are recorded at the database boundary for both reviewed assistant changes and manual changes. Completion snapshots preserve the task title/project/goal attribution at that time. Monthly reports use the chosen timezone, count each task once using its latest completion in the month, show raw completion/reopening event counts separately and expose the underlying tasks. Reopening does not erase history or revive the old reminder. Existing Done tasks with unknown completion dates are not assigned invented dates. Goal outcome status remains an explicit user assessment; task counts do not measure percentage achievement of a goal.

The Leads screen has a due/upcoming/undated follow-up queue. Creating a follow-up produces a real assigned important task for the lead's saved date, once per lead/date. It sends no external message; a later lead-date change does not silently alter that task.

## CRM AI local chat

`/workspace/crm-ai` supports explicit local commands for listing an applicant's cases, creating Draft external-application tracking cases, moving one application, closing one applicant relationship or active application, and preparing fee/document reminder drafts. Use the examples in the interface. Exact email and application IDs avoid silently choosing between several cases. Failed/approved/enrolled outcomes are preserved when a generic close command is requested. Ready and Submitted still go through the existing checklist/reference review.

Chats/actions/drafts are private to the actor. Applied case changes are shared and audited. Changes require a durable, expiring review action; cancellation, replay, ownership and stale-record checks are enforced. Fee drafts use the ledger, document drafts use open requests and changed source records invalidate a pending draft proposal. Drafts are stored locally and can be downloaded; no email is sent or queued for automatic delivery. This is deterministic local command testing, not a live model or Gmail connection.

`npm run test:release` tests a compiled build against a separately launched loopback server and disposable demo database. It selects a free port and cleans up a successful run. The browser-extension fixture uses a temporary copy with that test port added only in the test copy; distributed extension permissions are unchanged. Run `npm run build` first. This isolates test writes from the preview database.


## Document request conversations and follow-ups

`/workspace/requests` now connects a specific request to its student/staff replies, expected availability date, follow-up task/reminder, supporting file version and review history. Students can type an update, upload a new private file or link an accessible file from their own library. The student overview links directly to each conversation. Staff can require a supporting file before resolving a request.

Local date interpretation supports one explicit `YYYY-MM-DD`, “tomorrow” or “after/in N days” alongside an availability statement. Relative dates are anchored to the reply receipt timestamp in the selected IANA timezone. The proposed follow-up is 09:00 local time and requires consultant confirmation. Negative/ambiguous/multiple dates need clarification; a changed conversation invalidates an older proposal. Scheduling replaces the old reminder and updates one assigned follow-up task. These are in-app reminders, not background push or student email delivery.

A linked/uploaded file stops the existing upload follow-up and enters **File received**, separate from **Resolved**. Staff must explicitly accept the current version with a review note to resolve a file request. Changes requested, reopening, acceptance and subsequent versions retain history; a replacement version or revoked document review reopens the request. Acceptance is a staff workflow decision, not certification of authenticity or an automatic application-checklist approval. No file contents are read by AI in this delivery.

Server checks enforce applicant/tenant/restricted-group access, staff-only date/review decisions, read-only subscription restrictions, current revisions, replay-safe reply keys and transactional upload/reply linkage. CRM document reminder drafts exclude files awaiting review and future scheduled follow-ups, so they do not immediately chase the same upload again. Private request titles are excluded from ordinary staff follow-up task titles.

Gmail/WhatsApp replies and attachment ingestion, OCR/classification, student fact confirmation and automatic externally delivered follow-ups remain future work. The conversation here is an actual local portal workflow, not a simulated email integration. Verification: 49 automated checks pass against a disposable compiled release, including date interpretation, stale proposals, idempotency, reminder replacement/completion, file review/version reopening, role/tenant/restricted-group boundaries and read-only behavior.
