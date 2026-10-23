# Latest Android build: 0.2.4 (version code 6)

Hold the task grip to drag between board stages or priority quadrants; edge scrolling and cancellation are supported. Plans opens Projects, Goals and Routines as peer sections with one Add menu; Assistant is renamed Chat. Focus has one task selector, Start/Pause/Stop, hold-or-confirm completion, compact break/reset panels and recent history. Tasks use an eye icon for the overview and a due-date calendar. The same backend/authentication/database remain in use. See [task interaction notes](TASK_PLANNING.md). Android emulator: 26 checks passed; both builds and focused web/mobile UI checks pass. Earlier release counts below are historical.

# Humeto mobile testing build · 2026-10-23

The mobile client is a separate React 19 / TypeScript interface bundled with Vite 8 into Capacitor 8.5.3 Android and iOS projects. It shares the existing Next.js backend, Neon PostgreSQL database, cookie sessions, user accounts, trials, vouchers, permissions and task records. CRM screens are outside this first mobile release.

## Delivered

Today dashboard; compact priority quadrants, board and list; task creation/editing/completion, dates, assignees, team links, projects/goals, focus timer and check-ins, recurrence controls, reminders and assistant reviews. The live assistant model remains pinned server-side to GPT-5.4 mini. Device reminders use opt-in native local notifications. Data refreshes on app resume and every 30 seconds while visible; edits refresh immediately. No offline writes or remote push transport is claimed.

`GET /api/mobile` authenticates the same session cookie and returns only the authorized task workspace payload. Mobile uses Capacitor native HTTP and platform cookie jars, without relaxing web CORS/CSRF checks or exposing session tokens through app storage. TLS-only production networking is fixed to www.humeto.com. Android backups are disabled. Reused task PATCH supports validated title, date and assignee edits with optimistic revisions, tenant validation and completion triggers.

## Validation

- Mobile TypeScript/Vite build and Next.js build passed.
- 141 release checks passed with fictional data in disposable PostgreSQL.
- New mobile UI test exercised shared session auth, task-only data, create/sync/complete, assistant proposal/cancel, goals navigation and narrow-screen overflow.
- 20 native Android acceptance checks passed on the Pixel 6 / Android 14 (API 34) emulator using disposable local PostgreSQL and a separate QA package. Checks cover login/session persistence, task edits and assignments, projects/goals, recurrence, focus completion/history, reviewed assistant Apply/cancel/replay safety, native notification delivery, 100-task bounded layout, tenant isolation, expired read-only access, logout and signup/reset. A live GPT-5.4 mini request also passed.
- Fixed focus completion to send the task revision, blocked duplicate rapid submissions and prevented older refreshes from overwriting newer state.
- Android Gradle assembleDebug succeeded and the APK installed/launched in an Android emulator. The native HTTPS client reached production and received the expected authenticated-route 401 while signed out. APK v2 signature verified.
- iOS source/SPM project generated. iPhone work deferred at user request; no IPA, archive or signed iPhone binary built.

## Testing

`mobile/releases/Humeto-0.2.4-testing.apk` is a debug-signed APK for sideload testing, not a signed Play Store release. Build products and signing material stay outside Git. See [mobile README](../mobile/README.md) for builds. Use your regular workspace account. Platform-admin-only accounts do not manage tasks through this client; workspace owners, individuals (owner role) and consultants retain existing task permissions. Verification and password-reset emails use current web flows, after which users sign in on mobile.

## Remaining before store release

Physical-device acceptance testing; production release signing/version policy; offline sync design; APNs/FCM remote push and device registration; mobile notebook capture; server-worker hosting for future recurrence generation. Local reminders may remain stale until next sync if tasks change elsewhere while the app stays closed. Native sessions currently match web: 12 hours. Android notifications may be delayed by OS scheduling. iOS testing requires full Xcode and Apple signing when resumed.

## Focus selection and task categories · 2026-10-23

Today’s “Your next small win” uses the same active focus task as the Focus screen, including current task-title edits. A searchable picker starts or switches focus from Today, Focus or task details. Switching uses the existing atomic focus endpoint: prior time remains in history, the previous task stays unfinished and the next task revision is validated.

