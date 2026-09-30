# Deployment

[Architecture](ARCHITECTURE.md) · [Operations](OPERATIONS.md)

The frontend runs on Cloudflare Pages, with `/api/*` forwarded to the API Worker through a service binding. The checker, alert, and AI Workers share D1 and the incident/alert queues.

## Local configuration

Use Node 24 and pnpm 10. Copy `.env.example` to the root `.env` and set `VITE_CLERK_PUBLISHABLE_KEY`. Enable Clerk organizations, email/password, and Google sign-in for your instance.

Configure ignored `workers/api/.dev.vars` with:

```dotenv
CLERK_SECRET_KEY=your-clerk-secret
CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key
CLERK_AUTHORIZED_PARTIES=http://localhost:5173
ALLOWED_ORIGIN=http://localhost:5173
SECRET_ENCRYPTION_KEY=your-shared-encryption-key
DEV_AUTH_BYPASS=false
```

The API, checker, and alert Worker must share the same encryption key. Keep it stable; changing it requires re-encrypting stored configuration. Never expose secrets through `VITE_*` variables or commit `.env`/`.dev.vars`.

```bash
pnpm install
pnpm exec wrangler d1 migrations apply pulseflare --local --config workers/api/wrangler.toml
pnpm exec wrangler dev --config workers/api/wrangler.toml --port 8787
```

Run `pnpm --filter frontend dev` in another terminal. Vite serves port 5173 and proxies `/api` to port 8787. Scheduled monitoring and notification delivery also require the checker and queue consumers; the frontend server alone only serves the UI.

## Cloudflare resources

1. Replace account IDs, database IDs, and allowed origins in the Wrangler configurations with your own values.
2. Provision the `pulseflare` D1 database and the `incident-events` and `alert-events` queues. Apply the numbered migrations from `migrations/`; do not seed a populated database.
3. Configure the API's Clerk credentials, authorized origins, and encryption key with Wrangler secrets. Configure the same encryption key on checker and alert.
4. Deploy the API, alert consumer, AI consumer, and checker using their package deployment scripts. The checker configuration includes the minute Cron Trigger; both the API (incident chat) and AI Worker (automatic enrichment) bind Workers AI. Incident chat requires migration `0005_incident_chat.sql`.
5. Build the frontend and publish it to Pages. Configure the `API` service binding to `pulseflare-api`, preserve the API-only `_routes.json`, and configure the custom domain and Clerk redirect origins.
6. Verify sign-in and workspace creation, an HTTP check, heartbeat deadline/recovery, incident chat and saved follow-up context, notification dispatch, public-page selection, and API-key revocation. Check that the deployed stylesheet loads as `text/css`, including requests with the site's `Origin` header; purge the specific asset URL and its Origin cache variant if an older SPA fallback was cached during deployment.

Use a Clerk development instance for local testing. Configure a production instance and its Google OAuth credentials for a production deployment. Test-only loopback authentication bypass must remain disabled outside local development.

The repository's Wrangler configurations target `pulseflare.zlv.uk`. Deployment IDs are environment-specific; verify the destination account before running deployment commands.

## Staging and release verification

The `wrangler.staging.toml` files target separate Workers, queues, Pages project, and D1 database. Apply all migrations to the isolated staging database, including `0006_product_tools.sql` for environments, deployments, and postmortems. Configure separate staging encryption secrets and explicitly authorize the staging origin in Clerk token validation.

Run unit tests, type checks, the frontend build, browser regressions, and `node scripts/authenticated-smoke.mjs https://pulseflare-staging.pages.dev` before updating production. Enable the staging checker schedule only while testing scheduled flows, then disable it and remove test resources. Staging consumes the same account-level Cloudflare allowances; it is not a separate daily quota.

Before production migration, record the D1 recovery bookmark and deployed Worker/Pages versions. Apply the additive migration, publish the API and checker, then the matching frontend. Preserve existing bindings and encryption secrets. Verify the production CSS content type, authenticated monitoring, reports, deployments, public feeds, and AI follow-up memory after rollout. Keep the previous bundles available for rollback.

When uploading Pages assets through the API, obtain a fresh upload token from the destination project. Upload and register the asset hashes for that project before creating its deployment; a staging project's upload is not a production asset upload. Wait for the deployment stage to report success before running the smoke tests. If static assets fail, roll back Pages first and investigate the upload without changing application data.
