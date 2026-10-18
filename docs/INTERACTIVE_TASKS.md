# Interactive task companion

Open **Tasks to-do**. The Focus companion sits above the board and works with local commands; it does not need an AI API key.

## The experience

1. Choose one task. Up to three suggestions explain importance, urgency, deadline and project. The complete unfinished-task selector remains available.
2. Set an expected time (1–720 minutes) and begin. The task moves to In progress. Other tasks are hidden until you choose to reveal them. There is one active timer per member, stored in PostgreSQL.
3. At the chosen time, the open app asks **How is it going?** It offers completion, continuing for another interval, pausing, progress reporting or dealing with a blocker. The timer records actual time rather than marking a task done when its estimate expires.
4. Talk through the task. Try **50% done, need 15 more minutes**, **pause**, **resume**, **I’m blocked waiting for a reply**, **my next step is check the passport**, or **what should I do next?** Humeto displays a proposal; use **Apply this update** to change anything. A completion proposal requires **Confirm task complete**. Unrecognized statements can be saved as notes; unsupported questions receive guidance. This is bounded local intent matching, not a general language model.
5. Save a percentage and one small next step directly, or select a blocker: waiting on someone, unclear starting point, overwhelmed or other. Guidance changes accordingly. A blocker stops the timer and keeps the task open.
6. **Save & switch task** atomically ends the previous session and starts the selected one. Its time, notes and progress remain intact. Returning to an unfinished task restores that member’s latest progress and next step. Progress from one task is never copied to a different task; a previously completed session is not restored when a task has been reopened.
7. **Finished** marks the task Done and saves the session. Completion through another app surface also stops active timers via the existing database trigger. Projects & progress remains the place for project/goal completion reporting.
8. Open **Time history** to revisit completed/stopped sessions and their saved updates. Reads currently return 50 sessions and the latest 100 events; the active conversation displays the latest eight meaningful events. Older data stays in the database; pagination is future work.

## Check-in alerts

Browser alerts are optional and requested only when the user presses **Enable check-in alerts**. A generic notification avoids exposing the task title on the desktop. The local preference and last-alert marker are scoped to company/member, and the same check-in is not announced again on refresh in the same browser. The on-page check-in remains available if permission is denied or the browser lacks support.

These are open-app browser notifications, not durable device push. Closing Humeto does not schedule a new OS notification. Cross-device deduplication, quiet hours, a closed-app scheduler and Capacitor push are still pending. The timer itself is durable; reopening the app shows a missed check-in and elapsed time.

## Permissions and integrity

- Staff only; active/trial/grace subscription required for changes. Read-only workspaces can view saved sessions.
- Tenant/user predicates protect every session and conversation; no colleague can change another member’s session.
- Membership-row locking and the one-active-session constraint serialize starts/switches. Session/task revisions reject stale actions. A stale/foreign/completed switch target is rejected before the existing timer ends.
- Previewing a message does not mutate tasks, timers or conversations. The applied event saves the user note and local assistant response.
- A progress update does not move an overdue check-in. Reporting 100% does not mark Done. Only an explicit completion action does that.
- No external messages, model calls, payments or reminders are sent by this feature.

## Verification

The compiled build and all 90 release tests pass. Release checks cover the existing timer flow and new command previews, questions/negation, range validation, progress persistence, overdue check-in preservation, atomic switching, return-to-task context, tenant isolation, stale/concurrent updates, conversation refresh, optional browser-alert deduplication, completion and narrow-screen layout. Browser notifications are stubbed in automated tests; no OS notification is sent by tests.

## Remaining task features

Recurring tasks and durable in-app follow-ups are now delivered; see [Task scheduling](TASK_SCHEDULING.md). Notebook-photo task recognition/reconciliation, closed-app device push, voice, WhatsApp task commands and broader model conversation remain separate deliverables. The company WhatsApp connector does not yet execute task commands.
