import {
  applySeverityOverrides,
  buildAnomalyPrompt,
  buildIncidentPrompt,
  buildSeverityPrompt,
  fallbackAnomalyExplanation,
  fallbackIncidentSummary,
  fallbackSeverity,
  parseSeverity,
  type AlertQueueEvent,
  type Check,
  type Incident,
  type IncidentQueueEvent,
  type Monitor
} from "@pulseflare/shared";

export interface Env {
  DB: D1Database;
  AI: Ai;
  ALERT_QUEUE: Queue<AlertQueueEvent>;
  AI_SUMMARY_MODEL?: string;
  AI_SEVERITY_MODEL?: string;
  AI_EXPLAIN_MODEL?: string;
}

type Row = Record<string, unknown>;

function monitorFrom(row: Row): Monitor {
  return {
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    method: row.method as Monitor["method"],
    expectedStatusMin: Number(row.expected_status_min),
    expectedStatusMax: Number(row.expected_status_max),
    intervalS: Number(row.interval_s),
    timeoutMs: Number(row.timeout_ms),
    active: Number(row.active) === 1,
    public: Number(row.public) === 1,
    tags: JSON.parse(String(row.tags ?? "[]")) as string[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function incidentFrom(row: Row): Incident {
  return {
    id: String(row.id),
    monitorId: String(row.monitor_id),
    type: row.type as Incident["type"],
    status: row.status as Incident["status"],
    startedAt: String(row.started_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    triggerCheckId: row.trigger_check_id ? Number(row.trigger_check_id) : null,
    recoveryCheckId: row.recovery_check_id ? Number(row.recovery_check_id) : null,
    failingStatus: row.failing_status ? Number(row.failing_status) : null,
    failingErrorCode: row.failing_error_code ? String(row.failing_error_code) : null,
    aiSummary: row.ai_summary ? String(row.ai_summary) : null,
    aiSummaryStatus: row.ai_summary_status as Incident["aiSummaryStatus"],
    aiSeverity: row.ai_severity ? Number(row.ai_severity) : null,
    aiSeverityReason: row.ai_severity_reason ? String(row.ai_severity_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function checkFrom(row: Row): Check {
  return {
    id: Number(row.id),
    monitorId: String(row.monitor_id),
    status: Number(row.status),
    ok: Number(row.ok) === 1,
    latencyMs: Number(row.latency_ms),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMsg: row.error_msg ? String(row.error_msg) : null,
    checkedAt: String(row.checked_at)
  };
}

async function runTextAi(env: Env, model: string, prompt: string): Promise<string | null> {
  try {
    const output = await env.AI.run(model, { prompt, max_tokens: 256 });
    if (typeof output === "string") return output;
    if (output && typeof output === "object" && "response" in output) return String(output.response);
    return null;
  } catch (error) {
    console.log(JSON.stringify({ level: "error", event: "ai.failed", message: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

async function processIncident(env: Env, event: Extract<IncidentQueueEvent, { type: "incident.opened" | "incident.created" | "incident.resolved" }>) {
  const monitorRow = await env.DB.prepare(`SELECT * FROM monitors WHERE id = ? AND workspace_id = ?`).bind(event.monitorId, event.workspaceId).first<Row>();
  const incidentRow = await env.DB.prepare(`SELECT * FROM incidents WHERE id = ? AND workspace_id = ? AND monitor_id = ?`).bind(event.incidentId, event.workspaceId, event.monitorId).first<Row>();
  if (!monitorRow || !incidentRow) return;
  const monitor = monitorFrom(monitorRow);
  const incident = incidentFrom(incidentRow);
  const checkRows = await env.DB.prepare(`SELECT * FROM checks WHERE monitor_id = ? AND workspace_id = ? ORDER BY checked_at DESC LIMIT 10`).bind(event.monitorId, event.workspaceId).all<Row>();
  const checks = (checkRows.results ?? []).map(checkFrom);
  const latest = checks[0];
  const fallback = fallbackIncidentSummary({
    monitorName: monitor.name,
    status: latest?.status ?? incident.failingStatus ?? 0,
    latencyMs: latest?.latencyMs ?? 0,
    errorCode: latest?.errorCode ?? incident.failingErrorCode,
    startedAt: incident.startedAt
  });
  const summary = await runTextAi(env, env.AI_SUMMARY_MODEL ?? "@cf/meta/llama-3.1-8b-instruct", buildIncidentPrompt({ monitor, incident, checks })) ?? fallback;
  const rawSeverity = await runTextAi(env, env.AI_SEVERITY_MODEL ?? "@cf/meta/llama-3.1-8b-instruct", buildSeverityPrompt(summary));
  const durationMinutes = Math.max(0, Math.round((Date.parse(incident.resolvedAt ?? new Date().toISOString()) - Date.parse(incident.startedAt)) / 60000));
  const last5 = checks.slice(0, 5);
  const failureRateLast5 = last5.length ? last5.filter((check) => !check.ok).length / last5.length : 0;
  const fallbackScore = fallbackSeverity({ isOpen: incident.status === "open", durationMinutes, failureRateLast5, errorCode: incident.failingErrorCode, publicMonitor: monitor.public });
  const severity = applySeverityOverrides(parseSeverity(rawSeverity) ?? fallbackScore, { isOpen: incident.status === "open", durationMinutes, failureRateLast5, errorCode: incident.failingErrorCode, publicMonitor: monitor.public });
  await env.DB.prepare(`UPDATE incidents SET ai_summary=?, ai_summary_status=?, ai_severity=?, ai_severity_reason=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`)
    .bind(summary, summary === fallback ? "fallback" : "complete", severity, rawSeverity ?? "fallback rules applied", incident.id, event.workspaceId).run();
  await env.ALERT_QUEUE.send({ eventId: event.eventId, workspaceId: event.workspaceId, eventType: event.type === "incident.resolved" ? "incident.resolved" : "incident.opened", type: "alert.route", monitorId: monitor.id, incidentId: incident.id, severity, summary, createdAt: new Date().toISOString() });
}

async function processAnomaly(env: Env, event: Extract<IncidentQueueEvent, { type: "anomaly.detected" }>) {
  const row = await env.DB.prepare(
    `SELECT a.*, m.id AS monitor_id, m.name, m.url, m.method, m.expected_status_min, m.expected_status_max, m.interval_s, m.timeout_ms, m.active, m.public, m.tags, m.created_at AS monitor_created_at, m.updated_at AS monitor_updated_at
     FROM anomalies a JOIN monitors m ON m.id = a.monitor_id AND m.workspace_id = a.workspace_id WHERE a.id = ? AND a.workspace_id = ? AND m.id = ?`
  ).bind(event.anomalyId, event.workspaceId, event.monitorId).first<Row>();
  if (!row) return;
  const monitor = monitorFrom({ ...row, id: row.monitor_id, created_at: row.monitor_created_at, updated_at: row.monitor_updated_at });
  const fallback = fallbackAnomalyExplanation({ current: Number(row.latency_ms), mean: Number(row.rolling_mean_ms), z: Number(row.z_score) });
  const prompt = buildAnomalyPrompt({ monitor, latencyMs: Number(row.latency_ms), mean: Number(row.rolling_mean_ms), stddev: Number(row.rolling_stddev_ms), zScore: Number(row.z_score) });
  const explanation = await runTextAi(env, env.AI_EXPLAIN_MODEL ?? "@cf/meta/llama-3.1-8b-instruct", prompt) ?? fallback;
  await env.DB.prepare(`UPDATE anomalies SET ai_explanation=?, ai_status=? WHERE id=? AND workspace_id=?`).bind(explanation, explanation === fallback ? "fallback" : "complete", event.anomalyId, event.workspaceId).run();
  await env.ALERT_QUEUE.send({ eventId: event.eventId, workspaceId: event.workspaceId, type: "alert.route", monitorId: event.monitorId, anomalyId: event.anomalyId, severity: 2, summary: explanation, createdAt: new Date().toISOString() });
}

async function handleEvent(env: Env, event: IncidentQueueEvent) {
  if (!event.workspaceId || !event.eventId) throw new Error("Queue event is missing tenant context");
  if (event.type === "incident.opened" || event.type === "incident.created" || event.type === "incident.resolved") await processIncident(env, event);
  if (event.type === "anomaly.detected") await processAnomaly(env, event);
}

export default {
  async queue(batch: MessageBatch<IncidentQueueEvent>, env: Env) {
    for (const message of batch.messages) {
      try {
        await handleEvent(env, message.body);
        message.ack();
      } catch (error) {
        console.log(JSON.stringify({ level: "error", event: "queue.ai.error", message: error instanceof Error ? error.message : "unknown" }));
        message.retry();
      }
    }
  }
};
