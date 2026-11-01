# Humeto Google Play launch checklist

Audit date: 1 November 2026. Release audience selected by owner: **adults 18+**.
Support/privacy contact supplied by owner: **help@humeto.com**.
Legal developer: **Nabeel Khalid**. Play developer display name: **DOTIVATE**.
Account type: **personal**, as stated by the owner; Console verification and registered country remain unconfirmed.
**Decision: NOT ready to upload for production approval.** This is an evidence-based
release gate, not a certification, legal opinion or guarantee of Google approval.

Google Sign-In is optional. The existing email/password login may be used; reviewer
credentials must work. Adding Google OAuth later needs registered client IDs,
Play-signing certificate fingerprints, server token verification and account-linking
security; it is not a substitute for deletion or privacy controls.

## Priority blockers and evidence

| Gate | Current evidence | Remaining action |
|---|---|---|
| Developer identity | Owner supplied legal developer Nabeel Khalid, display name DOTIVATE, personal account and support email | Confirm registered country, Console identity verification, account creation date and applicable regions |
| Audience | Owner selected 18+; new public signup requires explicit adult affirmation and policy acceptance | Recheck every invitation/guest/legacy flow and local age-assurance rules; an unchecked age checkbox is not identity verification. Do not advertise for children |
| Privacy | `/privacy` discloses real account/task/chat/AI/file processing, processors, permissions and retention behaviour | Owner: verify processor contracts/regions/log settings and concrete backup/legal-retention periods; policy and Data safety must agree |
| Deletion initiation | `/delete-account` gives a public email request method; linked inside web/native account settings | **Blocker:** verify mailbox receipt, identity-review ownership and a complete erasure drill across DB, files, provider copies and backups. A link does not erase anything |
| AI safety | AI is a central feature; responses are reviewed before task actions | **Blocker/review:** determine policy coverage; implement in-app offensive-content reporting to a staffed moderation queue where required. Support email alone is not in-app AI reporting |
| Public UGC | Break chat has opt-in rules, pre-publication screening, report/block, bans, platform review and 30-day purge | Verify real moderation staffing, escalation/appeal, legal-response procedure and production purge execution; screening is not a child-safety guarantee |
| Private project UGC | Assigned-team/client permissions, voice cap, image re-encoding and document quarantine exist | **Blocker:** project-message/file reporting, sender blocking or equivalent user safety controls, content removal and consistent terms acceptance need completion/review, including guests |
| Child Safety Standards | App category not yet selected in Console | If classified as Social/Dating or otherwise covered, publish required CSAE standards, implement in-app feedback, reporting/escalation and nominate a child-safety contact. 18+ alone does not exempt a covered app |
| Billing | Native app uses existing workspace entitlements/vouchers and links to web; no Play Billing SDK | **Blocker:** decide paid-feature model/countries. Use compliant Play Billing where required or a reviewed consumption-only route. Audit website links, paid upgrades and voucher sales; regional exceptions require eligibility/enrolment |
| Upload signing | Release config supports a dedicated upload keystore, never debug fallback; unsigned AAB can be inspected | **Blocker:** owner supplies securely backed-up upload signing key/cert; enrol Play App Signing, verify identity and first-upload package name |
| Store configuration | Draft listing in `store/google-play/listing.md` | Real screenshots, icon/feature graphic, support site, IARC questionnaire, ads/permissions declarations, privacy/deletion URLs, reviewer access instructions |
| Testing | Existing broad functional/security/Android tests are useful evidence | Internal testing, physical devices, offline/denied-permission/accessibility/large-screen cases, pre-launch report and closed testing where required; fix issues before production application |

## Upload checklist

### Identity and release ownership

- [ ] Confirm package **com.humeto.tasks** is available and correct for the first listing.
- [x] Record owner-provided developer name Nabeel Khalid, display name DOTIVATE, personal account and help@humeto.com.
- [ ] Confirm registered country and verify these details against Console records; do not infer country from timezone.
- [ ] Verify Play Console identity and organisation information (including D-U-N-S where required for that account).
- [ ] Record who controls Play Console, upload key backups, incident response and moderation.
- [ ] Choose release countries and assess their privacy, age-assurance, consumer and subscription obligations.

