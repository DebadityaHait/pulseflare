# Advertised MVP release

Pulseflare's primary flow is now signup -> workspace -> real monitoring. The
public demo remains an independent, read-only portfolio preview.

## Runtime

- Pages serves the React frontend at `pulseflare.pages.dev`.
- The API Worker verifies Clerk sessions and organization roles or scoped API keys.
- The checker runs every minute and claims due HTTP monitors atomically in D1.
  HTTP intervals have a five-minute minimum. Two failed checks confirm an outage.
- Heartbeats accept GET/POST with a hashed secret URL. Expected interval plus grace
  defines the deadline; a minute cron detects missed runs. Pause disables pings;
  resume starts a fresh window. Full URLs are revealed only at creation/rotation.
- Incident transitions persist a D1 outbox in the same transaction. Alert and AI
  queues dispatch independently. Successful delivery records suppress duplicate
  queue messages; external HTTP delivery is at-least-once if a provider response
  is lost. Generic webhooks receive an event ID/idempotency key and optional HMAC.
- Slack, Discord, Telegram and HTTPS webhooks use encrypted integration settings.
- AI enrichment is capped at ten events per workspace per day and has a
  deterministic fallback. Alerts do not wait for enrichment.
- Public pages include only selected public monitors and explicit public updates.
  Status snapshots are cached for 30 seconds.
- Raw checks expire after seven days through bounded hourly cleanup. Rollups and
  R2 archival are deferred; see `TODO.md`.

## Credentials and development

Root `.env` contains `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (or
`VITE_CLERK_PUBLISHABLE_KEY`) and `CLERK_SECRET_KEY`. Vite explicitly exposes only
the publishable key. Worker secrets include the Clerk secret and a shared
`SECRET_ENCRYPTION_KEY` for API/checker/alert. Keep the encryption key stable;
rotation requires re-encrypting stored configuration.

Development-mode Clerk is intentionally used for the current release. Email and
password, Google, and organization creation must be enabled in that instance.
`DEV_AUTH_BYPASS` is restricted to loopback hosts and must never be deployed.

For local API work, configure `.dev.vars` under `workers/api`, run Wrangler on
port 8787, and run the frontend on 5173. Vite proxies `/api` to that Worker.

## Release checks

Run `pnpm typecheck`, `pnpm test`, `pnpm --filter frontend build`, Worker deploy
dry runs, `pnpm test:browser`, and the authenticated browser scenario. Preserve a
D1 export/bookmark before applying migrations `0002_v2.sql` and `0003_mvp.sql`.
Deploy compatible consumers/API/checker before publishing the frontend. Verify
an authenticated monitor, heartbeat ping, status selection, and key revocation
on the deployed origin. Never deploy seed data to a populated database.
