import { isValidMonitorUrl, type AlertQueueEvent } from "@pulseflare/shared";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  DISCORD_DEFAULT_WEBHOOK?: string;
}

type MonitorAlertRow = {
  id: string;
  name: string;
  notify_discord_webhook: string | null;
  notify_telegram_chat_id: string | null;
  notify_generic_webhook: string | null;
};

async function logDecision(env: Env, input: {
  event: AlertQueueEvent;
  channel: string;
  routeDecision: string;
  routed: boolean;
  deliveryStatus: string;
  deliveryError?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO alert_log (workspace_id, event_id, incident_id, anomaly_id, monitor_id, channel, severity, route_decision, routed, delivery_status, delivery_error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.event.workspaceId,
    input.event.eventId,
    input.event.incidentId ?? null,
    input.event.anomalyId ?? null,
    input.event.monitorId,
    input.channel,
    input.event.severity,
    input.routeDecision,
    input.routed ? 1 : 0,
    input.deliveryStatus,
    input.deliveryError ?? null,
    input.deliveryStatus === "sent" ? new Date().toISOString() : null
  ).run();
}

async function postJson(url: string, body: unknown): Promise<string | null> {
  if (!isValidMonitorUrl(url) || !url.startsWith("https://")) return "Blocked webhook target";
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await response.body?.cancel();
  return response.ok ? null : `HTTP ${response.status}`;
}

async function routeAlert(env: Env, event: AlertQueueEvent) {
  if (!event.workspaceId || !event.eventId) throw new Error("Queue event is missing tenant context");
  const monitor = await env.DB.prepare(`SELECT id, name, notify_discord_webhook, notify_telegram_chat_id, notify_generic_webhook FROM monitors WHERE id = ? AND workspace_id = ?`).bind(event.monitorId, event.workspaceId).first<MonitorAlertRow>();
  if (!monitor) return;
  // Recovery notifications must not disappear just because recovery lowers severity.
  const recovery = event.eventType === "incident.resolved";
  const suppressed = !recovery && event.severity <= 1;
  const dashboardOnly = !recovery && event.severity <= 3;
  const message = `Pulseflare alert for ${monitor?.name ?? event.monitorId}\nSeverity: ${event.severity}\n${event.summary}`;

  if (suppressed || dashboardOnly) {
    await logDecision(env, { event, channel: "dashboard", routeDecision: suppressed ? "suppressed" : "dashboard_only", routed: false, deliveryStatus: "skipped" });
    return;
  }

  const discord = monitor.notify_discord_webhook ?? (event.workspaceId === "legacy" ? env.DISCORD_DEFAULT_WEBHOOK : undefined);
  if (discord) {
    const error = await postJson(discord, { content: message });
    await logDecision(env, { event, channel: "discord", routeDecision: "immediate", routed: true, deliveryStatus: error ? "failed" : "sent", deliveryError: error ?? undefined });
  } else {
    await logDecision(env, { event, channel: "discord", routeDecision: "missing_config", routed: false, deliveryStatus: "skipped" });
  }

  if (monitor?.notify_telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const error = await postJson(url, { chat_id: monitor.notify_telegram_chat_id, text: message });
    await logDecision(env, { event, channel: "telegram", routeDecision: "immediate", routed: true, deliveryStatus: error ? "failed" : "sent", deliveryError: error ?? undefined });
  } else {
    await logDecision(env, { event, channel: "telegram", routeDecision: "missing_config", routed: false, deliveryStatus: "skipped" });
  }

  if (monitor?.notify_generic_webhook) {
    const error = await postJson(monitor.notify_generic_webhook, { text: message, severity: event.severity, monitorId: event.monitorId, incidentId: event.incidentId, anomalyId: event.anomalyId });
    await logDecision(env, { event, channel: "webhook", routeDecision: "immediate", routed: true, deliveryStatus: error ? "failed" : "sent", deliveryError: error ?? undefined });
  } else {
    await logDecision(env, { event, channel: "webhook", routeDecision: "missing_config", routed: false, deliveryStatus: "skipped" });
  }
}

export default {
  async queue(batch: MessageBatch<AlertQueueEvent>, env: Env) {
    for (const message of batch.messages) {
      try {
        await routeAlert(env, message.body);
        message.ack();
      } catch (error) {
        console.log(JSON.stringify({ level: "error", event: "alert.failed", message: error instanceof Error ? error.message : "unknown" }));
        message.retry();
      }
    }
  }
};
