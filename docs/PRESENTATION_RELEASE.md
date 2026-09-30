# Presentation-first release

## Ready to explore locally

- Marketing: `/`, `/features`, `/pricing`, `/architecture`, `/docs`.
- Showcase: `/demo`, monitor search/filter/detail/creation preview, heartbeat preview, incidents and Markdown exports, delivery inspector, status-page preview, maintenance, keys, usage, audit, settings.
- Public sample status: `/status/demo`.
- Accessible native dialogs, keyboard focus, reduced-motion support, mobile navigation, local theme preference, self-hosted fonts, lazy routes and ~100 KB generated hero artwork.
- Coming-soon actions do not collect payment, send invitations, create notifications, or submit demo data.

The taste skill informed the graphite/orange visual system, original image asset, asymmetric homepage, restrained product UI, and reduced-motion/theme verification. The demo is intentionally realistic but explicitly labeled as sample data.

## Bugs addressed

- Removed the retired frontend localStorage admin-token workflow; Clerk tokens stay in memory.
- Enforced API-key scopes centrally, including pause/delete and administrative endpoints; restricted the development bypass to loopback requests.
- Scoped checker, AI and alert evidence to the originating workspace. Removed public execution of scheduled checks and cross-workspace default notification routing.
- Repaired incompatible queue events, maintenance partial validation, ISO-date comparisons, and invalid KV snapshot TTLs.
- Public status reads hide private monitors and internal AI investigation evidence. Unknown services do not claim operational status.
- Blocked redirects in probes/webhooks, unsafe literal URL variants, and prototype-chain JSON paths. DNS-rebinding-resistant egress is still a launch gate.
- Repaired the populated-database migration: SQLite cannot add a foreign-key column with a non-null default. The migration adds nullable references, backfills legacy ownership, then uses triggers to enforce required monitor workspace relationships for new writes.
- Corrected mismatched sample postmortem timelines, chart-period labels, multi-toggle theme synchronization, and heartbeat presentation.

## Before any backend deployment

Do not treat this as completion of the full v2 PRD. No remote database, deployment, queue, or secret was changed during this work.

1. Back up the existing D1 database. Validate migrations `0001_schema.sql` and `0002_v2.sql` in a staging D1 environment before applying to production. Stop old worker writers during migration; new workers explicitly write workspace IDs. Drain or migrate legacy queue messages that lack tenant/event identifiers.
2. Configure a staging Clerk application with Organizations, API `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES`, and precise `ALLOWED_ORIGIN` values. Verify admin/member/session expiry/workspace-switch flows. Never enable `DEV_AUTH_BYPASS` outside local development.
3. Replace the v1 cron coordinator with the planned Durable Object scheduler, confirmation checks, heartbeat deadlines, maintenance suppression, atomic quotas, and durable rate limiting. Unsupported advanced monitor settings currently return an explicit error rather than silently pretending to run.
4. Finish workspace integration delivery: the encrypted integration API model is not wired to the legacy alert worker. The v1 worker still uses per-monitor Discord/Telegram/webhook fields. Slack, browser push, signed retries, notification rules and inspectable delivery attempts require the v2 consumer. AI enrichment still precedes alert routing in v1; independently route deterministic outage notifications in v2.
5. Implement queue outbox/idempotency/retries/DLQs. Event identifiers are propagated, but exactly-once notifications are not guaranteed.
6. Complete DNS-aware egress protection, quota concurrency testing, request-body secrecy review, retention/rollup/archive jobs, billing, production privacy terms and operational monitoring. R2 is configured but the planned archival pipeline is not complete.

The showcase can be deployed separately as static Pages without Clerk enrollment or backend changes. The `_redirects` file preserves deep links. Keep all worker secrets out of frontend environment variables.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm --filter frontend build
# With the dev server running at localhost:5173 and Chrome installed:
pnpm test:browser
```

Browser screenshots and local Lighthouse reports are written under ignored `artifacts/`. The original generated artwork is kept there as `pulse-sculpture-source.png`; only the optimized WebP ships.

Verification on this revision: 48 automated tests passed, 72 browser route/viewport checks passed (1440/390/360px), zero browser errors and zero demo API requests. Typechecking, the production frontend build, and all four Wrangler `deploy --dry-run` bundles passed. Local production-build mobile Lighthouse scored 93 performance / 100 accessibility / 100 best practices / 100 SEO. These are local lab results, not production performance guarantees or a substitute for a security review.
