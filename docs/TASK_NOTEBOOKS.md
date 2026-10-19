# From paper to progress

Open **Tasks to-do → From paper to progress**. Upload a PNG/JPEG notebook image (up to 10 MB). The original and reading belong to the uploading member; other company members, students and platform admins cannot view them. Applied tasks join the shared workspace task board under its usual staff permissions.

The existing local OCR worker reads the image into source lines with boxes and engine reading scores. This is local Tesseract English OCR, not an external vision model. Printed text works best. Handwriting, page layout and crossed-out text may be missed. An explicit `[x]` or checkmark can produce a hint, never an automatic completion. It does not infer cancellation or delete tasks. If no usable lines are found, use a clearer image or Add task to transcribe manually.

Each source line starts at **Leave unchanged**. Locate its source region, correct the proposed task title, then choose **Create a new task** or **Complete an existing task**. New tasks can be linked to a project and goal and are assigned to the reviewing member. Completion requires choosing a current unfinished task. The final confirmation summarizes the number of creations and completions. Apply up to 50 lines per batch. Untouched source text, selected action, reviewed title, task link and application timestamp remain in notebook history; completion also enters normal task history and stops applicable timers/reminders.

Matching titles flag possible duplicates, including previously completed work. A duplicate creation requires an explicit allowance. Duplicate/ambiguous matches never choose a completion target automatically. A task or notebook changed elsewhere requires a refresh. Review batches are atomic: any invalid, stale or already-used source line rejects the whole batch. A source line cannot be applied twice. Reopen a task through the normal board if a completion was mistaken; the notebook record preserves what happened.

## Running locally

Apply migration `013-task-notebooks.sql` using `npm run db:migrate`. Use `HUMETO_OCR_ENABLED=true` and `npm run ocr:worker`. This worker now handles both applicant documents and notebook jobs. Restart an older worker after updating. Queue processing survives page closure and uses bounded leases, fencing, three crash-recovery attempts and explicit failed-job retries. No OCR runs in a request-scoped background promise.

Files live under private `.data/uploads/notebook-*`; derivatives live under `.data/ocr/notebook-*`, covered by the existing upload/OCR backup paths. Source SHA-256 is checked before processing. Source responses require the member's session and use private/no-store headers. Source images are not sent to a model or third-party service. File-signature checks and native-process time/image limits apply. Local file storage is not production encrypted object storage or malware scanning.

Limits: 100 images per member, 20 pending images per company, 500 source lines per image, latest 30 notebooks in the picker. Full pagination, retention/deletion tooling, stronger handwriting/strike-through recognition and production OCR isolation remain future work. A notebook is not an applicant evidence document and is never exposed through extension pairing.

For a fictional demonstration without personal files, run `npm run seed:notebook` in local-demo mode. It queues a printed example in Ayesha’s Northstar account and does not create or complete tasks. Open the notebook panel to select its latest saved image. OCR reading scores describe the engine output, not a correctness probability.

## Verification

Validated in the optimized local build and 114-check PostgreSQL release suite, including browser interaction and narrow-screen checks. See [delivery record](DELIVERY_2026-10-19.md) for the combined validation and restore drill.
