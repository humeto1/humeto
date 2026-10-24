<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared product rules

- Web and mobile are two clients of the same Humeto product. Shared task, planning, notification, permission, authentication and data changes must be considered on both platforms. Use the same backend, user accounts and PostgreSQL records. Shared planning/alert UI lives in `shared/`. Native OS permissions remain per device.
- Goals describe outcomes and projects describe deliveries. A task can be one-time or repeating/operational, and either can link to a project or goal. Treat recurrence as a task property in the product UX, rather than requiring a separate Routine plan. Existing recurrence tables retain independent scheduled occurrences. Groceries/subscriptions are examples of repeating tasks; Personal/Work/etc. are a separate category dimension. Preserve dated done/missed history; never reset a completed task tomorrow.
- Repeating tasks use a Repeat option on ordinary tasks. Daily Done/Missed tracking belongs on Today/Home (web Overview). Home also exposes Calendar for upcoming/completed work and plan deadlines. Plans exposes Projects and Goals; do not reintroduce a separate Routine category, tab or Add plan option.
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
