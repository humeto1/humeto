# Deploy the web application to Vercel

Import `humeto1/humeto`, branch `main`, as a Next.js project. The Git repository root is the Next.js app, so leave Root Directory at the repository root. Use the default `npm run build` command. Use a Node runtime satisfying package.json (Node 22.13+).

Set these server environment variables in Vercel, copying their values privately from local configuration:

- `DATABASE_URL`: Neon pooled production URL.
- `DATABASE_URL_UNPOOLED`: direct URL, needed only by operational migration/backup commands.
- `HUMETO_HTTPS=true`: secure session cookies on HTTPS.
- `HUMETO_LOCAL_DEMO=false`: keep local demo entry disabled publicly.
- `HUMETO_AGENT_PROVIDER=local`: command testing until a live model is configured.

Do not upload `.env`, set `GITHUB_TOKEN` in the app, or expose database URLs through `NEXT_PUBLIC_` variables. Do not set the local PostgreSQL admin or QA URLs in Vercel. Prefer hosting compute close to the database's Ohio region when the Vercel plan permits.

The homepage and database-backed server routes can run on Vercel. Production schema is prepared separately, not by every build. An actual account must be created through registration; demo accounts do not have a shared public password.

## Remaining deployment dependencies

Uploaded documents and OCR artifacts currently use persistent local disk. Vercel's filesystem is not persistent application storage; document uploads/downloads require an object-storage adapter and migration of existing files before those features can work there. Do not point uploads at `/tmp` as a persistence solution.

The OCR, proactive task and WhatsApp workers are separate long-running processes; pushing this repository does not run them on Vercel. Deploy them on a suitable worker host with shared persistent storage or object storage. Gmail and other external integrations need their own OAuth credentials/webhooks. Review tenant access, backups, retention and production authentication configuration before opening the service to customers.

Git push makes the source available for import, and triggers deployment only if the repository has already been connected to Vercel. Vercel dashboard environment variables and build logs are the authority for the deployed result.
