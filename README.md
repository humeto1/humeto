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
