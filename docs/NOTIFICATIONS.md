# Quiet notification policy

Web and Android use the same server-generated delivery plan. Merely placing a task in a quadrant does not create an alarm. A timed repeating occurrence or automatic reminder makes it eligible for a nudge; an explicit reminder is a separate deliberate request.

| Priority | Automatic behavior |
| --- | --- |
| Important and urgent | One short selected tone and optional vibration |
| Urgent, not important | Gentle vibration, no channel sound |
| Important, not urgent | Gentle vibration at its scheduled time |
| Neither | In-app only |

At most three automatic nudge groups are planned per account-local day, with at most one audible group. Account settings can lower the daily cap. Automatic events arriving in the same minute are combined; explicitly timed reminders are never grouped. Already overdue automatic events form at most one catch-up group/day. Missed explicit reminders older than a minute remain in-app rather than producing a burst on reopening; already scheduled native alarms still fire at their requested time. Stable occurrence keys prevent the projected repeating occurrence and its later generated database task from sounding twice.

No automatic repeat interval is offered. Explicit Snooze creates a new deliberate reminder, outside the automatic budget. Existing reminder records remain classified as deliberate because their original intent cannot be reconstructed reliably. New worker-created repeating reminders are marked automatic. Completing, binning, archiving, dismissing, pausing or editing work removes affected future deliveries when the clients next sync.

Quiet hours default to 22:00–08:00 in the account timezone, preserving existing custom hours. Automatic nudges wait until quiet hours end and are grouped then. Deliberately scheduled reminders keep their requested time with a silent banner during quiet hours. Focus check-ins and break endings are optional, off by default, separate from the task nudge budget, and gentle/silent rather than audible.

Settings exposes quiet-hour times, vibration and optional focus alerts on both clients. Browser permission, Android notification channel overrides, device volume, Do Not Disturb and battery/alarm permissions remain controlled by the device. Android's dedicated gentle/quiet channels explicitly have no sound; missing a sound filename is insufficient because Android otherwise supplies its default notification sound.

## Delivery and duplication

A server ledger reserves the daily budget and assigns each delivery to one client device. Native clients can claim future events and schedule up to 60 local alarms. Browsers claim due events only, avoiding a second browser notification for an alarm already owned by the phone. Explicit reminders do not consume the automatic count. Future delivery reservations are released on phone logout. Account/user/feature/expiry permissions are enforced when preparing a plan.

Android local alarms can fire while the app is closed, after synchronization. Browser alerts require an open tab. This is not a remote-push service: changes made on another device cannot recall an already scheduled offline phone alarm until that phone syncs. An owned browser delivery also requires the tab to remain open long enough to display it. No notification is automatically sent just because an account opens the app after missing days of automatic work; old automatic occurrences remain in history.

## Chat

Break chat never produces notifications. Project chat is muted by default and has its own opt-in/mute button. Optional project updates are gentle, no more than once per project per 30 minutes, require the account's notification permission, and are generated while the app is open. Reading a project marks it seen and suppresses alerts for that conversation. Membership revocation, client permissions and project deletion are checked before planning a chat alert. Project updates are separate from automatic task nudges and never use their audible allowance.

## Implementation and verification

Migration 034 adds explicit/automatic reminder origins, optional focus preferences, a delivery ledger and per-project mute preferences. Default automatic budget is three; legacy repeated follow-up intervals are disabled. The account timezone, custom quiet hours and selected tone remain intact.

Focused tests cover all quadrants, daily/sound budgets, grouping, quiet hours, explicit reminders, optional focus, stable occurrence deduplication, cross-device ownership, task completion cancellation, project mute/cooldown/read suppression and tenant isolation. Android acceptance checks native pending/delivered alarms and verifies that gentle channels have no Android sound.
