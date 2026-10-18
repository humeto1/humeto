# Local document reading and source-linked facts

Implemented 18 October 2026. This release uses local Tesseract and Poppler; it does not call an external AI/OCR provider.

## Use the feature

1. Open **Documents** and upload a PDF, PNG or JPEG. “Read this file locally” is enabled by default and can be unchecked. Folder imports offer the same choice; new request-response uploads also queue reading. Original files are unchanged.
2. Open **Document reader**, or use a document's **Read & verify information** link. Existing files can be queued with **Read current file**.
3. Wait for the persisted reading job. Scans/images use Tesseract; PDFs with usable embedded text use Poppler text extraction. A separate worker processes the queue, so leaving the page does not discard a job.
4. Inspect each suggested field against its source page, excerpt and highlighted region where available. Clicking a page link on mobile opens the source, with a return control to the selected fact.
5. Students **Confirm value** or correct/reject it. Staff **Accept as staff** or reject independently. Staff acceptance never masquerades as student confirmation. An individual workspace owner can self-confirm.
6. Select reviewed facts and save them to the form. Repeated sections require an explicit existing-record or new-record choice. Existing differences require an explicit replacement choice. Other fields are preserved; the section stays draft. No application is submitted.
7. If automatic matching misses a field, open **Read text / map a field**, select a source line, choose a supported question and create a linked suggestion. The mapped fact still requires review.

Source links appear with saved section answers and in paired extension facts. Manual form edits cause old links to be flagged; replacing a source version makes old facts stale and blocks their reuse. Historical originals, extracted values and review/apply events remain available. Confirming a fact does not authenticate a document or establish an application's readiness.

## Current reading support and limits

- English printed text. PNG/JPEG and unencrypted PDFs, up to 15 MB, 20 pages per PDF and 40 megapixels per image.
- Conservative labelled/stacked-label proposals for names, birth details, contact fields, passports, education, language tests and employment. Differing candidates remain separate; no inferred missing values.
- Ambiguous numeric day/month dates produce an empty proposed value and a clarification warning. Invalid dates abstain. OCR confidence is an engine reading score, not a correctness probability; embedded PDF text has no invented confidence score.
- Manual source-line mapping supports other nonrestricted/nonsensitive form fields. Health/security/declaration fields are not automatic targets.
- One job per document version. Completed jobs are reused; failed jobs have a revision-checked retry. At most 50 jobs can be pending per workspace, 300 automatic suggestions per reading and 500 total suggestions per job. Apply at most 50 distinct facts at a time.
- Each native command has a 45-second timeout and bounded output; Tesseract uses one thread. Large/unclear/corrupt/locked files fail with a useful message, without fabricating facts.

Not implemented: handwritten notebook task recognition, passport MRZ validation, layout-aware multilingual classification, arbitrary unlabelled CV/transcript interpretation, automatic rotation/cropping, external model extraction, document authenticity/fraud decisions or immigration eligibility decisions. Testing used fictional fixtures; broader real-document accuracy still needs an anonymized sample set.

## Local operation

Required tools are already installed on the current development computer: Tesseract 5.5.3, English language data and Poppler. On a fresh macOS environment, install `tesseract` and `poppler` through Homebrew; verify `tesseract --list-langs` includes `eng`.

Set the following in ignored `.env.local`:

```dotenv
HUMETO_OCR_ENABLED=true
```

Optional binary locations: `HUMETO_TESSERACT_BIN`, `HUMETO_PDFINFO_BIN`, `HUMETO_PDFTOTEXT_BIN`, `HUMETO_PDFTOPPM_BIN`. No model key is needed.

Apply schema and run the worker in a separate process:

```sh
npm run db:migrate
npm run ocr:worker
```

`npm start` runs the web app; it does not start a background worker. `npm run ocr:worker -- --once` processes one available job and exits. The UI reports whether a recent worker heartbeat exists. If the worker is offline, queued jobs remain in PostgreSQL. Start it to resume.

The worker uses leased claims with fencing tokens and `SKIP LOCKED`; expired leases retry up to three attempts. Results are committed only if the source version and lease are still current. Partial failed attempts do not publish facts. A worker can be stopped after its current native command/page finishes. A graceful interrupted job can be retried; a crashed worker is recovered through lease expiry.

The explicit local-demo command `npm run seed:ocr` adds one visibly fictional passport-details page and queues it, without applying its facts. It requires local-demo mode and the known fictional workspace. It never reads real applicant folders.

## Data and authorization

Migration `008-document-intelligence.sql` adds jobs, page text/regions, immutable extracted proposals, independent applicant/staff review states, review events, profile-application links and worker heartbeats. The original upload SHA-256 is checked before reading. Full text and previews remain private local data; no raw document text is printed to worker logs or sent to an external service.

Document/page/fact access follows the existing person, company and restricted-evidence permissions. Platform admins have no document-reading access. Mutations require an active writable subscription. Review revisions and profile revisions protect against concurrent overwrites. Rejected or stale-source facts cannot be applied. Correcting a chosen value resets the other party's previous review. Profile source links do not grant access to an otherwise restricted original.

Local files remain filesystem storage, not a claim of encrypted production storage. Durable production storage, retention/deletion, scanner isolation and deployment-grade processing quotas still require launch work.

## Files and backups

- Original files: `.data/uploads/`.
- Page previews: `.data/ocr/<job-attempt>/` (private directories); page text, boxes and review history: PostgreSQL.
- Failed attempts remove their derivative directory. Completed and historical previews remain for evidence review. A hard process crash can leave an unreferenced attempt directory; automated retention/orphan cleanup is not implemented yet.

Stop application writes and the worker before a backup. `npm run db:backup` now captures PostgreSQL, original uploads and OCR previews. Restore **both** `uploads/` and `ocr/` to the restored data directory with private permissions. Never replace originals with OCR derivatives.

`npm run db:verify-backup` captures a new backup, restores its database into a guarded disposable QA database, compares every table's rows, and verifies copied original/preview file hashes. Keep the source app and worker paused during this drill. It requires the existing dev-only database-admin configuration; it never restores over the live database.

## Verification and deployment boundary

The optimized build and **85 release checks** pass, including real PNG/JPEG OCR, embedded-text and scanned PDFs, source regions, student/staff separation, explicit new-record application, conflict consent, manual-edit invalidation, source replacement, restricted evidence, tenant privacy, failed files and bounded lease recovery. Browser tests cover review/apply and mobile source navigation.

Vercel can host the Next.js interface/API, but this native background worker has not been deployed there. Production needs a suitable worker runtime with the native tools and private durable shared storage, alongside cloud PostgreSQL. The current local filesystem preview route and upload implementation must be adapted before public deployment.

Engine references: [Tesseract command-line/TSV documentation](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html), [Tesseract installation](https://tesseract-ocr.github.io/tessdoc/Installation.html).

Restore drill on 18 October 2026: all **63 current tables**, **six original files** and **one OCR page preview** reconciled successfully. The ignored backup and verification report are under `.data/postgres-backups/2026-10-18T15-27-07-905Z/`.
