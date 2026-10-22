> Subsequent OCR delivery: local document reading/source-linked reviews are now implemented. See [Document reading](DOCUMENT_READING.md) for current behavior and limits. Earlier OCR-pending statements below describe the preceding increment.

# Product expansion — 18 October 2026

This record distinguishes working local behavior from account integrations and production work. The user's nine-point request and later clarifications drive this increment.

## Delivered locally

### Task focus companion

Open **Tasks to-do**. Choose an unfinished task and expected minutes, then start. The remaining task board is hidden while focusing (you can reveal it). The timer is stored in PostgreSQL and survives refresh. At the selected check-in time the open app asks whether to finish, continue, pause, flag a blocker or stop and choose another task. Notes, elapsed time, completion and session history are retained. One active session per member prevents overlapping timers. Completing the task through another app surface also stops its focus timer.

This is a deterministic local companion, not a live model conversation. Check-ins currently require the app to be open; closed-app push, recurring-task generation, durable reminder delivery and notebook-image recognition remain pending. Mobile will use Capacitor after web workflows are ready, as selected by the user.

### Broader extension and document assistance

Create a one-hour pairing in **Workspace settings**, choosing reusable sections. Identity/contact, passports, education, tests, work, family, references, study goals, travel history, trip plans and study-visa information can be explicitly shared. File access is a separate opt-in; old pairings never gain download rights implicitly.

The side panel now searches saved information and explains how to review/fill/attach. It reports saved section, update time and unverified status. Conservative matching supports additional ordinary fields. Multiple candidate records abstain; family and referee records require explicit manual selection. Existing answers remain untouched.

After scanning a page, choose one shared document and a visible ordinary file input, then explicitly approve attachment. Version and applicant scope are checked server-side; page/field changes and existing files are protected. File assistance is capped at 10 MB. Download is available as a manual fallback. Approved file bytes are sent to the chosen website; pairing credentials never enter it. No external AI is called.

Cross-origin/nested frames, split-date controls, complex upload widgets, broad real-site compatibility, ongoing page sessions and actual document OCR/source assertions remain pending. This is assisted filling on supported controls, not a claim that every portal works.

### Flexible pipelines

Owners now edit stages **directly on each board** for tasks, leads, applicants and applications (updated 2026-10-23). Click a title to rename it, use its menu to reorder/delete, or choose Add stage. Rename titles, reorder, add or remove columns. Removal requires a surviving destination and moves existing cards transactionally. Retired keys redirect future events so they do not recreate orphaned columns. Stable milestone keys preserve existing readiness/submission behavior after a title change. Only owners configure pipelines; staff use them. Card movement still updates status. Local CRM commands recognize configured application titles.

Task stages remain their own lifecycle; this increment configures CRM pipelines. Stage deadlines, velocity and speed/value reporting remain separate work.

### Team assignment

Applicant/application/task cards offer **Assign team**. Select several actual workspace staff accounts; saves use member IDs, role/tenant checks and optimistic revisions. This adds responsibility metadata without changing the existing shared-workspace visibility model. A project assignment API is available; its dedicated project UI remains pending. Team groups, workload reports and invitations need later work.

### Finance

Owners have a **Finance** tab with:

- Invoices and dated installment schedules; printable HTML invoice export (browser Print → Save as PDF).
- Existing client receipts linked to invoices, with unmatching for corrections/refunds.
- Bounded refunds and credit notes, preserving their different cash/income effects.
- Earned institution/application commissions and partial receipt reconciliation; tentative incentives remain separate.
- Expenses/salary payments, period P&L, client balances and a balanced debit/credit ledger with CSV export.
- Monthly salary/overhead profiles and **fixed case/project cost and revenue attribution**, per the user's choice. These are management allocations and do not create duplicate company expenses or revenue.
- Owner-only financial reports and salary access, tenant checks, retry keys and atomic posting.

Current currency is PKR, with whole-rupee amounts. P&L recognizes issued service invoices and manually confirmed earned commissions, less credit notes and recorded expenses. Historic receipts become client credits until invoiced. Cash shows recorded movement, not a bank-reconciled opening/closing balance. Month selection filters P&L/ledger/employee allocations; client/commission balances and source records are all-time and labelled accordingly. The seeded local demo includes explicitly illustrative invoice/expense/employee data.

