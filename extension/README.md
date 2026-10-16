# Humeto Assist local alpha

1. Keep the Next.js app running on localhost:4173 (4174 is supported for development).
2. In the app, go to Workspace settings → Create read-only pairing. Choose an applicant. Copy the one-hour token.
3. In Chrome, open chrome://extensions, enable Developer mode, choose Load unpacked and select this extension directory. Alternatively unzip the app's extension download first.
4. Open a university/visa form and click the Humeto Assist toolbar icon. Paste the token in the side panel and pair.
5. Scan the page, review each selected field/value and fill only approved empty fields.

This alpha uses deterministic label/autocomplete matching, not an AI model. Available on arbitrary ordinary HTTP/HTTPS pages after user activation. Browser-protected pages, cross-origin iframes, complex widgets, split dates, automated attachments, declarations and submit actions are outside this version. Existing values are preserved. Every source value is labelled provided, not verified. Test with fictional data on the fixture first.

Tokens are scoped to one applicant and selected profile sections, expire in one hour, are stored in Chrome's session storage, and can be revoked in the app. No token or full profile is injected into a target page. Selected values necessarily become visible to that page when filled. No page content is sent to external AI or analytics. No remote executable code is used.
