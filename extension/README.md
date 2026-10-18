# Humeto Assist local alpha

1. Keep the Next.js app running on localhost:4173 (4174 is supported for development).
2. In the app, go to Workspace settings → Create read-only pairing. Choose an applicant, reusable sections, and separately opt in to document access if needed. Copy the one-hour token.
3. In Chrome, open chrome://extensions, enable Developer mode, choose Load unpacked and select this extension directory. Alternatively unzip the app's extension download first.
4. Open a university/visa form and click the Humeto Assist toolbar icon. Paste the token in the side panel and pair.
5. Scan the page, review each selected field/value and fill only approved empty fields.

This alpha uses deterministic label/autocomplete matching, not an AI model. Available on arbitrary ordinary HTTP/HTTPS pages after user activation. Browser-protected pages, cross-origin iframes, complex widgets, split dates, unapproved attachments, declarations and submit actions are outside this version. Existing values are preserved. Every source value is labelled provided, not verified. Test with fictional data on the fixture first.

Tokens are scoped to one applicant and selected profile sections, expire in one hour, are stored in Chrome's session storage, and can be revoked in the app. No token or full profile is injected into a target page. Selected values necessarily become visible to that page when filled. No page content is sent to external AI or analytics. No remote executable code is used.

## Review without repeated prompts (0.2.0)

Scan once, check the suggested values together, and apply one selected empty-field batch. Summary tabs separate suggestions, fields needing attention and existing answers. Clear selection or select the suggested empty fields; selection spans the tabs and the fill button shows the total. Successful fields leave the active selection. Close the panel to continue manually; this alpha performs no automatic background scanning/filling.

Before filling, Humeto checks that each reviewed control is still the same visible, editable element with unchanged type, label, field-group context and autocomplete. Changed/replaced controls require a fresh scan. Existing answers are never replaced.

Broader reusable sections, local search/help and explicitly approved ordinary file-input attachments are available. Choose a shared file and reviewed page input; existing files and changed versions are protected. Files over 10 MB and custom widgets need manual attachment. Old pairings do not gain file access; create a new pairing and enable it explicitly.

Local OCR and student/staff source assertions now work in the app; paired facts show their review/source state. External-model reading, nested frames, split dates and continuous guided-session assistance remain future work. See [the delivery record](../docs/FEATURE_DELIVERY_2026-10-18.md).

Run `npm run package:extension` in the app directory after editing the extension; it rebuilds `public/humeto-assist.zip` from the current files.
