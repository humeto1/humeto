# Focus and task views — UI update, October 23, 2026

Web and mobile now use a compact task selector with Start, Pause and Stop. Selecting a different task does not switch immediately: Start saves the current session and starts the chosen task. Stop ends the work session without completing its task. Hold Complete for one second to finish, or tap/press Enter and confirm; movement or cancellation stops a hold. Completion is disabled while a different task is selected but has not started.

Break type/duration sit inside a themed Take a break panel. Starting a break pauses work; Start resumes when ready. Reset & switch, coaching and notes are collapsed by default. Recent sessions remain available, with older web history under More sessions. Core timer controls remain visible.

The task overview uses an eye icon with an accessible label. Group collapse/expand controls match the theme. Due dates is the calendar view: choose a day to see tasks due that day, using the current task filters. Undated tasks remain separately available. Changing month selects a date in that month; Today returns to the current day.

Validation: both builds pass; full release baseline 157/157; focused UI/interaction checks 7/7; date/overview regression 1/1; Android emulator 25/25. Active Focus was checked with Axe on desktop, narrow web and the mobile preview. APK 0.2.2 is debug-signed for testing; physical device behavior still needs acceptance.

--- Existing feature reference ---

# Shared task planning · web and mobile

Web and mobile are clients of the same product: identical users/authentication, workspace boundaries, PostgreSQL records and backend task mutations. Shared planning/calendar/alert/impact UI is in `shared/`. Platform permission and battery settings remain local to each device. Future changes must account for both clients (also recorded in AGENTS.md).

## Independent dimensions

Views are Board, List, Priority matrix (4Q) and task Calendar. They receive the same filtered task array and changing views does not reset filters.

Filters separately select: a specific project, a specific goal, area/category (Personal, Work, Social, Relationship, Family, Health, Learning, Hobby, Financial or custom), one-off/routine task nature, expected financial impact, due date and assignment. Status/stage and importance/urgency retain their own meaning. Mobile also retains Pending/Done/All status selection. A collapsed filter panel shows the active-filter count. Categories are not workflow stages or project names.

Time is tracked in Focus and its session history. Outcome/activity progress is shown in Projects & goals and completion history; no duplicate task records are created for another view. One active focus session is permitted per user/workspace. Switching preserves prior time and leaves the previous task unfinished.

## Goals and projects

A goal describes a measurable outcome and deadline. New goal API creation requires a target date. A project is a finite delivery and may reference a goal in the same workspace. Both have category, description, status and deadline editing in the shared calendar. Goal outcome text is stored separately as success_metric. Existing undated plans are flagged under “Plans needing a deadline”; dates are not invented for legacy records. Task-level project/goal links remain explicit; setting a project's supporting goal does not silently reassign previous task links or historical completions.

## Repeating work

Routines are separate from one-off delivery work. Routine types: Operations, Groceries/replenishment and Subscription/renewal. Frequencies: daily, weekdays, weekly, monthly, yearly, with interval 1–12 and timezone-aware local time. A subscription routine is a reminder, never an automatic payment or renewal.

Each occurrence has its own day, task identity, completion state and stable series ID. Completing today does not stop tomorrow's occurrence. Templates stay out of the task board; generated occurrences carry category, project/goal/team links and expected-impact estimates. The scheduler catches up tracked routines, retaining expected-day evidence. To bound board size, only the latest 31 days become task rows; older expected days remain missed evidence with no fabricated completion. Catch-up is bounded to 5,000 recurrence steps; invalid/excessive schedules pause for review.

The background task worker generates occurrences when hosted. Opening web/mobile also reconciles the signed-in member's routines, so tomorrow's work appears even without an always-on worker. Untracked legacy repeat series retain their earlier latest-occurrence catch-up behavior; the new weekly report covers tracked routines created through the shared planning interface.

Weekly review is scoped to the current member's routines. It groups done, missed, pending, upcoming and intentionally skipped occurrences. Past scheduled days not marked done are missed; today remains pending. A late completion becomes done while retaining the original due date. Paused days are recorded as skipped when resumed. Skips and changes preserve series-event history. Occurrence day uses its schedule timezone; report week boundaries use the selected report timezone.