### Honest data and privacy declarations

- [x] Replace the obsolete concept-only privacy notice; real accounts, uploads and AI exist.
- [x] State the no-sale/no-rental commitment separately from collection and provider processing.
- [x] Provide public, login-free HTML privacy/terms/deletion pages and account-settings paths.
- [ ] Confirm the published `help@humeto.com` mailbox receives requests and has an assigned responder.
- [ ] Complete `GOOGLE_PLAY_DATA_SAFETY.md` against the final Android build and production configuration.
- [ ] Verify provider retention, cross-border processing, contractual safeguards and production logs.
- [ ] Specify backup expiry, legal-retention categories and request-completion expectations, rather than inventing retention periods.
- [ ] Perform export/correction/deletion drills with fictional users and document retained exceptions.
- [ ] Verify database/files/provider-copy deletion; disabling login is insufficient.
- [ ] Preserve other people's legitimate organisational records only with a documented lawful basis and clear disclosure.
- [ ] Verify user consent/disclosures for microphone, AI context transmission, public chat and optional files at the point of use.
- [ ] Verify legacy/invited/guest policy acceptance, not only new public signup.

### Security and permissions

- [x] HTTPS-only native production endpoint; cleartext allowed only in the separate QA build.
- [x] Hashed server passwords; native remembered tokens encrypted with Android Keystore; no passwords saved in app storage.
- [x] Native bridge logs disabled; no production secret keys belong in the bundle.
- [x] Android backups disabled; FileProvider restricted to the dedicated `humeto-share/` cache directory.
- [x] No contacts, SMS/call-log, advertising-ID or GPS permissions in the audited merged manifest.
- [ ] Verify final release merged manifest and dependency graph; SDK upgrades can add permissions.
- [ ] Keep microphone and notification access optional, contextual and revocable; test denial/revocation.
- [ ] Keep exact alarms optional special access; verify any required declaration and a working inexact fallback. The native countdown itself must not require exact-alarm access.
- [ ] Verify account enumeration/brute-force limits, reset-token expiry/replay, session revocation, tenant isolation and upload bounds on the final build.
- [ ] Verify upload malware scanner operation/signatures and backlog; quarantine must fail closed when scanning is unavailable.
- [ ] Review production DB/storage privileges, external tokens, rotation, encrypted backups, restore tests and incident handling.
- [ ] Scan release source/assets/dependencies for secrets and known vulnerabilities; distinguish scan evidence from a full penetration test.
- [ ] Check private-cache cleanup and temporary share grants; do not expose an entire cache or external-storage tree.

### Adult content and safety

- [x] Owner selected adults 18+ for the initial release; no “safe for kids”, “COPPA certified” or “family approved” claims.
- [x] Public signup requires age/policy affirmation and records the policy version in the existing audit trail.
- [ ] Use accurate Target Audience and IARC answers. Target audience and the generated content rating are different things.
- [ ] Declare user interaction, chat, file sharing and generative AI accurately.
- [ ] Finish AI/project UGC report/block/removal workflows and staff moderation operations.
- [ ] Adopt and publish covered child-exploitation reporting/escalation standards; assess applicable child-safety laws even for adult-only services.
- [ ] Test harmful-content bypasses and appeals, including multilingual abuse and unsafe AI responses.

### Android release and store assets

