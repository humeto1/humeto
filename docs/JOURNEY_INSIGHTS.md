# Journey insights and structured deadlines

**Journey insights** is a staff-only workspace page covering leads, applicants and applications separately. Filter by journey, stage, destination, name/institution/intake and overdue deadlines. Sort by nearest deadline, longest observed stage or fee/commission value. Choose an attention threshold (1–365 days) to highlight cases worth reviewing. This threshold is a personal view setting, not an SLA or automatic stage change.

## Deadlines

Each lead, applicant and application can have its own labelled due date and IANA timezone. Due dates run through the end of that local calendar day; overdue counts use that timezone, not the web server's date. Save or clear through the case card. Concurrent deadline or case-stage changes reject stale saves. Clearing preserves the revision so an older tab cannot reintroduce an obsolete deadline. Writable staff may save deadlines; read-only subscriptions may view them. Students and platform admins do not have access.

Deadlines currently inform this report. They do not send an email/device notification, submit a form, close a case or move another journey. Clear deadlines that have been fulfilled. There is one current structured deadline per record; multiple milestones and stage-specific SLA policies remain future work.

## Stage observations

Migration `014-journey-insights.sql` starts a baseline observation for existing records. Their true stage-entry time is unknown, so the report explicitly shows **At least** the observed duration. New inserts and every actual stage transition create visits through database triggers. Board drag/drop, configured-stage redirects, reviewed email updates and local agent commands therefore share the same timing record. Unrelated edits do not create visits.

Completed visits with a recorded start contribute to average elapsed stage days. Baseline visits are excluded from averages. Re-entering a stage creates another visit; it does not replace history. These are calendar-time observations, not business-day calculations, throughput predictions or embassy/university turnaround promises. The current report includes all recorded visits; period selection, medians, exports and large-history pagination remain future work.

## Commercial meaning

- Unregistered leads show expected fee potential and contingent incentive. Registered leads do not repeat their linked applicant fee.
- Applicants show agreed client fees, net receipts after refunds and the remaining agreed amount, consistent with the existing case indicators.
- Applications show their own recorded earned commission, without repeating their applicant's fee on every application.

All amounts currently use PKR. These sorting indicators are not a P&L, invoice balance or forecast of employee profit. Use Finance for ledger statements, invoice credits/allocations and employee costs. No contingent incentive becomes earned income through this report.

## Verification

Validated in the optimized local build and 119-check PostgreSQL release suite, including browser interaction and narrow-screen checks. See [delivery record](DELIVERY_2026-10-19.md) for the combined validation and restore drill.
