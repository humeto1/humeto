# Requested task-management work — 26 October 2026

Complete in order on web and Android, using shared account data:

1. Optional project deadlines: ongoing projects may be created, edited and kept without an end date. Goals retain their deadline requirement.
2. Home becomes a productivity dashboard, with AI task assistance prominent. Remove duplicated Today/Calendar controls from Home; task execution and Calendar remain accessible in Tasks.
3. Summary: total tasks, done, pending, repetitive/operational tasks and tracked work hours. Show longest tracked task, fastest completed tracked task, highest-value project and task. Keep estimated value distinct from actual payments; compare currencies separately.
4. Completed task history: Yesterday, Today, last 7 days, last 30 days and custom inclusive date range. Include completed recurring occurrences, showing a repeat/cycle indicator. Never reset old completion history.
5. Work-hours histogram: Yesterday by default; Today, 7 days, 30 days and custom range. Use real focused-work intervals, exclude breaks and paused time; split work across local date boundaries. No invented hours for untracked tasks.
6. Project and goal duration: show days from creation to completion (ongoing elapsed days until completed), with persisted completion timestamp. Task duration: show actual focus hours, first focus start and final session end automatically; no manual start/end fields.
7. Milestones within projects and goals: working Add milestone action, dated progress/status and task links, on both clients. Earlier product rule exists but implementation was absent at this audit.
8. Verify and publish one consistent web/Android release and update the website APK.

## Clockify study and further recommendations

Official sources reviewed: https://clockify.me/features/ , https://clockify.me/features/reports , https://clockify.me/features/projects . Clockify offers time breakdowns by period/project, estimated versus tracked hours, billable/non-billable reports, budgets, export, capacity scheduling and project milestones. The requested dashboard addresses the largest reporting gap in Humeto. Suggested later work (not automatic approval to build): report CSV/PDF export; task/project time estimates versus actuals; team workload/capacity; billable-hour rates and approved timesheets; project templates/dependencies. Surveillance/location/screenshots are not needed for this request.

## Implementation notes

Implemented shared Home dashboard, date-range completion history, hourly/daily work charts, total/selected-range personal focused hours and workspace task counts. Highest estimated project/task profit is shown separately for each currency and target basis and includes conditional estimates; no finance ledger is modified. Daily execution/calendar controls moved into Tasks. AI task assistance remains prominent.

Migration 035 records focus work intervals on start/resume/pause/end, including completion from another view. Historical measured slices are reconstructed from timer event counters and timestamps; untracked work is never assigned hours. First focus start and last session end appear under a task's Hours & duration panel. Project/goal elapsed calendar days start at creation; explicit completion captures a timestamp and reopening clears it. Previously completed plans without a recorded completion date are identified honestly.

Days, duration & milestones is available under each project/goal. Users add/edit milestones, optionally date them, link tasks belonging to that plan, and explicitly mark checkpoints complete. Revision checks, workspace boundaries, read-only subscriptions and task-feature permissions apply. Task detail shows linked milestones. Completing a milestone or project does not complete its tasks automatically.

## Verification

The compiled release suite passed 191 tests, including 20 desktop/phone viewport audits with no accessibility findings. Android acceptance passed 30 checks. Tests cover midnight and DST boundaries, empty-day hours, completion/repeat history, optional project deadlines, cross-workspace and student access, milestone revision checks and plan completion timestamps. Migration 035 was rehearsed on an isolated Neon branch before production application.
