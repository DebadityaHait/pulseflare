# Pulseflare

Uptime monitoring, built on Cloudflare's edge.

Monitor websites, APIs, and background jobs. Get notified when something breaks, investigate the incident, and keep customers informed with a public status page.

[Start monitoring](https://pulseflare.zlv.uk/signup) · [Live demo](https://pulseflare.zlv.uk/demo) · [Status page](https://pulseflare.zlv.uk/status/demo) · [Architecture](docs/ARCHITECTURE.md)

[![Pulseflare homepage and interactive monitoring preview](docs/screenshots/homepage.png)](https://pulseflare.zlv.uk)

## Features

| Feature | Details |
| --- | --- |
| HTTP monitoring | Scheduled GET, HEAD, and POST checks with status, text, and JSON-path assertions; configurable timeouts and encrypted request headers |
| Job heartbeats | Monitor cron jobs and backups with secret ping URLs, grace periods, missed-run alerts, and automatic recovery |
| Incident management | Confirmed outages, latency anomalies, evidence timelines, acknowledgement, resolution, and public incident updates |
| Notifications | Slack, Discord, Telegram, and HTTPS webhooks with optional HMAC signing, test delivery, retries, and delivery logs |
| AI-assisted investigation | Workers AI summaries and severity assessments backed by recorded check evidence; alerts run independently of enrichment |
| Public status pages | Publish selected services, availability history, and incident updates through edge-cached pages |
| Workspaces and access | Clerk authentication and organizations, Admin/Member roles, scoped API keys, and audit logs |
| Monitoring dashboard | Response-time charts, searchable monitors, light and dark themes, and responsive layouts |

## Product tour

[Explore the workspace](https://pulseflare.zlv.uk/demo) without signing in. The Orbit demo uses sample data; your own workspace connects to the monitoring service.

![Workspace overview with monitor health, incidents, and response-time trends](docs/screenshots/workspace.png)

<details>
<summary>Monitor analytics, incident investigation, status pages, and mobile</summary>

### Monitor analytics

![Light-theme monitor detail with latency and availability history](docs/screenshots/monitor.png)

### Incident investigation

![Incident evidence timeline and AI-assisted summary](docs/screenshots/incident.png)

### Public status page

![Customer-facing service health and incident updates](docs/screenshots/status-page.png)

### Mobile dashboard

<img src="docs/screenshots/mobile.png" alt="Pulseflare workspace on mobile" width="320" />

</details>

## Architecture

Pulseflare runs on Cloudflare Pages, Workers, D1, Queues, and Workers AI. A same-origin service binding connects the frontend to the Hono API. Cron Triggers schedule checks; D1 holds configuration, evidence, and incident state.

```mermaid
flowchart TB
  Browser["React workspace"] --> Pages["Cloudflare Pages"]
  Pages -->|"static assets"| Static["Website + demo"]
  Pages -->|"/api service binding"| API["Hono API Worker"]
  Clerk["Clerk authentication"] -.-> API
  Jobs["Background jobs"] -->|"heartbeat ping"| API
  API --> D1[("D1")]
  Cron["Cron Trigger"] --> Checker["Checker Worker"]
  Checker -->|"HTTP probes"| Endpoints["Websites + APIs"]
  Checker -->|"evidence + incident state"| D1
  D1 --- Outbox["Transactional outbox"]
  Outbox --> AQ["Alert queue"]
  Outbox --> IQ["Incident queue"]
  AQ --> Alert["Alert Worker"]
  Alert --> Providers["Slack / Discord / Telegram / webhooks"]
  IQ --> AI["AI Worker"]
  AI --> WAI["Workers AI"]
  AI -->|"incident enrichment"| D1
  Alert -->|"delivery records"| D1
  API --- Cache["Cache API"]
```

The monitoring pipeline commits evidence, incident transitions, and outbox events together before dispatch. Alert delivery and AI enrichment use separate queues, so model latency does not delay notifications. Atomic D1 leases coordinate scheduled checks, while delivery records and webhook event IDs support idempotent processing.

Public cache hits bypass D1 entirely. Indexed history queries, bounded retention jobs, and a shared daily usage ledger keep database work predictable.

[Architecture and failure handling](docs/ARCHITECTURE.md) · [Operations](docs/OPERATIONS.md) · [Deployment](docs/DEPLOYMENT.md)

## Development

Node 24 and pnpm 10.

```bash
git clone https://github.com/DebadityaHait/pulseflare.git
cd pulseflare
pnpm install
pnpm --filter frontend dev
```

Open `http://localhost:5173`. The demo runs without credentials.

For authenticated development, copy [.env.example](.env.example) to the root `.env` and configure Clerk. Store API secrets in `workers/api/.dev.vars`, then apply migrations and start the API:

```bash
pnpm exec wrangler d1 migrations apply pulseflare --local --config workers/api/wrangler.toml
pnpm exec wrangler dev --config workers/api/wrangler.toml --port 8787
```

Vite proxies `/api` to port 8787. See [deployment setup](docs/DEPLOYMENT.md) for Worker bindings, queue consumers, scheduled checks, and secrets.

## Testing

```bash
pnpm typecheck
pnpm test
pnpm --filter frontend build
pnpm test:browser
```

The suite contains 73 tests covering monitor execution, heartbeat recovery, workspace isolation, API-key scopes, encryption, transactional dispatch, migration compatibility, and database budgets. Browser checks cover 24 routes at desktop and mobile widths, including themes, filters, navigation, and read-only interactions.

Browser tests require Chrome and a frontend server on port 5173. [Authenticated end-to-end tests](scripts/authenticated-smoke.mjs) exercise signup, workspace creation, HTTP checks, scheduled heartbeat incidents, public status publication, and API-key revocation.

## Repository structure

```text
frontend/          React/Vite application and Clerk integration
workers/api/       Hono API, authorization, heartbeats, public status
workers/checker/   Scheduled probes, leases, deadlines, retention
workers/alert/     Notification delivery and retries
workers/ai/        Incident enrichment with Workers AI
packages/shared/  Monitoring state, outbox, security, budgets, validation
migrations/       D1 schema, indexes, capacity enforcement
tests/            Unit and SQLite-backed integration tests
scripts/          Deployment utilities and browser tests
docs/             Architecture, deployment, operations, screenshots
```
