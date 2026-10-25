# Chat

Chat offers Humeto AI, Project chats, and Break chat on web and Android.

## Project conversations

Workspace owners can open their workspace's projects and manage client invitations. Other staff must be explicitly assigned to the project. Removing an assignment, revoking a share, expiration, email verification and view-only rules are checked on every API request, including media previews. Guests only receive the shared project's public collaboration data, never internal task assignments, financial targets or applicant records.

Text conversations show the latest 100 messages in chronological order. Load older project messages pages through earlier replies; the previous 100-message write ceiling is removed. The shared UI polls while visible.

Voice notes use microphone permission and mono 16 kHz PCM WAV. Send stops early; Cancel discards. At 60 seconds the recorder stops and automatically sends. Navigation/backgrounding cancels recording. Tracks, AudioContext, timers and preview object URLs are cleaned up. Failed uploads retain a retry/discard option. The backend validates the exact WAV header, sample format, body size and maximum sample count; a claimed client duration cannot bypass the limit. Android declares microphone/audio permissions, with Capacitor handling the runtime permission prompt.

Still PNG/JPEG/WebP images are decoded under a 16-megapixel limit, resized to at most 2048 pixels, stripped of metadata and re-encoded. Sanitized images and validated PCM audio can be previewed through authenticated JSON media reads and temporary local blob URLs. Voice and image previews work with the same server authorization on native and web clients.

PDF, DOCX and XLSX uploads retain the existing quarantine and trusted ClamAV worker requirement. They cannot be downloaded before scanning marks them clean. No scanner is bundled into Vercel. Existing limits remain 2 MB per attachment, 20 files / 20 MB per project and 100 MB per workspace. A 60-second WAV fits the per-file limit. The worker is `scripts/project-file-scanner.mjs` and fails closed if scanning is unavailable.

## Global anonymous break chat

The room is shared across signed-in Humeto accounts, not restricted by workspace. Joining requires accepting the rules. Text only; the strict server schema rejects voice, images, files and extra fields. There are no public profiles or DMs. Server-generated aliases use curated friendly animals (no dog/pig aliases) and a random suffix; users cannot choose abusive aliases. Public records contain an opaque member ID, alias, message, timestamp and own-message marker. Account and workspace identifiers are never returned in the feed.

Anonymity is to other participants, not to the service: private account mappings enforce bans, blocks and reports. The consent screen states this clearly. Messages are sent to OpenAI for safety classification and users are told not to share confidential information. The public feed covers the last 24 hours; daily cleanup removes message/report evidence older than 30 days. Account-level aliases/sanctions/blocks remain until account administration removes them.

Local Unicode-normalized language/contact/link rules run first. A strict server-side gpt-5.4-mini classification uses the existing restricted Chat Completions key, checks all languages and transliterations (including Roman Urdu), and denies uncertain results. No post is inserted until an explicit allowed verdict is returned. Provider outages, missing keys and malformed responses block publication without counting a rule violation. The separate OpenAI Moderation endpoint is not used because the existing restricted key does not authorize it.

Per account: eight sends/minute, 100/day, 30 actions/minute, 60 reads/minute and 20 reports/day. Global capacity is bounded at 10,000 attempted sends/day. Rejected language increments strikes: three pause sending for one hour, six for 24 hours. Checks are serialized at final insertion so a concurrent ban cannot be bypassed by an in-flight classification. Client-generated message IDs deduplicate retries.

Participants can delete their own posts, report individual messages and block animal aliases. Reporting immediately hides the post for the reporter and opens a platform moderation case; reports alone do not automatically censor others or ban a person. Platform administrators see the queue in the platform console, can dismiss/remove, or remove and suspend the sender for 30 days. Moderation decisions never reveal real identities to participants.

No automated language filter guarantees perfect detection. Maintain the report queue and review policy effectiveness across languages.

## Validation
The wider release run passed 173/174 checks; the remaining APK version check was pending final APK publication. Eight focused security/browser checks passed, including global identity isolation, abuse/sanctions, owner-only moderation, retention cleanup, strict project membership, canonical audio validation, automatic send, image previews and fail-closed classifier responses. The 20-viewport audit reported no accessibility findings. Native Android acceptance passed 29 checks, including microphone capture, audio metadata loading, image rendering and text-only abuse rejection. Live classification allowed a friendly greeting and rejected an insult and an obfuscated harmful prompt. Migrations 032–033 were rehearsed on an isolated Neon branch.

Final packaging checks: the published-file test passed for signed Android 0.2.15. The mobile workflow and all four social-chat checks passed together after retrying a transient local PostgreSQL connection timeout. Production migrations 032–033 applied through the existing direct Neon connection.
