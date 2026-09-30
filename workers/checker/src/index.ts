import {
  checkHeartbeatDeadlines,
  flushOutbox,
  runHttpMonitor,
  databaseBudget,
  isDatabaseLimit,
  type MonitoringEnv,
} from "@pulseflare/shared";
export interface Env extends MonitoringEnv {
  STATUS_KV?: KVNamespace;
}
export async function runScheduled(env: Env) {
  await checkHeartbeatDeadlines(env);
  const rows = await env.DB.prepare(
    `SELECT id,workspace_id FROM monitors WHERE active=1 AND monitor_type='http' AND (last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now')-MAX(interval_s,300)/86400.0) ORDER BY COALESCE(last_checked_at,'') LIMIT 40`,
  ).all<{ id: string; workspace_id: string }>();
  for (let offset = 0; offset < (rows.results ?? []).length; offset += 5) {
    const outcomes = await Promise.allSettled(
      (rows.results ?? [])
        .slice(offset, offset + 5)
        .map((row) => runHttpMonitor(env, row.id, row.workspace_id)),
    );
    for (const outcome of outcomes)
      if (outcome.status === "rejected")
        console.log(
          JSON.stringify({
            event: "check.failed",
            message:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : "Check failed",
          }),
        );
  }
  await flushOutbox(env);
  if (new Date().getUTCMinutes() === 0) {
    // Budget deletion writes and seek the existing tenant/monitor/time index.
    // API reads hide expired evidence while the old prototype backlog ages out.
    const monitors = await env.DB.prepare(
      "SELECT m.id,m.workspace_id,e.raw_retention_days FROM monitors m JOIN workspace_entitlements e ON e.workspace_id=m.workspace_id",
    ).all<{ id: string; workspace_id: string; raw_retention_days: number }>();
    let remaining = 200;
    const perMonitor = Math.max(
      1,
      Math.floor(200 / Math.max(monitors.results?.length ?? 1, 1)),
    );
    for (const monitor of monitors.results ?? []) {
      if (!remaining) break;
      const old = await env.DB.prepare(
        "SELECT id FROM checks WHERE workspace_id=? AND monitor_id=? AND checked_at<strftime('%Y-%m-%dT%H:%M:%SZ','now',?) ORDER BY checked_at,id LIMIT ?",
      )
        .bind(
          monitor.workspace_id,
          monitor.id,
          `-${monitor.raw_retention_days} days`,
          Math.min(remaining, perMonitor),
        )
        .all<{ id: number }>();
      const ids = (old.results ?? []).map((r) => r.id);
      if (!ids.length) continue;
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE incidents SET trigger_check_id=NULL WHERE workspace_id=? AND monitor_id=? AND trigger_check_id IN (${placeholders})`,
        ).bind(monitor.workspace_id, monitor.id, ...ids),
        env.DB.prepare(
          `UPDATE incidents SET recovery_check_id=NULL WHERE workspace_id=? AND monitor_id=? AND recovery_check_id IN (${placeholders})`,
        ).bind(monitor.workspace_id, monitor.id, ...ids),
        env.DB.prepare(
          `DELETE FROM anomalies WHERE workspace_id=? AND monitor_id=? AND check_id IN (${placeholders})`,
        ).bind(monitor.workspace_id, monitor.id, ...ids),
        env.DB.prepare(`DELETE FROM checks WHERE id IN (${placeholders})`).bind(
          ...ids,
        ),
      ]);
      remaining -= ids.length;
    }
    await env.DB.prepare(
      "DELETE FROM event_outbox WHERE event_id IN (SELECT event_id FROM event_outbox WHERE alert_sent=1 AND ai_sent=1 AND created_at<strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days') LIMIT 100)",
    ).run();
  }
}
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          const budget = await databaseBudget(env.DB);
          try {
            await runScheduled({ ...env, DB: budget.DB });
          } finally {
            await budget.finish();
          }
        } catch (error) {
          if (!isDatabaseLimit(error)) throw error;
          console.log(
            JSON.stringify({ event: "scheduler.daily_budget_paused" }),
          );
        }
      })(),
    );
  },
  async fetch() {
    return Response.json(
      { ok: false, error: "Checks run only from scheduled events" },
      { status: 405 },
    );
  },
};
