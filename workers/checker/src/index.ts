import {
  checkHeartbeatDeadlines,
  flushOutbox,
  runHttpMonitor,
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
    // Preserve incident evidence references before raw checks expire.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE incidents SET trigger_check_id=NULL WHERE trigger_check_id IN (SELECT c.id FROM checks c JOIN workspace_entitlements e ON e.workspace_id=c.workspace_id WHERE julianday(c.checked_at)<julianday('now')-e.raw_retention_days)`,
      ),
      env.DB.prepare(
        `UPDATE incidents SET recovery_check_id=NULL WHERE recovery_check_id IN (SELECT c.id FROM checks c JOIN workspace_entitlements e ON e.workspace_id=c.workspace_id WHERE julianday(c.checked_at)<julianday('now')-e.raw_retention_days)`,
      ),
      env.DB.prepare(
        `DELETE FROM anomalies WHERE check_id IN (SELECT c.id FROM checks c JOIN workspace_entitlements e ON e.workspace_id=c.workspace_id WHERE julianday(c.checked_at)<julianday('now')-e.raw_retention_days)`,
      ),
      env.DB.prepare(
        `DELETE FROM checks WHERE id IN (SELECT c.id FROM checks c JOIN workspace_entitlements e ON e.workspace_id=c.workspace_id WHERE julianday(c.checked_at)<julianday('now')-e.raw_retention_days LIMIT 5000)`,
      ),
      env.DB.prepare(
        `DELETE FROM event_outbox WHERE alert_sent=1 AND ai_sent=1 AND julianday(created_at)<julianday('now','-7 days')`,
      ),
    ]);
  }
}
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
  async fetch() {
    return Response.json(
      { ok: false, error: "Checks run only from scheduled events" },
      { status: 405 },
    );
  },
};
