# Recurring tasks and durable in-app follow-ups

Open **Tasks to-do → Follow-ups & recurring tasks**. This panel is collapsed while working normally, and hidden together with the board during a focus session. The header reminder bell opens its inbox.

## What works

- Schedule a one-time reminder for an unfinished task, with a local date/time and IANA timezone. A new reminder replaces only your own scheduled reminders for that task.
- Create a recurring series from any task, including a completed template: daily, weekdays, weekly or monthly, every 1–12 intervals, with first occurrence, wall time, timezone and optional end date.
- Each occurrence creates a separate **To do** task. It copies the source task’s current title, priority, applicant, project, goals, legacy assignee display and valid staff assignments. Your source task and completed history stay intact. The person creating the series receives the occurrence reminder; assigning teammates does not silently enroll them in reminders.
- Pause, resume or cancel a series. These controls affect future generation, not already-created work. To change its cadence, cancel the old series and create a new one. One active/paused series per source task per member prevents double-click duplicates.
- After downtime, create only the latest due occurrence and skip earlier missed dates. No flood of backdated tasks. Its due date retains the scheduled local day, and its reminder becomes due on catch-up.
- Monthly schedules keep their original day anchor (31 Jan → 28/29 Feb → 31 Mar). Weekday intervals skip weekends. On a spring DST gap, recurring times shift to the first valid local minute after the requested time; repeated fall times produce one occurrence per day. One-time reminders reject unavailable local times so the user can choose another.
- Personal, company-scoped preferences: enable/pause nudges, timezone, quiet hours (default 22:00–08:00), daily nudge cap (1–20; default 5), and optional repeat after 1/4/24 hours. Automatic repeat is off by default. Quiet hours and limits affect nudges, not task generation/deadlines or visibility of saved reminders.
- Snooze a reminder for 15 min, 1h, 4h or 24h; dismiss a reminder while keeping the task open; or explicitly finish the task. Finishing through any app surface stops scheduled reminders using the existing database trigger.
- Inbox and latest 30 reminder-event history. “Follow-up prepared” means recorded inside Humeto, not sent externally. The header badge respects prepared nudges, muted preferences and quiet hours.
- Assign a responsible team directly from project cards in **Projects & progress**, using the same stable member IDs, scope and stale-write checks as task/applicant/application assignments. Project membership does not automatically replace task responsibility.

## Run locally

Apply migrations with `npm run db:migrate`, then run:

```sh
npm run tasks:worker
```

The dedicated worker polls every 10 seconds using the configured PostgreSQL database. A PostgreSQL advisory-lock connection admits one worker; losing that connection terminates it. Put it under process supervision for deployment. Database access uses the existing cached pool. Logs contain aggregate counts, not task bodies.

The scheduler works while the browser is closed: task occurrences and follow-up records persist in PostgreSQL. Reopen Humeto to see them. **It does not deliver OS/device push, email or WhatsApp notifications.** Focus-companion browser alerts remain a separate opt-in, open-app feature.

## Integrity and permissions

Schedules, preference writes, reminder actions and histories are scoped to the authenticated company/member. Students and platform admins cannot use them. Active/trial/grace entitlement and a current staff membership are required both for API writes and background work. Read-only workspaces retain reads.

Unique series/day occurrence claims and transactions prevent duplicate task creation across retries or overlapping ticks. Member-row locking serializes nudge decisions so caps remain correct. Reminder lifecycle changes increment revisions, including changes from the existing assistant and completion triggers. Stale snooze, series, preferences and task-completion actions fail before changing records. Existing assistant reminders feed the same scheduler; cancelling/replacing them stops their eligibility.

Each cycle handles up to 100 eligible reminders per member. API panels return up to 100 scheduled reminders and series, with the latest 30 reminder events. Older rows remain in PostgreSQL; pagination and larger-scale scheduling need follow-up work. Series snapshots read the source at generation time, not at configuration time.

## Verification and remaining work

Release checks cover calendar anchors, weekdays/DST, quiet hours, daily caps/cooldown, catch-up, concurrent/repeated generation, inherited project/goal/staff links, snooze, completion, personal/tenant boundaries, stale preferences and series, inactive subscriptions, UI schedule creation, project assignment and narrow-screen overflow. All 95 compiled-release tests passed for this delivery.

Still pending: holiday calendars, bulk recurrence exceptions, notification digests, cross-device read/acknowledgment, native push/closed-app OS delivery, channel delivery, voice, stronger handwritten/strike-through notebook recognition, private journals and external calendar/task sync. Production Vercel runs the web app; the persistent task worker needs an always-running Node host alongside the other workers. No paid service or external account was connected.

## Editing a series and skipping one day

**Edit future occurrences** changes frequency, interval, next date, local time/timezone and optional end date. Choose a future occurrence, after every generated/skipped day. The chosen next date becomes the new monthly anchor. Existing tasks, assignments, reminders and completion history are preserved; a paused series stays paused. Stale edits are rejected under the same series lock used by the worker.

To omit one occurrence, review the displayed scheduled date/timezone, select **I want to skip…**, then **Confirm skip occurrence**. A permanent series/day claim with no task prevents that day from being generated later. The schedule advances using its existing calendar anchor. Skipping the last allowed occurrence ends the series. Generated-task counts exclude skipped days. This does not delete or cancel an already-created task. When a series is overdue, this skips the displayed next scheduled day only; later overdue catch-up remains governed by the existing latest-only rule.

**Schedule change history** retains the latest 50 edits, skips and state changes for the member, with previous/next scheduled day. Changes remain in PostgreSQL beyond this display limit. Arbitrary holiday calendars, bulk exceptions and changes to historical generated tasks remain future work.
