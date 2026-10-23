<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared product rules

- Web and mobile are two clients of the same Humeto product. Shared task, planning, notification, permission, authentication and data changes must be considered on both platforms. Use the same backend, user accounts and PostgreSQL records. Shared planning/alert UI lives in `shared/`. Native OS permissions remain per device.
- Distinguish goals (measurable outcomes with deadlines), projects (finite deliveries with tasks) and routines/operations (independent scheduled occurrences). Groceries and subscriptions are routine types; Personal/Work/etc. are a separate category dimension. Preserve missed and completed occurrence history; never simply reset a completed task tomorrow.
- iPhone testing is deferred at the user's request. Android emulator tests use disposable local data and a separate QA package; production credentials must not be embedded in a mobile bundle.

- Task views and filters are independent. Board/List/4Q/Calendar consume the same filtered records. Project and goal are relationship filters, Personal/Work/etc. are area labels, and expected profit/avoided loss is an estimate dimension that must never post real financial ledger entries.
- Optional Operations wording rotation uses reviewed alternatives only. Keep immutable canonical names/IDs and dated alias history. Do not silently apply fresh AI names or mutate schedule/meaning/assignee/value while varying display text.

- Client collaboration (guest chat/comments, file sharing and access grants) belongs to projects. Task cards keep reference links; never publish staff assignments, applicant records or internal financial targets through a project guest endpoint.
- Projects, goals and operations/routine series own teams; task responsibility inherits dynamically unless explicitly overridden. This does not grant guests internal workspace permissions.
- Parent financial targets distinguish upfront, completion and conditional estimated profit. Preserve currency, timing, conditions and routine basis; never add child-task estimates again or post ledger entries from planning data.

- Focus tracks work sessions, not automatic task completion. Enforce one active focus per user; pauses, breaks and ending a session preserve an unfinished task and its cross-day cumulative time. Only explicit completion changes the task to Done.
- Background/delegated/automated activity timers are separate from personal focused work, require comments and an expected update time, and do not launch AI jobs or start another member's focus session.
