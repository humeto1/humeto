# Humeto local app guide

Updated 18 October 2026. This guide describes working local functionality and its limits. Product roadmap: `planning/APP_PLAN.md` (local and Git-ignored).

## Sign in and roles

Open `http://localhost:4173/login`. Under **Explore a local demo**, choose Institute, Student, Super admin or Individual. Local demo entry needs no user password; it is enabled only by local configuration and restricted to loopback hosts. Do not reuse the old external CRM credentials for Humeto. Demo people/documents/messages are fictional.

Owners can manage workspace records and create staff/student access; consultants use authorized workspace operations; students access their linked applicant/intake/documents/requests; platform administrators manage institute subscription access through a separate interface. New individual registration and platform-created institute-owner accounts use their own passwords. Recovery/MFA/invitations still need production work.

## Screens and working workflows

| Route                     | What works                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/`                       | Three timed homepage covers and populated illustrative CRM/task/extension content                                          |
| `/workspace`              | Role-appropriate overview and next actions                                                                                 |
| `/workspace/tasks`        | Tasks to-do: board/list/Eisenhower views; independent stage and urgency/importance; desktop drag/drop and selectors        |
| `/workspace/progress`     | Shared projects/goals, task links, monthly timezone-aware contributions and completion/reopening history                   |
| `/workspace/leads`        | Manual/custom fields, reviewed local add-lead, CSV preview/import, inquiry link/QR, lead follow-ups and registration       |
| `/workspace/students`     | Applicant journey board/list, profiles, application counts and staff finance summaries                                     |
| `/workspace/students/:id` | Shared/admission/visa intake, repeatable histories, autosave, skip/resume, search/copy and related records                 |
| `/workspace/applications` | Independent application board/list, preparation details, working checklist, evidence/history and actual external reference |
| `/workspace/documents`    | Private uploads, review/organization metadata, file versions/downloads, selected folder import/history                     |
| `/workspace/requests`     | Specific student/staff conversations, date proposals, follow-up task/reminder, supporting file review and history          |
| `/workspace/updates`      | Private pasted-email review for staff/individual owners; exact-email/reference hints and reviewed one-case outcome updates |
| `/workspace/assistant`    | Local task command conversation, review cards and due reminders                                                            |
| `/workspace/crm-ai`       | Local case commands and saved fee/document reminder drafts                                                                 |
| `/workspace/settings`     | Workspace/team settings and extension pairing, subject to role                                                             |
| `/workspace/activity`     | Shared non-student audit view                                                                                              |
| `/workspace/platform`     | Platform administrator institute/plan management                                                                           |

Route existence does not grant access; role, tenant and subscription checks still apply. CRM AI, Task AI and Extension AI entry points remain visible in the main workspace. Tasks to-do is the first navigation item after Overview.

## Intake and documents

There are 32 sections with 260 field definitions. Work in small groups; skip and resume rather than filling every country field at once. Admission and visa journeys are separate; repeat histories add individual records. Save conflicts require reviewing current data rather than silently overwriting it. General search excludes restricted values.

Upload PDF, PNG or JPEG up to 15 MB per file, subject to the workspace storage allowance. Folder selection/import confirms an applicant, retains relative-path provenance and links duplicates within that scope. Original binaries are private, versioned and downloadable through authorization checks. Current document organization/review does not read file contents with AI or certify authenticity.

A request can require supporting evidence. Students can reply with an expected date or a file. Local interpretation supports one ISO date, tomorrow or after/in N days in an availability statement; a consultant confirms the 09:00 local follow-up. Ambiguous/negative/multiple dates need clarification. Rescheduling replaces the old reminder. Arrival stops upload follow-up and creates **File received**, then explicit staff acceptance/changes requested controls resolution. New versions or revoked review reopen affected requests. Received, checked facts, staff review and application requirement satisfaction remain distinct.

## Leads, applications and money

CSV intake is previewed (up to 500 rows); inquiry links expire and can be revoked. QR images are generated locally. A localhost inquiry link works on this computer, not as a public internet form. Email/WhatsApp source tags do not connect those services.

Registration creates one applicant and transfers the commercial targets, retaining the lead. It does not invent a payment. PKR agreements and replay-safe receipts drive paid/pending indicators. Upfront target, receipt and contingent incentive have separate meanings. Full installments, invoices, refunds and earned commission reconciliation remain pending.

Applicant and application stages are independent. A failed USA case can coexist with UK drafts/offers. Moving one case does not move its siblings or the applicant journey. **Ready** requires reviewed/waived mandatory working-checklist items; **Submitted** requires an actual external portal reference. Humeto does not submit the university/visa form itself.

## Conversations and updates

Current assistants use deterministic local commands. Task examples include `How many important tasks are pending?` and `Create an important task to create a group with the prospect team and remind me tomorrow`. A task to create a group does not create an external WhatsApp group. Changes use review cards.

CRM commands can list/create/move/close specific tracking cases and save fee/document reminder drafts. Exact emails/case IDs reduce ambiguity; final outcomes and readiness/reference gates are preserved. Drafts are not sent.

The Update inbox accepts pasted email/forwarded text with original received time. It suggests exact registered email candidates and application references. Missing/multiple/different matches require an identity-check explanation. Prepare a review, verify one application/outcome and apply explicitly. Original messages/reviews stay private to the capturing actor; applied case status and review note enter shared history. Old messages, stale/expired reviews, final outcomes, incompatible kinds and submission/readiness bypasses are blocked. Ignored records can reopen; earlier records load in pages of 100. Search covers loaded subjects/senders.

There is no Gmail OAuth/sync, email sending, WhatsApp session, automatic attachment ingestion or live document extraction. The optional task model adapter is inactive. No provider key should be pasted into chat or stored in frontend code.

## Tasks and reports

Tasks can link to one project and multiple goals. Completion/reopening events retain historical titles and links. Monthly reporting uses the selected timezone and counts each task once using its latest completion in that month; raw completion/reopening event counts are shown separately. Goal counts can overlap, so they are not additive unique-task totals. Task counts do not establish percentage achievement of a goal.

Due reminders appear in the app. Completing a task stops its reminders; reopening retains history and does not revive an old reminder. No background/device push occurs while the app is closed. Recurrence, supportive proactive conversations, notebook-image capture/reconciliation, voice and mobile clients remain pending. Project/goal visibility is currently shared within the workspace.

## Extension

See [extension setup and limits](../extension/README.md). Local alpha 0.2.0 pairs one applicant with a revocable one-hour scope, suggests identity/contact matches and fills reviewed empty fields. It preserves existing answers and rechecks changed elements. Advanced widgets, broad academic/visa/job mappings, conversational help, controlled attachments and cross-page sessions remain pending. Universal portal support is not established.

## Data, verification and production status

Live records are in PostgreSQL; original files and the dedicated local cluster/backups are under ignored `.data/`. Start the configured cluster with `npm run db:start`. Take a PostgreSQL dump/upload backup with app writes paused; see [database operation](POSTGRESQL.md). The old SQLite file is retained only as a historical rollback snapshot. Rebuild/restart does not reset data. Environment secrets, screenshots and private planning are also excluded from Git; ignore rules are not a backup or deployment-security mechanism.

Current application release: optimized build with 85 passing automated checks plus recorded browser checks. Prefer `npm run build` then `npm run test:release`, which tests disposable records; ordinary `npm test` targets a running development database. The database migration preserved 41 tables / 907 rows and five original files, and a PostgreSQL dump/restore was verified. It does not enable new external integrations.

Public production still needs authentication lifecycle, independent access review, secure/scanned storage, backup/restore, retention/export/deletion, durable jobs, load testing, observability and configured external services. See [tech stack](TECH_STACK.md) and the local `planning/PENDING_FEATURES.md` checklist.

## New focus, pipeline, team and finance workflows

See [the delivery guide](FEATURE_DELIVERY_2026-10-18.md) for task focus/timers, scoped extension attachments, configurable CRM columns, team assignment and the owner Finance tab. Gmail/WhatsApp are not connected; no external messages are sent.

The preceding product increment passed **73 automated checks**. The earlier 61-check PostgreSQL cutover result is historical.

## Read documents into reviewed profile facts

Open **Document reader** to read a file locally, inspect source pages, confirm/correct facts and save reviewed selections to draft intake. New uploads/imports can queue reading. Source replacement and manual edits flag prior links. See [the full workflow and limits](DOCUMENT_READING.md). Current release: **85 passing checks**.

## Interactive Tasks to-do

The focus companion now supports reviewed local conversations, progress percentages, next steps, blocker guidance, safe switching and optional open-app check-in alerts. See [the interactive task guide](INTERACTIVE_TASKS.md).

## Recurring tasks and follow-ups

Open Tasks to-do → Follow-ups & recurring tasks for your inbox, schedules, preferences and history. The header bell opens this panel. Project cards now include Assign team. See [Task scheduling](TASK_SCHEDULING.md) for setup and delivery boundaries.

## Company notifications

Open Notifications to read company messages. Company owners can draft, preview and publish to staff/instructors, students, selected people or everyone, with optional pop-ups and start/expiry dates. See [Announcements](ANNOUNCEMENTS.md).
