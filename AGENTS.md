<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared product rules

- Web and mobile are two clients of the same Humeto product. Shared task, planning, notification, permission, authentication and data changes must be considered on both platforms. Use the same backend, user accounts and PostgreSQL records. Shared planning/alert UI lives in `shared/`. Native OS permissions remain per device.
- Goals describe outcomes and projects describe deliveries. A task can be one-time or repeating/operational, and either can link to a project or goal. Treat recurrence as a task property in the product UX, rather than requiring a separate Routine plan. Existing recurrence tables retain independent scheduled occurrences. Groceries/subscriptions are examples of repeating tasks; Personal/Work/etc. are a separate category dimension. Preserve dated done/missed history; never reset a completed task tomorrow.
- Repeating tasks use a Repeat option on ordinary tasks. Home shows productivity, completion history and tracked work charts. Daily Done/Missed tracking and the planning calendar belong in Tasks. Plans exposes Projects and Goals; do not reintroduce a separate Routine category, tab or Add plan option.
- iPhone testing is deferred at the user's request. Android emulator tests use disposable local data and a separate QA package; production credentials must not be embedded in a mobile bundle.

- A task contributes to explicit goals plus its project's goal. Use the shared taskGoals helper for live counts/filters; keep explicit task_goals independently editable. Future completion snapshots include the deduplicated union; never rewrite old history when a project is relinked.
- Task views and filters are independent. Board/List/4Q/Calendar consume the same filtered records. Project and goal are relationship filters, Personal/Work/etc. are area labels, and expected profit/avoided loss is an estimate dimension that must never post real financial ledger entries.
- Optional Operations wording rotation uses reviewed alternatives only. Keep immutable canonical names/IDs and dated alias history. Do not silently apply fresh AI names or mutate schedule/meaning/assignee/value while varying display text.

- Client collaboration (guest chat/comments, file sharing and access grants) belongs to projects. Task cards keep reference links; never publish staff assignments, applicant records or internal financial targets through a project guest endpoint.
- Projects, goals and operations/routine series own teams; task responsibility inherits dynamically unless explicitly overridden. This does not grant guests internal workspace permissions.
- Parent financial targets distinguish upfront, completion and conditional estimated profit. Preserve currency, timing, conditions and routine basis; never add child-task estimates again or post ledger entries from planning data.

- Focus tracks work sessions, not automatic task completion. Enforce one active focus per user; pauses, breaks and ending a session preserve an unfinished task and its cross-day cumulative time. Only explicit completion changes the task to Done.
- Background/delegated/automated activity timers are separate from personal focused work, require comments and an expected update time, and do not launch AI jobs or start another member's focus session.

- Every Android testing release must update the website download: run `npm run release:android -- <verified APK>` and commit both `public/downloads/humeto-android.apk` and `android-release.json`. The normal `mobile` android:apk command does this automatically. Never publish the QA package. Website deployment publishes the new download; installed Android apps still require the user to install the update.
- Task forms select Goal through the shared dropdown, like Project. Preserve older multi-goal links explicitly. Future milestones belong within projects and goals, with an Add milestone action and links from activities; do not confuse milestones with goal selection or introduce nonfunctional milestone controls.

- Chat separates Humeto AI, project team/client conversations, and an opt-in global anonymous Break chat. Break chat intentionally spans workspaces, uses dedicated tables, and must never expose account/workspace identifiers or join applicant/task/private project data into its feed. Keep it text-only, with server-generated friendly animal aliases, pre-publication language screening that fails closed, report/block controls, bans and platform moderation. Anonymity is to peers; disclose private moderation records and external AI screening.
- Project conversations require an explicitly assigned project team member, workspace owner, or valid client invitation. Voice notes automatically send at 60 seconds; enforce the maximum duration on the server. Re-encode image previews; keep document downloads quarantined until trusted scanning clears them.

- Notification policy is shared by web and Android through the server delivery ledger. Automatic nudges are grouped, capped at three/account-local day and one audible group, and never repeat an occurrence automatically. Priority alone does not create an alarm. Later stays in-app; explicit reminders/Snooze keep their chosen time outside the automatic budget. Quiet hours default 22:00–08:00; focus alerts are optional. Break chat stays silent and project alerts default muted. Preserve stable source keys and one-device delivery ownership; never promise offline cross-device cancellation without remote push.

- Ongoing projects may have no deadline; keep project deadline fields optional across all clients. Home productivity uses real focus intervals, account-local dates and distinct recurring occurrences; never invent tracked hours or mix currencies in financial highlights. Project/goal elapsed duration starts at creation and stops at explicit completion. Milestones belong within a project/goal and link only to its tasks.

- Superadmin portal controls appear above My workspace. Session context may expose a platform-admin membership as the owner of its original tenant, but must never mutate the membership role or accept a target tenant from the client. Preserve same-origin checks, per-session context, ordinary-user denial and tenant isolation. Platform administration stays separate from customer CRM records.

- Android active-focus notifications are silent native chronometers, distinct from optional reminder alarms; reaching a check-in never completes a task. Saved native login stores only an encrypted session token with Android Keystore, never passwords or plaintext tokens in browser storage. Logout revokes the server session before deleting the device token.
- Goal timeframes are bounded calendar dates. Extending preserves a goal's task links/history; starting a new cycle creates a separate goal after the user reviews its name and target. Never reset or move old completed work automatically. Ongoing project deadlines remain optional.

- Initial Play release targets adults 18+ (owner decision). Do not advertise child safety or zero data collection. Keep public privacy/terms/deletion information accurate and linked in web/native settings. No-sale commitments do not erase AI/cloud/voice/file processing disclosures. New public signup requires explicit age/policy affirmation; don't claim that this is identity verification or that legacy/guest flows have been fully age-verified.
- Play uploads require a release AAB and dedicated upload signing/Play App Signing; the website testing APK remains a separate debug-signed testing artifact. Never mark Console/legal/deletion/moderation gates complete from source checks alone. Never publish keys, passwords or reviewer credentials.
- Keep Play Console owner notes, launch checklists, Data safety worksheets and draft store listings in the Git-ignored `planning/google-play/` folder. Do not force-add those files. Public legal pages are separate published app content.

- Task search uses the shared task-search helpers on web and mobile. Search-to-create must review available completed/filtered tasks and retained Archive/Bin matches; it opens a prefilled form and never saves automatically. Keep numeric references exact and preserve explicit creation for intentionally separate/recurring work. Similarity warnings are advisory, never a claim that duplicate detection is exhaustive.

- Native mobile core task/plan/Focus writes use the durable encrypted offline outbox and authenticated idempotent mobile-sync endpoint. Never discard queued edits on network errors or silently overwrite revision conflicts. Establish server account identity before replay, preserve local-to-server ID mappings, and keep recorded action time transaction-local. Server permission checks remain authoritative. Uncached AI/chat/files/advanced changes require internet; reports must not present fabricated offline totals. Logout must not erase unsynced work.
