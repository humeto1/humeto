# Humeto mobile · task management

React 19 + TypeScript + Vite 8 + Capacitor 8.5.3. Android and iOS share this bundled mobile interface. The production API is fixed to `https://www.humeto.com`; this is not a hosted website wrapper.

## Same identity and data

Native Capacitor HTTP calls use the existing Humeto login/session cookies over HTTPS. Cookie storage is handled by the native networking libraries; there are no bearer tokens in localStorage, embedded passwords, database credentials or AI keys. Sessions retain the web app's 12-hour lifetime. Email verification, reset links, trials, vouchers, workspace roles and feature checks reuse existing backend controls. Logout revokes the server session and cancels local notifications. Android backup is disabled.

`GET /api/mobile` returns a task-only authenticated workspace payload. No applicant documents, CRM lead records or financial records are included. New mobile task edits go through the same optimistic revision checks and tenant boundaries as web.

## Included

- Individual/company signup, shared login and email password reset; email verification takes place through the emailed web link.
- Today, Tasks (priority, board, list), Focus, Assistant, Projects & goals.
- Create/edit task titles, custom categories, due dates, workflow stages, priorities and assignee; team assignments and project/goal links. Combine category, due-date, assignment, status and search filters.
- Select/switch focus from Today, Focus or task details. Today always displays the active focus task; switching saves the previous session time without completing its task.
- Server-backed focus timer, pause/resume, extensions, blockers and completion history.
- Reviewed assistant actions; the configured model runs on the server only.
- Reminders, snooze/dismiss and recurring series; future series generation requires the existing server scheduler worker.
- Local device notifications after opt-in. They sync only while the app is open/resumed, and Android delivery may be delayed by OS scheduling. Remote push and offline writes are not implemented. Sessions/timers reconcile with the server on resume.
- Existing workspace stage configuration is respected; owners edit pipeline definitions in the web app for this first mobile version.

## Build

Requires Node 22+, Java 21, Android SDK 36; iOS requires macOS, full Xcode 26+ and signing.

```sh
npm ci
npm run build
npx cap sync
cd android
./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. This is a debug-signed testing APK, not a Play Store release. Use the same development signing key for updates; do not commit keystores.

For browser development: `npm run dev`. For the production bundle preview: `npx vite preview --host 127.0.0.1 --port 4180`. The browser preview proxies `/api` to the local backend at `http://127.0.0.1:4173` by default. `HUMETO_MOBILE_DEV_API` can select an isolated QA backend; production native builds always use the fixed HTTPS production server. Never put secrets in `VITE_*` variables.

## iPhone testing

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

In Xcode select the App target, your signing team and connected iPhone, then Run. For TestFlight choose a paid Apple Developer team, create the app identifier `com.humeto.tasks`, archive and distribute through App Store Connect. An unsigned ZIP cannot be installed on an iPhone. No IPA has been compiled or signed on the current Mac because full Xcode is absent.

Native projects and dependency locks are checked in. Build products, `.env*`, machine paths and signing material are ignored. See the root `docs/MOBILE_APP.md` for validation and limits.

## Android acceptance tests

From the repository root, run `npm run test:android` after the Next.js build. It creates a disposable local PostgreSQL database, builds a separate `com.humeto.tasks.qa` package, and drives a native Android emulator WebView. Test email is captured locally. Production account data is not used. Set `HUMETO_ANDROID_LIVE_AI=1` to include one real server-side model request using fictional task data.

The QA build alone allows HTTP to the emulator host `10.0.2.2`; normal builds retain the fixed HTTPS production API and disallow cleartext. The runner restores production assets and rebuilds the normal APK in its cleanup. Logs/screenshots are ignored under `.data/android-acceptance/`. A failed fixture is retained locally for investigation; successful fixtures are dropped.

The October 23 run passed 20 native checks on Android 14 / API 34, including delivered device notifications and a 100-task view. Physical devices and other Android versions still need acceptance testing.
