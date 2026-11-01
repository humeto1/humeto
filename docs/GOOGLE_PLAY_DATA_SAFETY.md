# Humeto Data safety worksheet — draft, not submitted

Checked 1 November 2026. Audience: adults 18+. **Collection is YES.** “We do not
sell personal data” is the owner's policy commitment; it does not imply no
collection, no recipients, no cloud processing, or no third-party disclosure.

Google's form uses specific definitions and service-provider/user-initiated-sharing
exceptions. Verify actual contracts and optionality before selecting “shared: no”.
The table is an engineering inventory, not a completed Play Console form.

| Information | Evidence and purpose | Expected declaration/review |
|---|---|---|
| Name/email/user and workspace IDs | Signup, authentication, invitations, account support | Personal info: name/email/user IDs; account management/functionality |
| Password hash and session tokens | Server authentication; encrypted remembered native session | Authentication handling; never disclose raw secrets; verify mapping to Console categories |
| Tasks/projects/goals/milestones/notes | Cloud task and planning database | Other user-generated content; functionality; may contain voluntarily supplied sensitive information |
| Completion/focus duration/preferences | Productivity reports, focus sessions, reminder policy | App activity/interactions and other content as applicable; not zero-collection local-only timing |
| AI prompts/history/relevant task context | `src/lib/agent/model.ts` sends context to OpenAI | User content/messages, functionality; review third-party processor qualification and retention |
| Public Break-chat text/reports/aliases | Dedicated cross-workspace tables; OpenAI screening and private account mapping | Messages/user content, safety; public visibility is intentional, identities are not untraceable |
| Project messages | Authorised project members and invited clients | Messages; optional service functionality/user-initiated sharing; review recipient exceptions |
| Voice notes | Optional microphone input uploaded to project conversation | Audio/voice recordings; optional if the feature can be skipped; no claim of local-only processing |
| Image and file uploads | Project media/attachments and optional document tools | Photos and videos/files and docs as applicable; optional; content may itself be sensitive |
| Financial amounts | User-entered task/project profit/loss estimates; broader web CRM ledger | Review other financial info vs purchase history/payment data. Never infer that estimates are card collection or actual payments |
| Notification-device UUID | Duplicate-alert ownership/ledger, not advertising | Review Device or other IDs; app functionality; locally generated is not automatically excluded when transmitted |
| IP/request/security/performance logs | Vercel/other service infrastructure; abuse/authentication records | Confirm provider logs and retention; assess identifiers/diagnostics. No GPS permission does not mean no network metadata |
| Web CRM applicant records | Optional web/browser CRM; identity/education/financial documents can include minors | Identify which paths are in Android scope; assess app-linked web experiences and document-upload contents. Do not declare “no child data ever” |
| Google Fonts requests | Website CSS loads external fonts | Third-party technical requests, including IP; verify provider disclosure/alternatives |

No advertising SDK, advertising-ID permission, contacts/SMS/call-log or GPS
permission was found in the audited Android sources/merged manifest. This is not a
statement about every future SDK or every hosting provider's logs. No dedicated
health-data/Health Connect collection was found; reassess if fitness/medical
features are promoted or structured health information is added.

## Recipients and processing

- Humeto backend: account, workspace content, permissions and service records.
- Vercel/Neon: hosting and database infrastructure.
- Configured Supabase storage: files/documents; local QA storage is different from production.
- OpenAI: live task-assistant context and Break-chat moderation text.
- Resend: configured account/notification emails and recipient address/content.
- Authorised colleagues/clients: content explicitly made available within project/workspace permissions.
- Global Break-chat participants: public-room text and animal alias, not account/workspace identifiers.

Verify enabled production services, regions, subprocessors, retention, training
terms, contracts and provider deletion capabilities. Do not claim “never used for
training”, “no external retention”, “all in Pakistan”, or “end-to-end encrypted”
without evidence.

## Retention and deletion facts

- Bin: 30-day removal; Archive: retained until further user action.
- Break feed: last 24 hours; moderation message/report evidence: scheduled 30-day purge via migration033 and the protected daily task-bin cron.
- Other account/content records: retained for the service; no complete automatic account-erasure engine has been audited.
- Sessions: 12 hours or 30-day remembered login; server logout/reset revokes access.
- Backups, provider copies, operational logs and statutory records: **owner must supply verified periods and lawful exceptions**.
- Account-deletion request: public email path plus in-app settings link. This is initiation only. The operator must verify identity, delete associated personal data, address provider copies, and confirm any retention exceptions; suspension is insufficient.

## Owner sign-off before submitting

- [ ] Actual data types and required/optional status match all enabled app features.
- [ ] Collection purposes, recipient classifications and any sharing exceptions are documented.
- [ ] Encryption-in-transit statement verified across all production upload/download/API paths.
- [ ] Deletion requests can actually be fulfilled, and the external URL works without the app.
- [ ] Service provider/backup/log retention periods are defined and reflected in the public policy.
- [ ] No ads/no-sale statements match commercial contracts as well as code.
- [ ] The final signed bundle contains the same disclosures and behaviour audited here.

Source: [Google's Data safety definitions and form guidance](https://support.google.com/googleplay/android-developer/answer/10787469).
