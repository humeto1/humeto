# Superadmin portal

Platform administration appears above My workspace in the sidebar. Overview shows workspace access status, activation requests and shortcuts. Workspaces & plans provides search, status filtering and the existing subscription controls. Access vouchers and Break chat moderation each have a dedicated section, rather than appearing as long forms at the top of the landing page.

The same superadmin account can open its own CRM workspace. A session context switch uses the original tenant membership: platform mode retains `platform_admin`, while My workspace exposes that tenant as its owner. The database membership is not changed. Other customer tenants cannot be selected through this endpoint. Returning to platform mode restores the console. Every context-navigation action verifies the context on the server, including when another browser tab changed it. The current mode is shown clearly and platform navigation stays above CRM navigation.

Context selection is per signed-in session/device, defaults to Platform admin after sign-in, requires a current platform membership and a same-origin POST, and accepts no target tenant or role parameter. Ordinary workspace members and students cannot use it. Workspace access, feature allowances, subscriptions and existing owner permissions continue to apply in My workspace. Platform access does not grant a route into customer CRM records.

Migration 036 adds the session context column. Desktop and narrow-screen tests cover switching, tenant isolation, membership preservation, separate sessions, vouchers/moderation navigation and accessibility. Existing normal workspace/mobile authentication stays compatible; this release changes the web administration portal and needs no Android package change.

Verification: compiled release suite passed 193 tests. Eight admin portal desktop/phone section audits found no accessibility violations. Own-workspace checks include task edits, assigning the superadmin account, recurring-task generation, separate sessions and preserved original membership. The session migration was rehearsed on an isolated Neon branch before production application.