## Expected financial impact

Task Add/Edit offers No estimate, Potential profit or Avoid loss/penalty, optional amount, three-letter currency and explanation. Amounts are stored as integer minor units; negative or over-precision amounts are rejected. Cards show compact indicators and both platforms filter by impact independently of view or other categories. These are estimates for prioritisation. No invoice, payment, income or expense is posted; currencies are not converted or summed across currencies.

## Fresh operational wording

Optional only for tracked Operations routines. The canonical task name, routine ID and task IDs never change. GPT-5.4 mini uses the existing server-side Chat Completions connection to propose up to eight surface-wording alternatives. No task documents or unrelated context is sent; only the canonical routine title. Generation has a per-routine one-minute cooldown and a 25-second timeout. Provider failure leaves the routine unchanged; local command mode does not pretend to generate AI wording.

Review and explicit acknowledgement are required before activation. Numbers, links, email addresses and negation are checked as guardrails; human review is still required for meaning, people and scope. Alternatives can also be entered manually. A reviewed pool rotates per occurrence, eventually repeating after the pool cycles; there is no daily model call or silent new wording approval. Original name remains visible beside a display alias. Each used alias, canonical name and wording revision is saved on the dated occurrence. Existing aliases are not rewritten when the pool changes. Turning rotation off affects future occurrences. Changing the template name invalidates the pool until it is reviewed again; manually changing an occurrence title suppresses its display alias.

## Notifications and timers

Reminder preferences (chime/bell/silent, vibration and preferred precise timing) are shared per account. Android creates separate OS channels for tone/vibration combinations and respects user overrides instead of deleting their settings. The diagnostics UI reads global notification permission, channel configuration, ringer mode, notification volume, Do Not Disturb state, battery restriction status and exact-alarm permission. It opens Android notification settings and the optional exact-alarm permission screen. Audio assets are bundled; no provider handles notification sounds.

Native reminders, focus check-ins and projected routine alerts are scheduled locally. At most 60 upcoming alerts are queued; up to eight upcoming occurrences are considered per active routine, then the earliest alerts win. Opening/resuming refreshes the queue. Quiet hours defer alerts and disabling account reminders cancels them. Completion cancels that task's local reminder. Logout cancels all queued/delivered notifications. Schedules changed on another device may remain stale until this device syncs. Exact scheduling is opt-in and only used when Android grants permission. Sound, vibration and precise delivery are not guaranteed under OS restrictions, silent mode or Do Not Disturb. Continuous ringing/full-screen wake alarms and remote FCM/APNs push are not implemented.

The device test queues a notification ten seconds ahead, on the selected tone/vibration channel. Test on a physical phone by saving preferences, sending a test, scheduling a reminder several minutes ahead, locking the phone and checking delivery with normal/silent/DND/battery settings. The emulator proves channel configuration and notification delivery, not what a physical speaker or vibration motor feels like.

Web desktop notifications require browser permission and Humeto to remain open. Browser/OS settings and autoplay rules may suppress audio/vibration. Focus shows elapsed time and remaining estimate; it continues tracking until paused, switched or finished. It never silently marks a task done when the estimate expires.

## Validation

149 release checks passed against disposable local PostgreSQL, including recurrence catch-up/idempotency, late completion, pause/skip semantics, monthly/yearly dates and leap years, calendar deadline editing, tenant/read-only boundaries, stale preference edits, expected impact without accounting entries, and immutable wording history.

23 Android API 34 emulator checks passed, including live GPT-5.4 mini assistant and wording generation, task-impact/category filtering across views, native channel tone/vibration, delivered timed alert, future subscription alert, shared goal deadlines, session restart and logout. Android icon uses the tilted Georgia-serif h monogram; source outlines and a reproducible launcher renderer are checked in. iPhone testing remains deferred; only its source icon asset was updated.

## Assistant conversation history

