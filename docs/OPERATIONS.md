# Operations

[Architecture](ARCHITECTURE.md) · [Deployment](DEPLOYMENT.md)

The Workers share a D1 usage ledger and enforce capacity at the database layer. Public pages use the Cache API to reduce database traffic.

## Operating parameters

| Parameter              | Configuration                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Scheduler              | Every minute                                                                                        |
| HTTP check interval    | Five minutes minimum                                                                                |
| Active monitors        | Five per workspace, ten across the deployment                                                       |
| Status pages           | One per workspace                                                                                   |
| AI enrichment          | Ten events per workspace per UTC day                                                                |
| Incident chat          | Twenty requests per workspace, forty per deployment per UTC day                                     |
| Chat history           | Up to 100 questions per user/incident; latest 40 shown, latest four completed turns used as context |
| Raw check history      | Seven days                                                                                          |
| Public snapshot TTL    | 120 seconds                                                                                         |
| History cache TTL      | 45 seconds                                                                                          |
| Retention cleanup      | Up to 200 expired checks per hour                                                                   |
| Deployment history     | Thirty days; at most 200 expired records removed per hour                                           |
| Deployment query       | Twenty records per page, thirty-day time window                                                     |
| Postmortem fields      | Four fields, 4,000 characters each; revision-checked saves                                          |
| Daily D1 project guard | 3,000,000 rows read / 60,000 rows written                                                           |

These values are configuration limits, not availability guarantees. Detection depends on the check interval, confirmation policy, and scheduler cadence.

## Daily usage

The API, checker, alert, and AI Workers meter D1 `meta.rows_read` and `meta.rows_written`. They atomically update `platform_daily_budget` once per invocation, including accounting headroom. Public cache hits avoid this database work entirely.

At the project threshold, API calls return 503 with `Retry-After`, scheduled database work pauses, and queue messages retry. The daily ledger resets at UTC midnight. Static pages, the demo, and health endpoints do not require D1.

The guard is not an exact account-wide billing counter. Concurrent work can overshoot the threshold, and REST queries, migrations, and other applications are outside the Worker ledger. Check Cloudflare account analytics before migrations or capacity changes.

## Query and retention controls

History queries use workspace, monitor, and timestamp predicates against composite indexes. Latest checks use indexed timestamp ordering; anomaly detection reads at most 20 samples. Cleanup selects expired rows through the time index rather than scanning all history.

Checks older than seven days are unavailable through history endpoints. Physical deletion is incremental, so a cleanup backlog can take longer to clear.

Deployment history follows the same bounded-cleanup approach with a thirty-day window. Recording a change does not schedule checks, enqueue alerts, or invoke AI. Public badge/RSS cache hits also bypass D1 accounting writes.

## Capacity changes

Update both `MAX_GLOBAL_ACTIVE_MONITORS` and the SQLite capacity triggers through a migration. Measure reads and writes, including index maintenance and retention, before increasing limits. High-frequency heartbeat pings and manual checks also consume database writes.

Preserve a D1 export or recovery bookmark before schema changes. Record applied migrations and verify monitor execution, heartbeat recovery, queue dispatch, and scoped access afterwards.