Still pending: tax/VAT and FX accounting, supplier payables, bank feeds/statement reconciliation, opening balances/year close, automatic payroll and automated accountant-grade financial statements; corrections/reversals beyond the supplied credit/refund/unmatch flows; linked commission entitlement evidence. Humeto subscription billing remains distinct and not connected.

## Gmail — setup and testing

A real mailbox is useful after the app's OAuth connection is implemented. Use a dedicated test Gmail containing fictional students and forwarded application messages. Never share a Gmail password or paste credentials into chat.

Planned flow: **Settings → Connections → Connect Gmail → Google consent → choose mailbox/folders or labels for app processing → initial sync → history-based incremental sync → inbox review → confirmed case update**. Folder/label processing preferences do not technically narrow the OAuth scope: Gmail body reading uses a broader Gmail scope, which must be explained at consent.

Read access and send access must be independently requested. Encrypt refresh tokens, verify account ownership, support disconnect/revocation, and store sync cursors. Forwarded headers/aliases and applicant email are evidence; ambiguous matches require review. Actual sends need reviewed recipients and an idempotent outbox with retry/delivery history. Inbound text is untrusted data, never authorization to send, pay or change cases.

Google documents full/incremental sync, history expiry recovery, and push-triggered updates. Gmail read scopes are restricted and public distribution can require verification/security assessment. Current app only has pasted-message review and drafts; no Gmail account is connected.

Sources: [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync), [push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## WhatsApp and Telegram

The requested WhatsApp UX is: Connect → genuine backend-generated QR → phone's Linked devices scan → connected number/status → send/receive inbox → reconnect/disconnect. A decorative QR is not a connection. Session credentials need encryption and account isolation; webhook messages/attachments need duplicate handling and verified request/student linking. New incoming numbers do not automatically become authorized app operators.

The supplied wasender.com currently describes a browser extension. WasenderAPI is a separate service whose docs describe QR/session states. No provider account was provisioned or selected by this implementation. Choose the supported channel/backend path before connecting an account. A long-running linked-device session needs an appropriate backend/service; don't rely on one Vercel request remaining alive indefinitely.

Telegram should begin with a bot and verified account-to-chat pairing, then webhooks. This is not a user's full Telegram-account login. External student replies should join the existing request/review workflow, with received-time-relative dates and attachment verification.

Sources: [WA Sender](https://wasender.com/), [WasenderAPI session webhooks](https://wasenderapi.com/api-docs/webhooks/webhook-session-status), [Telegram webhooks](https://core.telegram.org/bots/webhooks).

## Vercel, production and billing

User selected **Vercel** for web deployment and **Capacitor later** for mobile. Deployment has not happened in this increment.

Before deployment: choose/connect managed PostgreSQL with a production connection budget; replace `.data/uploads` with private object storage and authorized direct upload/download flows; run versioned migrations as a release step; add durable jobs/outbox for Gmail watches, recurring tasks and follow-ups; configure secrets, HTTPS cookies, invitations/recovery, logs, backups and tested restore. Public deployment must disable loopback demo entry. Vercel function payload limits require a different path for large document uploads; current filesystem upload/download handlers are local-only.

Budget has separate lines: Vercel, database, private files, background processing, outbound messages, AI/OCR, domain and payment processing. As checked on 18 October 2026, Vercel documents a $20/month Pro platform fee with one deploying seat and $20 usage credit; additional usage/add-ons/paid seats can cost more. This is not a total Humeto operating-cost estimate. Hobby is non-commercial/personal.

**Humeto subscription billing** means institute/individual plans, seats/usage limits, renewals, invoices, failed-payment handling, refunds and entitlements. This is different from clients paying a consultancy for application services. Existing manual subscription controls remain until a payment integration is built; never use an institute's client receipts to activate its Humeto plan.

Sources: [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [Hobby limits](https://vercel.com/docs/plans/hobby), [function limits](https://vercel.com/docs/functions/limitations), [private storage](https://vercel.com/docs/vercel-blob/private-storage).

## Niche decisions

Education consultants and travel agencies are separate company types, not departments of one institute by default. Education retains applicant/admission/visa workflows. Travel agencies need tickets and visit-visa workflows; detailed booking, supplier and ticket/refund requirements still need discovery. Coaching is explicitly deferred. Partner/subagent portal permissions and commission split terms remain to be specified.

## Verification

Full optimized build and isolated PostgreSQL release tests cover existing workflows plus new focus, finance, assignment, pipeline and extension behavior. See the final session handoff for the final recorded count. Local tests use disposable data; no real Gmail/WhatsApp messages or payments were sent.