Web and mobile open the latest 30 messages. Scrolling near the top loads the next older page; a Load older messages button provides a keyboard/touch fallback and retry. Keyset cursors use a message ID scoped to the signed-in user's conversation. Each page is bounded to 30, fetched without unrelated summaries, and returns current action status. Prepending preserves the reading position; incoming replies preserve loaded history. The model still receives its existing last-eight-message context, independent from visible scrollback.

## October 23 release scope

The requests below are implemented on web and mobile. The initial task-level sharing proposal was superseded by project-level client collaboration; task cards retain their own reference links.

## Project collaboration and shared ownership (October 23)

Client collaboration is project-scoped. In Projects & goals → Project collaboration, open a project for its chat/comments, shared links, attachments and sharing controls. Individual task cards retain reference links only. Private task notes, staff assignments, applicant records and financial targets are not returned by the public project endpoint.

Sharing supports expiring view/contribute links, optional email restriction with an eight-digit verification code, revocation, copy, email, WhatsApp and the native Android share sheet. Clients use an ordinary browser without an app account. Public contributors are labelled guests; a self-entered name is not verified identity. Contribution challenges are single-use, require a short dwell time, and submissions/read requests are rate limited per link.

Attachments accept matching PDF, DOCX, XLSX, PNG, JPEG and WebP signatures, up to 2 MB each, 20 files / 20 MB per project and 100 MB per workspace. Files persist in PostgreSQL for the initial small deployment. All new files are quarantined; no file bytes are downloadable before an antivirus scan. On the trusted worker server install ClamAV, maintain current signatures, and schedule `node --env-file=.env.local scripts/project-file-scanner.mjs`. Scanner failures leave files quarantined. A clean scan is risk reduction, not a guarantee that any file is harmless. Large-scale file storage and content-disarm processing remain future infrastructure work.

Projects, goals and routine/operation series have their own team controls. Tasks without explicit assignments inherit their project, linked-goal and routine teams dynamically. A task can override this or return to inheritance. Team responsibility and public client access are separate systems.

Each project/goal/routine has an internal financial target: expected upfront profit, completion profit and conditional reward, with currency, expected dates, reward condition and whole-plan/per-occurrence/month/year basis. Conditional money is separate from the base target. Child-task estimates never automatically increase the parent target or create financial ledger entries.

Bird’s-eye view is a compact responsive workload map with counts, overdue/important indicators and grouping by stage, project, category or priority. It consumes the same filtered tasks as Board/List/4Q/Calendar and opens normal task details.

Focus adds a random task suggestion (explicit selection; never automatic start) and an optional ten-second transition reset. The reset does not silently complete, pause or switch work. Finish, extend, pause and switch remain user decisions. Reduced-motion preferences shorten the shuffle animation.

## Work sessions, breaks and parallel activity

One active focus is allowed per user, independently of other members. End work session saves a handover note and leaves the task open; Mark task complete is an explicit separate action. Focus totals sum all the user's sessions for each task, including work spread over days. Session start/end timestamps and notes remain in history.

The break coach uses recorded continuous time and the expected check-in, not keyboard/screen surveillance. It offers gentle check-ins, short rests, stretches, walks or a jog by choice. Starting a timed break pauses the work clock; the focused task stays selected and the board remains out of the way. Break-end alerts follow existing opt-in notification, quiet-hours and native sound/vibration settings. Work never resumes automatically. Desktop alerts require the browser/app to remain open; native scheduled alerts remain subject to device settings.

Task details → Activity timers & status check-ins records delegated team work, an already-running AI/automation process, or waiting work while the user focuses elsewhere. Enter what is happening, who/what is performing it, and when an update is expected. Check-ins use existing reminder delivery, and updates can request a new interval. These clocks track activity elapsed time separately from personal focused time; they do not launch jobs, bill hours or complete tasks. Each member still controls their own private focus. Task completion explicitly closes remaining activity timers and cancels their reminders.

Deadline distinction: project target dates and individual task due dates are separate. Focus minutes and activity check-in intervals are work/check-in estimates, not delivery-date replacements.