Task creation/editing now accepts a category of up to 60 characters. Suggested categories are Personal, Work, Social, Relationship, Family, Hobby and Financial; users can type their own. Categories persist in PostgreSQL (migration 022), sync with tasks and appear on cards. Filters combine category/uncategorized, today/overdue/no date, assignment, status and search. Cards indicate active focus and overdue tasks. Existing tasks stay uncategorized until edited.

The native acceptance run passed 20 checks, including custom category persistence/filtering and switching away and back while verifying Today’s title and saved session history. This run used the local command assistant; live model connectivity was verified in the preceding Android run.

## 0.2.0 · planning, alerts and routine wording

See [shared task planning](TASK_PLANNING.md) for the current data model, filters, goal/project deadlines, routine types and weekly reporting, expected-impact estimates, reviewed AI wording rotation and notification limits. The same shared components are rendered by web and mobile. Android 0.2.0 (versionCode 2) includes the tilted serif h icon, chime/bell audio channels, vibration/permission diagnostics and projected local routine alerts. 149 release checks and 23 native emulator checks passed, including a live wording-generation request which did not auto-activate suggestions. Physical-device sound/vibration and store signing remain pending.

## 0.2.1 · work sessions and project collaboration

Android versionCode 3 uses the same accounts, backend and database as the website. Includes 30-message assistant history pages; an explicit random focus suggestion; optional transition resets and timed breaks; cumulative work-session totals; separate Mark task complete; background activity/status check-ins; parent teams with task overrides; project client sharing and quarantined uploads; native sharing and private-cache downloads; project/goal/routine financial targets and task context badges; and a compact bird's-eye task view. Project/goal selection state is preserved while editing.

The shared UX audit found no automated WCAG-rule violations across 12 web viewports and five mobile tabs. 156 release checks and 25 Android simulator checks passed; private file downloads and the native notification/permission paths were exercised. Real antivirus scanning still requires the separate ClamAV worker. The test APK is debug-signed, with package `com.humeto.tasks`, and remains a testing build rather than a Play Store release.

Task details now put essentials first, with expandable Team & plans, Reminders & repeat, and Links & activity sections. Financial impact is folded inside the essentials edit form and retains its values when closed. Android testing build 0.2.4 also includes touch drag handles for task stages and priority quadrants.

### Keyboard-safe chat (0.2.5 / Android version code 7)
The chat message list now takes the remaining visible screen height and scrolls independently. The composer stays in the layout above the keyboard, and bottom navigation temporarily hides when the keyboard reduces the viewport. Closing the keyboard restores navigation and preserves the draft. Android explicitly requests window resize for the keyboard; the shared visual-viewport hook also handles mobile browsers. Mobile web chat uses the same viewport behavior while typing. No backend or account changes.

0.2.6 / version code 8: clearer Move grip with 44px touch target; drag to a column or the destination tray that appears above navigation. Priority tray includes all four quadrants. Routine cards now show a compact weekly completion/missed tracker; optional setup and controls are collapsed. Same routine UI and drag behavior are shared with mobile web.

0.2.7 / version code 9 adds whole-card long-press dragging: hold the task body, move and release over a stage/priority destination. Normal tapping and swiping retain their usual behavior. The explicit Move handle is optional.

0.2.8 / version code 10: Plans contains Projects and Goals, with no Routine category or creation menu. Today adds a daily checklist with date navigation and Done/Missed records. Add an ordinary task and choose Repeat: Daily to have separate tasks appear each day. Existing schedules/history remain intact. Web Overview has the same checklist.

Home now contains Today and Calendar views on mobile and web Overview. Calendar has month navigation and status filters for Upcoming, To do, Done and Missed work, with tasks and project/goal deadlines together. Existing dated completion records and repeating schedules are preserved. Calendar is removed from Plans; Projects and Goals remain there.

Validation: web and mobile builds passed; 12 targeted browser/API checks passed, including Calendar Done/Upcoming filters and goal deadline editing. Automated layout/accessibility audit passed across 20 web viewports. Android emulator acceptance passed 27 checks, including Home daily-repeat tracking and Calendar. Physical-device testing remains separate.

0.2.9 / version code 11: project and goal navigation uses stable IDs and clears unrelated task filters. Goal counts/search include tasks inherited through a project's goal, without duplicating explicit links. Project cards show the supported goal; task relation controls explain inherited goals. Same relationship rules apply to the website. Web contributing-task titles now open task detail. Existing historical snapshots are preserved; future completions record inherited goals.