- [x] Project targets API **36**, matching the checked current new-submission requirement.
- [ ] Build the **release AAB**, not the debug APK on the testing-download website.
- [ ] Verify `debuggable=false`, production host, QA package separation, version code and signing certificate.
- [ ] Assess 64-bit/16 KB compatibility against final packaged native libraries and Play's report; do not infer it from targetSdk alone.
- [ ] Enrol Play App Signing; keep upload-key secrets outside Git and arrange recovery/backups.
- [ ] Decide migration for users of the existing debug-signed APK: a differently signed Play build may require uninstall/reinstall. Cloud data and private cached files are not the same thing.
- [ ] Produce a 512×512 store icon, 1024×500 feature graphic and current real-device screenshots meeting Console requirements. Verify rights and any required AI-asset declaration.
- [ ] Validate app name (30 chars), short description (80) and full description (4,000); do not promise Google Sign-In, offline writes, E2EE or features absent from Android.
- [ ] Supply unrestricted reviewer credentials/instructions that do not depend on inaccessible OTPs, expired trials or the developer being online.
- [ ] Provide release notes and verify support/privacy/deletion links in the uploaded build.
- [ ] Finish all Console app-content declarations, including applicable category-specific declarations.

### Testing and submission

- [ ] Internal testing and Play pre-launch report; resolve crashes, ANRs, accessibility and security findings.
- [ ] Physical phone/tablet testing, not only one emulator; font scaling, edge-to-edge, rotation and background/Doze behaviour.
- [ ] Reinstall/update/sign-out/account-deletion and offline/reconnect tests with disposable data.
- [ ] For affected personal developer accounts created after 13 November 2023: at least 12 opted-in closed testers continuously for 14 days, followed by the production-access application. Do not substitute fake opt-ins for actual testing.
- [ ] Validate reviewer access, production providers, deletion support and moderation while the test is active.
- [ ] Obtain owner sign-off on the final bundle, disclosures, pricing and countries before Console submission.
- [ ] Submit and monitor Console feedback; store approval cannot be guaranteed by this checklist.

## Build commands

From `app/mobile`, using Java 21:

```sh
npm run play:check
npm run android:bundle:unsigned   # review artifact only; never upload as signed release
# Supply HUMETO_UPLOAD_KEYSTORE (absolute path), HUMETO_UPLOAD_STORE_PASSWORD,
# HUMETO_UPLOAD_KEY_ALIAS and HUMETO_UPLOAD_KEY_PASSWORD through secure environment storage.
npm run android:bundle           # refuses missing/debug-key credentials; does not upload
```

`app-release.aab` appears under `mobile/android/app/build/outputs/bundle/release/`.
The preflight report deliberately keeps operational/Console gates blocked until
there is independent evidence; it is not a source-code “compliance certificate”.

## Official sources checked

- [Target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [App bundles and signing](https://developer.android.com/studio/publish/upload-bundle)
- [User data and privacy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Account deletion, including an email request resource](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Families policy](https://support.google.com/googleplay/android-developer/answer/9893335)
- [Child Safety Standards scope](https://support.google.com/googleplay/android-developer/answer/14747720)
- [AI-generated content](https://support.google.com/googleplay/android-developer/answer/13985936)
- [UGC](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Payments](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [FileProvider exposure](https://developer.android.com/privacy-and-security/risks/file-providers)

## Verification from this audit

- Optimised Next.js and mobile production builds passed.
- 200 compiled release checks passed with disposable data; 31 Android emulator checks passed.
- Privacy/terms/deletion pages were checked at phone and desktop widths with no accessibility-rule findings; new signup choices were checked separately.
- Restricted FileProvider successfully opened the native share chooser with a fictional file; the chooser was cancelled without selecting a recipient. Sign-out cache cleanup passed.
- Production npm dependency scans reported zero known vulnerabilities after patching two advisory chains (transitive Zod and follow-redirects). This is not a Maven/full penetration-test certification.
- Known-environment-secret scanning of compiled client text assets found no matches; this is a limited scan, not proof that every possible secret is absent.
- Unsigned release AAB built: debugging/cleartext disabled, no packaged native `.so` libraries, no signing entries. Signing, final-device/pre-launch testing and Console acceptance remain unverified.
- Testing download updated to 0.2.19/build21. It is still a debug-signed testing APK, not the artifact to upload to Google Play.

These checks do not complete or override any unchecked operational/legal/Console gate above.
