# Reviewed document bundles

Open **Documents → Prepare a document bundle**. Select one applicant and up to 20 current originals, choose names from document titles or original filenames, and set an optional portal per-file limit (1–15 MB) or PDF-only check. These are custom preparation checks, not official portal requirement templates.

Preview lists the exact numbered export filenames, versions, sizes and current document statuses. Download produces one ZIP containing unchanged original bytes and a JSON source/version/SHA-256 manifest. Filenames are flattened/sanitized and extensions follow the saved content MIME type. No original is renamed in storage, compressed, merged, rotated or otherwise edited.

A preview fingerprint must still match on download. New versions, changed metadata/restrictions or unavailable sources require another review. Size and SHA-256 are checked against every original before the archive is returned; a damaged source blocks the whole download. The ZIP uses STORE mode rather than recompressing PDFs/images. Total originals are bounded to 50 MB, with no more than 20 selected files. Future streaming exports/concurrency quotas are production work.

Applicant/tenant and restricted-evidence permissions match individual downloads. Staff cannot use bundles to access private disclosure sections. Students may export their own permitted evidence. Platform admins cannot read evidence. Downloads remain available to authorized users under a read-only subscription and use private/no-store headers. A bundle is delivered to the signed-in browser only; no extension, email, portal or external service receives it automatically.

Previewing or exporting does not verify authenticity, resolve pending document reviews, complete a checklist or imply application readiness. Portal-specific official requirement packs, compression/rotation/merging derivatives and historical-version bundle selection remain separate work. Use individual version history when a previous original is needed.

## Verification

The optimized build and all 119 PostgreSQL release checks pass. Bundle tests use an independent Python standard-library ZIP reader for CRC/UTF-8/byte checks and cover source tampering, preview/version changes, private sections, roles/tenant/origin, read-only access, portal checks and browser download at narrow widths. Python is a local QA dependency only; the application creates ZIPs using Node built-ins.
