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

`mobile/releases/Humeto-0.1.0-testing.apk` is a debug-signed APK for sideload testing, not a signed Play Store release. Build products and signing material stay outside Git. See [mobile README](../mobile/README.md) for builds. Use your regular workspace account. Platform-admin-only accounts do not manage tasks through this client; workspace owners, individuals (owner role) and consultants retain existing task permissions. Verification and password-reset emails use current web flows, after which users sign in on mobile.

## Remaining before store release

Physical-device acceptance testing; production release signing/version policy; offline sync design; APNs/FCM remote push and device registration; mobile notebook capture; server-worker hosting for future recurrence generation. Local reminders may remain stale until next sync if tasks change elsewhere while the app stays closed. Native sessions currently match web: 12 hours. Android notifications may be delayed by OS scheduling. iOS testing requires full Xcode and Apple signing when resumed.
