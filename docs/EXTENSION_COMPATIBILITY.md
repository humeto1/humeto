# Humeto Assist 0.4 — form compatibility

This increment extends the existing scoped, reviewed Chrome extension. It does not add remote model calls or broader host permissions.

## New support

- **Split dates:** day/month/year inputs, `bday-day/month/year` autocomplete and clearly labelled birth/passport date groups. Only valid ISO saved dates are transformed. Native select month labels such as September/Sep or unambiguous numeric labels can match even when their underlying values use another numbering scheme. The panel shows the exact value before filling. Ambiguous/invalid source dates or options stay manual.
- **Family and reference context:** unique records can match when the field context and saved relationship agree. Spouse/sibling/guardian/emergency contexts are supported when explicitly present. A generic Parent record cannot identify a mother or father. Academic/professional referee context can narrow reference records. Duplicate matches abstain; identity values do not substitute for related people.
- **Embedded controls:** visible same-origin frames (including nested frames) and open shadow roots are scanned. Frame/outer fieldset context is retained so a mother/spouse group cannot silently become an applicant field. Review rows identify where the field lives.
- **Complex-form boundaries:** inaccessible cross-origin/sandboxed frames and custom ARIA combobox/rich-text controls are reported for manual handling. Closed shadow roots are inaccessible. The scan is bounded to six nesting levels, 80 roots and 500 supported controls.
- **Changed-page guards:** dropdown option changes, detached/replaced inputs, changed context/labels/autocomplete/types, changed document URLs and existing answers are rejected. Native setters/events use the control's own window. File inputs also retain document/context guards and appear with frame locations.

## Try it

1. Download `/humeto-assist.zip` from Workspace Settings and unzip it.
2. Load the unpacked folder in Chrome's extension developer mode, or reload an existing unpacked installation after replacing the files. Check version **0.4.0**.
3. Create a one-hour pairing in Humeto Settings for one fictional applicant and only the sections/documents you intend to share.
4. Open `/test-application-advanced.html`. Pair, scan, review the exact values, and fill selected empty controls. The practice page includes split dates, spouse/referee fields, a native embedded form, shadow-root input and a manual custom control.
5. Verify the portal's final values yourself. Humeto never clicks Next/Submit, signs declarations or supplies credentials/payment details.

The practice form is public local demo content; do not use real applicant data in shared screenshots. The source-controlled extension package contains no tokens. Pairing tokens remain in extension session storage and are never injected into page scripts.

## Verification and remaining work

Validation: optimized Next.js build and **103 PostgreSQL release checks pass**. An unpacked Chromium extension also reviewed and filled all 12 fictional practice fields, including the frame contact, without submission. The shipped practice portal has a regression check under the app’s DENY framing policy.

Tests cover date transformations/invalid dates, repeated-record ambiguity, relationship separation, native frame/shadow filling, inherited mother context, inaccessible frames/custom widgets, stale iframe documents, changed dropdown options, preservation of answers and no automatic submission. The existing packaged-extension Chromium checks also cover pairing review and file assistance.

This is broader compatibility, not a claim that every university/visa/job/scholarship portal is supported. Real portal benchmarking, explicit cross-origin frame permissions, custom-widget adapters, non-English month labels, full text-date format variants and quiet cross-page sessions remain pending. Model conversation is still a separate future connection.
