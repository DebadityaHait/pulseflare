import {
  detectLatencyAnomaly,
  deriveState,
  isValidMonitorUrl,
  shouldCreateIncident,
  shouldResolveIncident,
  type IncidentQueueEvent,
  type LatestStatus,
  type Monitor,
  type MonitorState
} from "@pulseflare/shared";

export interface Env {
  DB: D1Database;
  STATUS_KV: KVNamespace;
  INCIDENT_QUEUE: Queue<IncidentQueueEvent>;
}

type MonitorRow = {
  id: string;
  name: string;
  url: string;
  method: "GET" | "HEAD" | "POST";
  expected_status_min: number;
  expected_status_max: number;
  interval_s: number;
  timeout_ms: number;
  active: number;
  public: number;
  tags: string;
  notify_discord_webhook: string | null;
  notify_telegram_chat_id: string | null;
  notify_generic_webhook: string | null;
  created_at: string;
  updated_at: string;
};

function mapMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    method: row.method,
    expectedStatusMin: row.expected_status_min,
    expectedStatusMax: row.expected_status_max,
    intervalS: row.interval_s,
    timeoutMs: row.timeout_ms,
    active: row.active === 1,
    public: row.public === 1,
    tags: JSON.parse(row.tags || "[]") as string[],
    notifyDiscordWebhook: row.notify_discord_webhook,
    notifyTelegramChatId: row.notify_telegram_chat_id,
    notifyGenericWebhook: row.notify_generic_webhook,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function runHttpCheck(monitor: Monitor): Promise<{ status: number; ok: boolean; latencyMs: number; errorCode?: string; errorMsg?: string; responseSizeBytes?: number }> {
  if (!isValidMonitorUrl(monitor.url)) {
    return { status: 0, ok: false, latencyMs: 0, errorCode: "INVALID_URL", errorMsg: "Blocked by monitor URL validation" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), monitor.timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(monitor.url, { method: monitor.method, signal: controller.signal });
    const latencyMs = Date.now() - start;
    const ok = response.status >= monitor.expectedStatusMin && response.status <= monitor.expectedStatusMax;
    const length = Number(response.headers.get("content-length") ?? 0) || undefined;
    return { status: response.status, ok, latencyMs, responseSizeBytes: length };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      latencyMs: Date.now() - start,
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "FETCH_ERROR",
      errorMsg: error instanceof Error ? error.message : "Request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function insertCheck(env: Env, monitor: Monitor, result: Awaited<ReturnType<typeof runHttpCheck>>, checkedAt: string): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO checks (monitor_id, status, ok, latency_ms, error_code, error_msg, response_size_bytes, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(monitor.id, result.status, result.ok ? 1 : 0, result.latencyMs, result.errorCode ?? null, result.errorMsg ?? null, result.responseSizeBytes ?? null, checkedAt)
    .first<{ id: number }>();
  if (!row) throw new Error("Failed to insert check");
  return row.id;
}

async function getRecentLatencies(env: Env, monitorId: string): Promise<number[]> {
  const result = await env.DB.prepare(
    `SELECT latency_ms FROM checks WHERE monitor_id = ? AND ok = 1 ORDER BY checked_at DESC LIMIT 20`
  ).bind(monitorId).all<{ latency_ms: number }>();
  return (result.results ?? []).map((row) => row.latency_ms).reverse();
}

async function getOpenIncidentId(env: Env, monitorId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT id FROM incidents WHERE monitor_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1`).bind(monitorId).first<{ id: string }>();
  return row?.id ?? null;
}

async function processMonitor(env: Env, monitor: Monitor): Promise<void> {
  const checkedAt = new Date().toISOString();
  const previousState = await env.STATUS_KV.get(`monitor_state:${monitor.id}`) as MonitorState | null;
  const result = await runHttpCheck(monitor);
  const checkId = await insertCheck(env, monitor, result, checkedAt);
  const recentLatencies = result.ok ? await getRecentLatencies(env, monitor.id) : [];
  const anomaly = result.ok ? detectLatencyAnomaly(recentLatencies.slice(0, -1), result.latencyMs) : { anomalous: false, mean: 0, stddev: 0, zScore: 0 };
  const nextState = deriveState({ ok: result.ok, latencyMs: result.latencyMs, zScore: anomaly.zScore });
  let activeIncidentId = await getOpenIncidentId(env, monitor.id);

  if (shouldCreateIncident(previousState, nextState)) {
    const row = await env.DB.prepare(
      `INSERT INTO incidents (monitor_id, type, status, started_at, trigger_check_id, failing_status, failing_error_code)
       VALUES (?, 'outage', 'open', ?, ?, ?, ?) RETURNING id`
    ).bind(monitor.id, checkedAt, checkId, result.status, result.errorCode ?? null).first<{ id: string }>();
    activeIncidentId = row?.id ?? activeIncidentId;
    if (row) await env.INCIDENT_QUEUE.send({ type: "incident.created", monitorId: monitor.id, incidentId: row.id, checkId, createdAt: checkedAt });
  }

  if (activeIncidentId && shouldResolveIncident(previousState, nextState)) {
    await env.DB.prepare(
      `UPDATE incidents SET status = 'resolved', resolved_at = ?, recovery_check_id = ?, updated_at = ? WHERE id = ?`
    ).bind(checkedAt, checkId, checkedAt, activeIncidentId).run();
    await env.INCIDENT_QUEUE.send({ type: "incident.resolved", monitorId: monitor.id, incidentId: activeIncidentId, checkId, createdAt: checkedAt });
    activeIncidentId = null;
  }

  if (anomaly.anomalous) {
    const row = await env.DB.prepare(
      `INSERT INTO anomalies (monitor_id, check_id, latency_ms, rolling_mean_ms, rolling_stddev_ms, z_score)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(monitor.id, checkId, result.latencyMs, anomaly.mean, anomaly.stddev, anomaly.zScore).first<{ id: string }>();
    if (row) await env.INCIDENT_QUEUE.send({ type: "anomaly.detected", monitorId: monitor.id, anomalyId: row.id, checkId, createdAt: checkedAt });
  }

  const latest: LatestStatus = { monitorId: monitor.id, state: nextState, ok: result.ok, status: result.status, latencyMs: result.latencyMs, checkedAt, activeIncidentId };
  await env.STATUS_KV.put(`latest_status:${monitor.id}`, JSON.stringify(latest));
  await env.STATUS_KV.put(`monitor_state:${monitor.id}`, nextState);
}

async function runScheduled(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`SELECT * FROM monitors WHERE active = 1`).all<MonitorRow>();
  const monitors = (rows.results ?? []).map(mapMonitor);
  await env.STATUS_KV.put("diagnostics:last_checker_run", new Date().toISOString());
  for (const monitor of monitors) {
    try {
      await processMonitor(env, monitor);
    } catch (error) {
      console.log(JSON.stringify({ level: "error", event: "check.failed", monitorId: monitor.id, message: error instanceof Error ? error.message : "unknown" }));
    }
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
  async fetch(_request: Request, env: Env) {
    await runScheduled(env);
    return Response.json({ ok: true, data: { ran: true } });
  }
};
