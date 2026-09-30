# Free-tier operating notes

Production origin: `https://pulseflare.zlv.uk`. Account:
`f456997005771d4af03fa8f845a54f62`. D1: `pulseflare`, ID
`3136547a-66dd-484b-b931-06f04564f635`. All Worker configs explicitly target this
account. Pages project: `pulseflare-zlv`, forwarding `/api/*` to `pulseflare-api`.

The original account, Pages deployment and historical database remain intact.
This deployment starts with a fresh schema, not the 421,000-check prototype
backlog. Existing Clerk identities can sign in; their new-account workspaces are
created on first access. Monitoring configuration/history is not migrated.

## Limits and safeguards

Cloudflare D1 Free allows 5 million rows read / 100,000 written per account per
UTC day. Index maintenance and deletes also count. These are rows scanned, not
HTTP requests or rows returned. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

- The project pauses new database work at 3 million reads / 60,000 writes.
  API, checker, alert and AI Workers meter actual D1 `meta` costs and add them
  atomically to a shared `platform_daily_budget` ledger once per invocation.
- Concurrent invocations may overshoot the project threshold slightly. There
  is deliberately substantial headroom; this is a safety guard, not an exact
  Cloudflare account billing counter. REST SQL, migrations, and other projects
  are not metered by the Worker ledger. Track those in Cloudflare analytics.
- Budget exhaustion returns API 503 with `Retry-After` to the next UTC midnight;
  cron work pauses and queue delivery retries. Health and static/demo pages do
  not require D1. Actual account-limit errors also return the same clear state.
- Global capacity is 10 active monitors, enforced atomically by SQLite triggers;
  each beta workspace retains its five-monitor limit. HTTP intervals are at
  least five minutes. Frequent heartbeat pings/manual tests still consume real
  writes and can exhaust the project guard; avoid unnecessary high-frequency pings.
- History/statistics constrain workspace + monitor + timestamp so the existing
  composite index seeks the relevant time range. Latest checks use indexed
  timestamp ordering, and anomaly detection reads at most 20 recent samples.
- Public snapshots cache for 120 seconds. The incident endpoint reuses the
  snapshot. Raw history is hidden beyond seven days; physical cleanup selects
  at most 200 expired checks per hour through the same time index.
- Queue consumers run with concurrency one. Only incident transitions create
  queue work. Completed outbox entries do not participate in pending scans.
- No large migrations/imports, unbounded verification counts, KV snapshot
  writes, or R2 archives are part of the daily MVP workflow.

## Release procedure

Check account-wide GraphQL D1 usage before migrations. Apply to a fresh database
for initial deployment; never import the old raw backlog. Record each migration
in `d1_migrations`. Verify typechecks, tests, build, authenticated browser flows,
and cron-triggered missed-heartbeat recovery. Inspect the project's budget ledger
and account analytics afterwards, without scanning `checks` to count all history.

For capacity changes, update both `MAX_GLOBAL_ACTIVE_MONITORS` and the SQLite
capacity triggers via a new migration. Benchmark actual reads/writes (including
retention) first. Do not simply raise the guard or enable billing to mask a
query regression.
