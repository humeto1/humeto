# Focus notification, saved login and goal timeframes

Android 0.2.18 (build 20).

## Focus notification

The active session uses a silent low-importance Android notification channel.
Android SystemUI renders the countdown, so reading a PDF or backgrounding the
WebView does not freeze it. The notification drawer shows remaining time and the
task title; the status bar shows the Humeto notification icon (numeric status-bar
presentation depends on Android/the device). Tapping opens Focus on both warm
and cold app launches. Pauses show a static countdown; breaks use their own end
instant. Stop/completion/logout removes the active notification. It expires at
the check-in deadline on Android 8+, rather than showing negative time; the
existing optional focus reminder policy is separate and unchanged. Reaching a
check-in never completes a task. Server deadlines are mapped to device time so
clock differences do not shift the countdown. The last remaining-time snapshot
contains only the session ID and timing counters, and survives app restarts.

This is a local notification, not a foreground service or remote push. A session
changed on another device reconciles when this client refreshes. Force-stop and
OS notification permissions still apply; no background JavaScript polling is
required for the displayed countdown.

## Saved login

Keep me signed in defaults on in Android and web, with a 30-day session. Without
it the session remains 12 hours. Android stores the session token encrypted with
AES-GCM using an Android Keystore key, in app-private preferences excluded from
backup. Passwords are never stored. Browser login uses the HttpOnly cookie and
does not return a token; the native login opts in to receiving a session token.
Native authenticated requests carry that token, including project downloads.
A native superadmin sign-in starts in its own original workspace context, without
changing membership or selecting another tenant; web sign-in retains platform
context and the existing admin/workspace switch.
Logout first revokes that server session, then clears the encrypted token and
notifications. Expired/revoked sessions require login again. Password reset keeps
its existing session-revocation behavior. This does not bypass workspace roles,
subscription controls, same-origin checks, or tenant boundaries.

iOS testing remains deferred; its existing cookie login is retained.

## Goal timeframes

Goal creation/editing offers 30/90/180/365-day presets, a custom number of days,
and a target date. These are calendar days, calculated in the client's local
calendar. Existing goal cards show time remaining, target-day or overdue status.
Days, duration & milestones includes elapsed/target duration and Extend +30/+90
actions. Extension keeps the same goal and task links, adding from the current
future target or today if overdue. New goal cycle opens a reviewed creation form
and creates a separate goal; it never resets, completes, deletes, or transfers
old tasks/history. Completed goals retain their recorded end time. Ongoing
projects still have optional deadlines. Legacy goals lacking dates are shown
honestly and can receive a timeframe.
