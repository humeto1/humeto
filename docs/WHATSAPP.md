# Company WhatsApp connector

Humeto hosts its own linked-device connector using the official WhiskeySockets Baileys npm package (pinned 6.7.24). There is no Wasender API, account, proxy or credential dependency. This is not Meta's official Cloud API.

## Local operation

1. Apply migrations with `npm run db:migrate`.
2. Set `HUMETO_WHATSAPP_KEY` in the worker's private environment to 32 random bytes encoded as base64. A key was generated in the ignored local environment. Back it up separately from the database. Losing it requires re-pairing; do not rotate it without migrating encrypted sessions.
3. Run `npm run whatsapp:worker` alongside the web app.
4. As company owner, open Workspace → Settings → Company WhatsApp and choose Show pairing QR. Scan in WhatsApp → Linked devices. QR is owner-only and short-lived.
5. Prepare a text draft addressed to a team member/student using their international phone number. Review the draft and explicitly choose Approve & send. No messages are sent merely by saving a draft.

## Boundaries

- One number per tenant; database uniqueness prevents the same number being assigned to two companies. Messages, auth state, QR and drafts are scoped by the authenticated tenant. Students/platform admins cannot access the company inbox. Consultants cannot pair a number.
- AES-256-GCM encrypts auth records with tenant/key-bound authenticated data. QR is temporary authentication material; do not screenshot, log or share it. Database backups contain sensitive message content and require protected storage.
- A dedicated PostgreSQL advisory-lock session admits one worker. Connection failure terminates it; run under a supervised process. No serverless socket lifetime assumptions.
- Sending is reviewed, text-only and limited to one queued message per company per cycle. An ambiguous send becomes `unknown`; it is never automatically retried, to avoid duplicate messages. Sent means the transport accepted it, not read/delivery confirmation.
- Only newly notified direct phone-addressed text messages are ingested. Groups, historical imports, attachments, LID-only senders, delivery receipts, automatic applicant linking, AI replies and commands from WhatsApp remain pending. Incoming text is untrusted data and never executes app actions.
- A number must belong to the company pairing it. Linking is controlled by the owner's authenticated session; phone possession is proven by the scan. Do not use student or personal numbers without their authorization.
- Protocol changes can require a Baileys upgrade/re-pair. This initial local connector still needs a real company-number pairing and two-way delivery test. Automated tests do not send messages or claim a real connection.

## Deployment

Deploy Next.js on Vercel. Deploy this persistent worker on an always-running Node server using the same private PostgreSQL database and encryption key. The worker requires outbound WhatsApp connectivity and persistent process supervision. Do not run it as a Vercel route/function. One worker currently services all tenants with separate sockets/auth stores. Add retention controls, monitoring, per-company quotas and load testing before wider rollout.
