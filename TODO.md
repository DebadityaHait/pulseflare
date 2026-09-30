# Pulseflare backlog

The current release completes the advertised Beta MVP. These items are deferred;
they should not be described as available on the marketing site until verified.

## Next: scheduling and operation

- [ ] Durable Object scheduler and faster outage confirmation. Depends on a tested D1 state migration and alarm capacity budget. Done when overlapping alarms cannot duplicate checks/incidents and confirmation timing is measured.
- [ ] Historical hourly/daily rollups, compressed R2 archives, and longer retention. Depends on a resumable archival job and retention tests. Done when archival can resume after failure, old raw checks expire safely, and charts read real retained history.
- [ ] Maintenance windows. Existing CRUD is scaffolding; scheduling, suppression, and the UI need implementation. Done when selected monitors suppress alerts during a window and public pages show only relevant maintenance.
- [ ] Queue dead-letter handling and operator tools. Depends on observability counters and queue permissions. Done when abandoned deliveries can be inspected and safely retried without resending successful channels.
- [ ] Production Clerk instance and custom domain. Development auth is enabled for this MVP. Done when production keys, Google OAuth credentials, redirects, workspace access, and email flows are verified on the chosen domain.
- [ ] DNS-aware SSRF protection and abuse/capacity budgeting. Current validation blocks private literals/internal names and disables redirects. Done when DNS rebinding cases are tested and monitoring resource use has measured headroom.

## Product improvements

- [ ] Monitor groups, tags, and environments with saved filters. Done when configuration, monitor lists, and shared views use the same grouping model.
- [ ] Rolling SLO/error-budget analytics. Depends on historical rollups. Done when availability, incident durations, and remaining budget match independently calculated fixtures.
- [ ] Incident postmortems and Markdown export for live incidents. Demo report export is illustrative. Done when all generated statements cite recorded evidence and edits/exports persist correctly.
- [ ] Notification filters editor, secret replacement, and retry controls. The API stores basic rules; the MVP UI defaults to all monitors/opened/resolved. Done when edited rules preserve unspecified settings and retries are auditable.
- [ ] Browser push subscriptions. Depends on VAPID credentials and subscription lifecycle management. Done when permission denial, expired endpoints, and unsubscribe are handled.
- [ ] Status-page custom domains, grouped components, logos, themes, and longer history. Depends on domain verification and rollups. Done when private resources remain excluded under every public endpoint.
- [ ] Status badges, RSS, JSON subscriptions, and embeddable widgets. Depends on a stable public snapshot contract. Done when each surface reflects published monitor selection and has bounded caching.

## Developer platform

- [ ] Deployment annotations and GitHub integration. Done when signed/scoped deployment events appear beside real monitor evidence without implying causation.
- [ ] CLI and monitoring-as-code. Depends on explicit API/config compatibility rules. Done when applying configuration is repeatable, scoped, and reviewable without destructive surprises.
- [ ] OpenAPI import. Done when safe parameter-free endpoints can be previewed and imported within quotas, with invalid URLs rejected.
- [ ] Full-screen monitor wallboard. Done when it displays live scoped data and reconnects gracefully.

## Commercial and team features

- [ ] Billing, Pro/Team entitlements, and expanded limits. Depends on validated capacity, billing webhooks, and terms. Done when lifecycle events are idempotent and quota changes match subscription state.
- [ ] Advanced team settings and reliability reports. Depends on production organization flows and historical analytics. Done when role changes, invitations, and reports have tenant isolation tests.

## Homepage claim checklist

| Advertised capability | Live surface | Verification |
| --- | --- | --- |
| Account and workspace | `/signup`, `/login`, `/dashboard` | Clerk email/password flow, Google handoff, organization selection |
| HTTP checks and assertions | Monitors: create, edit, detail | Status/text/JSON assertions, encrypted headers, bounded bodies, scheduling/lease tests |
| Background-job heartbeats | New monitor: Background job | GET/POST, grace deadline, missed incident, recovery, rotation, pause/resume tests |
| Incidents and summaries | Incidents: detail/timeline | Confirmation, recovery, public updates, AI budget/fallback tests |
| Slack/Discord/Telegram/webhooks | Integrations | Provider payloads, targeted tests, delivery logs, retries, HMAC/idempotency tests |
| Public service health | Status page editor and `/status/:slug` | Selected public monitors only; private investigation excluded |
| Workspace REST API | API keys | Issue/use/revoke and deny-default scope tests |
| Five active monitors | Usage and monitor API | Database/API quota enforcement |
| Five-minute HTTP interval | Monitor settings and checker | Minimum interval on create/edit; due-check tests |
| Seven-day raw history | Monitor history and checker retention | Timestamp cutoff, retained incident lifecycle, safe evidence expiry |
| One Beta status page | Status page editor | Unique workspace page and quota handling |
| Pro/Team | Pricing | Coming-soon notice; no payment or subscription mutation |
| Public demo | `/demo/*`, `/status/demo` | Labeled fictional data, no monitoring mutations |
