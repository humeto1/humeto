# Access vouchers and feature controls

Super admins manage access vouchers in the platform console. Workspace owners redeem them under Settings, including when their trial has expired. Staff and students cannot create or redeem vouchers.

Vouchers specify an audience (consultant, lawyer, agency, individual or any), optional owner-email restriction, features (CRM, tasks, form filling), access days, seats, case allowance, storage, redemption start/end and maximum uses. They grant complimentary access; they do not take payment, record revenue or simulate a checkout discount.

Codes are cryptographically generated and shown once. Only a hash and masked hint are stored. Redemption locks the voucher and workspace, checks eligibility and current usage, records an immutable redemption and increments use count atomically. Each workspace can redeem a voucher only once. Attempts are rate-limited. Concurrent requests cannot exceed the maximum uses.

Access days are added after any remaining finite trial/paid period, or from now for expired access. Voucher feature and capacity limits replace the current limits immediately. Codes below current seats/cases/file usage are rejected. Accounts with existing unlimited active access are not replaced. Revoking a code blocks future redemptions; it does not revoke previously granted access. Super admins can separately edit a workspace's subscription.

Business type is selected at company signup; existing workspaces default to consultant, except individual workspaces. Super admins can correct business type and feature selection through Manage plan. Existing features default to all three; existing accounts are not unexpectedly restricted by migration.

Feature checks apply on server routes and extension access as well as navigation. Bootstrap data excludes modules outside the feature grant. Read access on licensed modules is retained when a subscription expires. Scheduled task creation also checks its task entitlement. This is licensing layered over existing role/tenant permissions; vouchers never grant platform-admin privileges.

## Designated super admin

Configure the private server variable `HUMETO_SUPER_ADMIN_EMAIL`. The designated person signs up normally and verifies ownership of the inbox. Only that verified account can receive platform-admin access on verification or a subsequent password-authenticated signin. Merely submitting that email during signup does not grant access. Existing administrators are preserved. The release does not create a password or user for the designated address.

## Verification

Regression tests cover audience/email restrictions, denied owner creation, feature enforcement, expired-trial redemption, one-time redemption, hash-only code storage, global use caps under concurrent requests, future/revoked vouchers, origin restrictions, manual entitlement editing and designated verified-admin promotion.
