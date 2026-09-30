# Operations

[Architecture](ARCHITECTURE.md) · [Deployment](DEPLOYMENT.md)

The Workers share a D1 usage ledger and enforce capacity at the database layer. Public pages use the Cache API to reduce database traffic.

## Operating parameters

| Parameter | Configuration |
| --- | --- |
| Scheduler | Every minute |
| HTTP check interval | Five minutes minimum |
| Active monitors | Five per workspace, ten across the deployment |
| Status pages | One per workspace |
| AI enrichment | Ten events per workspace per UTC day |
| Raw check history | Seven days |
| Public snapshot TTL | 120 seconds |
| History cache TTL | 45 seconds |
| Retention cleanup | Up to 200 expired checks per hour |
| Daily D1 project guard | 3,000,000 rows read / 60,000 rows written |

These values are configuration limits, not availability guarantees. Detection depends on the check interval, confirmation policy, and scheduler cadence.

## Daily usage

The API, checker, alert, and AI Workers meter D1 `meta.rows_read` and `meta.rows_written`. They atomically update `platform_daily_budget` once per invocation, including accounting headroom. Public cache hits avoid this database work entirely.

At the project threshold, API calls return 503 with `Retry-After`, scheduled database work pauses, and queue messages retry. The daily ledger resets at UTC midnight. Static pages, the demo, and health endpoints do not require D1.

The guard is not an exact account-wide billing counter. Concurrent work can overshoot the threshold, and REST queries, migrations, and other applications are outside the Worker ledger. Check Cloudflare account analytics before migrations or capacity changes.

## Query and retention controls

History queries use workspace, monitor, and timestamp predicates against composite indexes. Latest checks use indexed timestamp ordering; anomaly detection reads at most 20 samples. Cleanup selects expired rows through the time index rather than scanning all history.

Checks older than seven days are unavailable through history endpoints. Physical deletion is incremental, so a cleanup backlog can take longer to clear.

## Capacity changes

Update both `MAX_GLOBAL_ACTIVE_MONITORS` and the SQLite capacity triggers through a migration. Measure reads and writes, including index maintenance and retention, before increasing limits. High-frequency heartbeat pings and manual checks also consume database writes.

Preserve a D1 export or recovery bookmark before schema changes. Record applied migrations and verify monitor execution, heartbeat recovery, queue dispatch, and scoped access afterwards.
