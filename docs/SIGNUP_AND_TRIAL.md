# Signup, authentication, email and trials

Public routes: `/signup`, `/login`, `/verify-email`, `/forgot-password`, `/reset-password` and `/unsubscribe`. The homepage links to signup. Set `HUMETO_SIGNUP_ENABLED=false` to pause registration without disabling signin.

## Identity and account creation

Next.js owns authentication, using Neon PostgreSQL for users, salted scrypt password hashes, hashed opaque session tokens and email-token hashes. Existing identities and admin email addresses are preserved. This does not migrate to the separate Managed Neon Auth service.

Signup offers Individual (one seat / one case) or Company (five seats / 100 cases); company name is required for Company. Registration creates an isolated workspace with its creator as owner. Extra role parameters cannot grant platform-admin privileges. Limits remain configurable by a platform administrator.

New accounts must verify their email before signin. They remain pending until verification. The trial starts at verification and ends exactly 15 days later. Existing accounts are grandfathered for verification requirements; no existing admin is blocked or renamed. Migration 016 backfills a one-time expiry only for legacy trial rows with no end date. Paid subscriptions are preserved.

## Signin and recovery

Sessions last 12 hours. Cookies are HTTP-only, SameSite=Lax and Secure on Vercel or when HUMETO_HTTPS=true. Logout revokes the server session. Failed signins and signup/email requests have persistent rate limits. Auth mutations validate origin.

Verification links expire in 24 hours; password reset links expire in one hour. Tokens are cryptographically random, stored as hashes and consumed transactionally through POST. Visiting a link alone does not consume it, avoiding accidental activation by email scanners. A password reset invalidates all reset links and existing sessions for that user. Recovery responses do not reveal whether an email is registered.

## Email configuration

Configure server-only `RESEND_API_KEY`, `HUMETO_EMAIL_FROM` (a verified sender with display name Humeto) and `HUMETO_PUBLIC_APP_URL=https://www.humeto.com`. The sender domain is not presented in website copy. Mail clients can still display the underlying From address.

Signup fails safely if email delivery is unconfigured. If delivery fails after creation, the account remains pending and can request a new verification message. Delivery acceptance is not a guarantee of inbox arrival. Emails are sent through Resend with idempotency keys. No provider key is sent to the browser or committed.

Regression tests capture email only when both HUMETO_ISOLATED_QA=true and HUMETO_EMAIL_MODE=capture. This mode cannot activate through a public request. Capture artifacts are private and disposable; real deliveries are not made during tests.

## Trial expiry and upgrade

Expired users can sign in and read existing information; writes, document reading, inquiry capture and scheduled task mutations use shared entitlement checks. Data is not erased and there are no automatic charges. Owners can request activation even when expired. Requests are saved once per workspace, displayed to platform admins and resolved by manual activation. Alfa checkout is not integrated yet.

## Unsubscribe

Settings provides account-level preferences for optional reminders and product news. Marketing defaults off. Optional sends honor stored preferences and include an unsubscribe footer plus RFC 8058 one-click headers. The public unsubscribe page asks for confirmation; GET never changes preferences. Possession of the opaque token permits the one-click POST; repeated requests are safe. Existing valid unsubscribe links remain usable. Signing back in does not automatically resubscribe anyone.

Essential verification/password recovery emails are separate from marketing opt-outs. This increment does not turn in-app announcements or CRM drafts into bulk email sends. Future optional senders must use the shared email-delivery module to inherit suppression checks.

## Pending

Social login, MFA, bounce/complaint webhooks, proactive trial reminder campaigns and payment checkout remain separate work. Configure the live email variables before relying on public signup.
