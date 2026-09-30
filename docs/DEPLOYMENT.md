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
4. Deploy the API, alert consumer, AI consumer, and checker using their package deployment scripts. The checker configuration includes the minute Cron Trigger; the AI Worker binds Workers AI.
5. Build the frontend and publish it to Pages. Configure the `API` service binding to `pulseflare-api`, preserve the API-only `_routes.json`, and configure the custom domain and Clerk redirect origins.
6. Verify sign-in and workspace creation, an HTTP check, heartbeat deadline/recovery, notification dispatch, public-page selection, and API-key revocation.

Use a Clerk development instance for local testing. Configure a production instance and its Google OAuth credentials for a production deployment. Test-only loopback authentication bypass must remain disabled outside local development.

The repository's Wrangler configurations target `pulseflare.zlv.uk`. Deployment IDs are environment-specific; verify the destination account before running deployment commands.
