# Separate child-safety roadmap — not part of the 18+ release

The owner selected adults 18+ for the initial release. Do not label the current
product “safe for kids”, “COPPA compliant/certified”, or Families approved.
An adult-only account policy does not eliminate duties for minor applicant records
uploaded by adult organisations or for users whose age becomes known.

## Before considering teens or children

- [ ] Choose actual age bands and release countries. Teen requirements and under-13 parental-consent rules are not identical; local thresholds differ.
- [ ] Obtain a qualified review of applicable privacy/online-safety laws and the amended COPPA rule where applicable.
- [ ] Separate age-appropriate product surfaces, permissions and store declarations; use an appropriate neutral age screen and server-side enforcement across web, Android, invitations and guest links.
- [ ] Prevent child/unknown-age users from entering global anonymous Break chat. Do not merely rename the room or hide a tab while leaving its API accessible.
- [ ] Restrict project invitations, file/voice exchange and freeform sharing; implement adult-managed controls and required adult action before child personal information can be exchanged.
- [ ] Obtain verifiable parental consent before covered collection, with parental review/deletion/revocation rights, unless a documented legal exception applies. An ordinary email-verification link is not automatically sufficient parental verification.
- [ ] Minimise child data and identifiers; no behavioural advertising or unnecessary tracking. Audit every SDK, host and AI provider for permitted child-directed use.
- [ ] Apply age-appropriate AI safeguards, content filtering, in-app reporting and human escalation; test sexual content, grooming, self-harm encouragement and multilingual bypasses.
- [ ] Publish child-specific notices and concrete retention/deletion schedules. Test deletion from active systems, providers and backups.
- [ ] Staff moderation, safeguarding contacts and legally required child-exploitation reporting; document escalation, preservation duties and incident response.
- [ ] Review notifications, persuasive engagement, default visibility and privacy from the child's perspective.
- [ ] Conduct a documented privacy/safety assessment and independent security/abuse testing.
- [ ] Complete Google Target Audience/Families/content-rating/SDK declarations against the restricted build; submit only after all applicable gates pass.

Google requires additional safeguards for child audiences with social features;
services centred on anonymous/stranger chat must not target children. Humeto's
existing anonymous room is therefore a significant redesign issue, not something
an “18+” checkbox can make child-safe.

Sources: [Google Families](https://support.google.com/googleplay/android-developer/answer/9893335),
[Child Safety Standards scope](https://support.google.com/googleplay/android-developer/answer/14747720),
[FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).
