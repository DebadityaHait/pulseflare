# Advertised MVP release

Pulseflare's primary flow is now signup -> workspace -> real monitoring. The
public demo remains an independent, read-only portfolio preview.

## Runtime

- Pages serves the React frontend at `pulseflare.zlv.uk` in the second account.
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
  Status snapshots are cached for two minutes.
- Raw checks expire after seven days through indexed hourly cleanup, capped at
  200 deletions per hour. Backlogs may take longer to physically delete. Rollups and
  R2 archival are deferred; see `TODO.md`.
- All four Workers share daily cost accounting and pause new database work at
  3 million reads / 60,000 writes. Global active capacity is 10 monitors. See
  [free-tier operating notes](FREE_TIER_OPERATIONS.md).

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

## Previous deployment: pulseflare.pages.dev, 2026-09-30

- Deployed to `https://pulseflare.pages.dev` with same-origin API service binding.
- Applied migrations 0002/0003 to the existing database without re-seeding. Preserved the two existing monitors and their check/incident history; downloaded configuration backup and recorded the D1 recovery bookmark under ignored `artifacts/`.
- Passed 65 backend tests, all six package typechecks, frontend build, and four Worker dry runs.
- Passed 72 route/viewport checks (1440, 390, 360 px), pricing dialogs, read-only demo checks, themes, mobile navigation, and demo Markdown export; no browser errors.
- Verified Google OAuth handoff, email/password signup with test-email verification, organization creation, organization-scoped API authentication, real HTTP checking, heartbeat URL/ping, status-page selection/publication, and API-key revocation on the deployed domain.
- Verified the deployed minute cron opens a missed-heartbeat incident and a real POST ping automatically resolves it. Alert and AI outboxes both drained.
- Lighthouse mobile: performance 99, accessibility 100, best practices 100, SEO 100. Scores vary with device/network conditions.

Google account consent was not completed by the automated test; it verified the redirect to Google's OAuth endpoint. Development Clerk uses its development OAuth configuration. Test identities and monitoring resources are removed after verification, not counted as users.

## Current deployment: pulseflare.zlv.uk, 2026-09-30

- Published the frontend on `pulseflare.zlv.uk` with active TLS, Pages project
  `pulseflare-zlv`, and the same-origin API Worker binding in the second account.
- Deployed API/checker/alert/AI Workers, queue consumers and the minute cron.
  Explicit account IDs in all deployment configs prevent accidental targeting
  of the exhausted original account.
- Created a fresh database and applied/recorded migrations 0001 through 0004.
  Schema application consumed 1,836 reads / 186 writes, without raw-history import.
  Original monitors and historical data remain in the original account.
- Passed 72 backend tests, all six package typechecks, the frontend build, and
  Worker deployment dry runs. Indexed-query regression tests include 10,000 old
  local checks; budget tests verify metering, UTC rollover and retryable 503s.
- Passed 72 deployed route/viewport checks at 1440, 390 and 360 px, with pricing,
  themes, mobile navigation, read-only demo behavior and exports. The local DNS
  resolver blocks the optional Cloudflare analytics beacon; that third-party
  warning is reported separately, not confused with application errors.
- Verified email/password signup and verification, Google OAuth handoff, Clerk
  organizations and authenticated API access, real HTTP checks, heartbeat pings,
  cron-detected missed-heartbeat incidents/recovery, selected public status pages,
  and scoped API-key revocation on the new domain.
- An early post-verification Worker budget snapshot was 736 reads / 249 writes,
  including accounting headroom and idle cron activity. This is not the exact
  account billing total: REST migrations/diagnostics are recorded separately.

Development-mode Clerk remains intentional. Google consent itself was not
automated. Paid plans were not enabled. See the free-tier operating notes before
raising capacity or importing historical data.
