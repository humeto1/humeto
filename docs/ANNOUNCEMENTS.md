# Company announcements and notifications

Open **Notifications** in the workspace navigation. The header megaphone shows unread company announcements; the separate task-reminder bell keeps its existing task function.

Company owners act as company admins and can prepare, preview and publish announcements to everyone, staff/instructors, students or selected people. “Staff / instructors” maps to the existing owner/consultant staff accounts; a distinct coaching/instructor role is not introduced by this delivery. Platform admins cannot inspect or publish private company announcements.

## Admin workflow

1. Enter a title and message, choose the audience, and optionally select people.
2. Choose an existing illustration or no image. Images come from Humeto's bundled assets; custom image upload and external image URLs are not enabled.
3. Set start/expiry dates in your browser's local time. Add an optional button label and internal workspace route, such as `/workspace/documents`.
4. Choose whether to show a pop-up as well as the inbox card. **Preview** opens the illustrated dialog without sending anything or changing read counts.
5. **Save draft**, review its planned audience size and preview in the history, then explicitly **Publish**. Scheduled publications become visible after their start time; expired ones stop appearing. This is database/time-gated and does not need a background delivery worker.
6. **Retract** removes a published announcement from recipient inboxes/pop-up eligibility. Existing open dialogs close on the next refresh. Publication, retraction and draft creation are audited. Published content is immutable; create a new announcement for corrected content.

## Recipient experience

Recipients have a private inbox and unread indicator. Optional pop-ups use a native modal dialog with keyboard focus containment, an Escape/close control, illustration, message and optional action button. At most one automatic pop-up is shown per component visit; dismissal and reads are stored per account in PostgreSQL. Users can reopen messages from their inbox.

Dismissal marks the message read. Browser-session suppression also avoids repeating a just-closed message while acknowledgment is in flight or the network is unavailable; keepalive acknowledgments support navigating through the action button. Read counts report acknowledged in-app reads, not external delivery or proof of attention.

## Scope and safety

- Tenant and recipient checks protect every inbox, acknowledgment, draft and publication operation. Only current company members can be selected. Students and ordinary staff cannot publish or see campaign management/member lists. Active subscription entitlement is required for admin mutations; inbox reads/acknowledgments remain available in read-only accounts.
- Broad audiences are resolved at publish time and frozen into recipient rows. New members do not automatically receive old announcements. Individually selected recipients are prepared at draft time and rechecked for current membership on publication.
- Plain text is rendered as text, not HTML. Buttons accept internal `/workspace/...` routes only; they never bypass the destination route's own permissions. Arbitrary remote images and script/external redirect links are not accepted.
- Current inbox and admin history reads return the latest 100 active announcements/campaigns. Pagination, retention, deletion/export and more advanced priority/frequency preferences remain future work.

## Delivery boundary

This is an **in-app notification and pop-up system**. It polls approximately every 15 seconds while the app is visible and refreshes on returning to the tab. It does not send phone/device push, browser background push, email or WhatsApp messages. Native/browser push delivery and device subscriptions remain a separate deliverable.

Automated checks cover unpublished drafts, role-specific/individual targeting, future/expired announcements, cross-company access, acknowledgment idempotency, read/dismiss counts, retraction, origin/login/subscription guards, preview without sending, mobile dialog layout and dismissal persistence after refresh. Screenshots use disposable fictional accounts; no announcement was published to the main workspace during development.

Validation: compiled build and all 99 isolated PostgreSQL release tests pass, including acknowledgment during action-button navigation. Desktop/mobile pop-up and admin/inbox visuals were inspected using disposable fictional data.
