import {
  decryptSecret,
  isValidMonitorUrl,
  signWebhook,
  type AlertQueueEvent,
} from "@pulseflare/shared";
export interface Env {
  DB: D1Database;
  SECRET_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  DISCORD_DEFAULT_WEBHOOK?: string;
}
type Row = Record<string, any>;

async function deliver(
  row: Row,
  config: Record<string, string>,
  event: AlertQueueEvent,
  name: string,
) {
  const text = `Pulseflare: ${name}\n${event.summary}\nEvent: ${event.eventId}`;
  let url = config.webhookUrl;
  let payload: unknown = {
    eventId: event.eventId,
    eventType: event.eventType,
    monitorId: event.monitorId,
    incidentId: event.incidentId,
    severity: event.severity,
    summary: event.summary,
    createdAt: event.createdAt,
  };
  if (row.kind === "slack") payload = { text };
  if (row.kind === "discord") payload = { content: text };
  if (row.kind === "telegram") {
    url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    payload = { chat_id: config.chatId, text };
  }
  if (!url || !url.startsWith("https://") || !isValidMonitorUrl(url))
    throw new Error("Invalid notification configuration");
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-pulseflare-event-id": event.eventId,
    "idempotency-key": event.eventId,
  };
  if (row.kind === "webhook" && config.signingSecret) {
    headers["x-pulseflare-timestamp"] = timestamp;
    headers["x-pulseflare-signature"] = await signWebhook(
      timestamp,
      body,
      config.signingSecret,
    );
  }
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers,
    body,
  });
  await response.body?.cancel();
  return response.status;
}

export async function routeAlert(env: Env, event: AlertQueueEvent) {
  if (!event.workspaceId || !event.eventId)
    throw new Error("Queue event is missing tenant context");
  const monitor = event.test
    ? null
    : await env.DB.prepare(
        "SELECT id,name FROM monitors WHERE id=? AND workspace_id=?",
      )
        .bind(event.monitorId, event.workspaceId)
        .first<Row>();
  if (!monitor && !event.test) return;
  if (event.test && !event.integrationId)
    throw new Error("A test requires a target integration");
  const rows = await env.DB.prepare(
    `SELECT i.*,r.event_types,r.monitor_ids,r.minimum_severity,r.enabled AS rule_enabled FROM integrations i LEFT JOIN notification_rules r ON r.integration_id=i.id AND r.workspace_id=i.workspace_id WHERE i.workspace_id=? AND i.enabled=1 AND (? IS NULL OR i.id=?)`,
  )
    .bind(
      event.workspaceId,
      event.integrationId ?? null,
      event.integrationId ?? null,
    )
    .all<Row>();
  let retry = false;
  for (const row of rows.results ?? []) {
    if (!event.test) {
      const types = JSON.parse(row.event_types ?? "[]") as string[];
      const monitors = JSON.parse(row.monitor_ids ?? "[]") as string[];
      if (
        row.rule_enabled === 0 ||
        !types.includes(event.eventType ?? "incident.opened") ||
        (monitors.length && !monitors.includes(event.monitorId)) ||
        (event.eventType !== "incident.resolved" &&
          event.severity < row.minimum_severity)
      )
        continue;
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO notification_deliveries(workspace_id,event_id,integration_id,channel) VALUES(?,?,?,?)",
    )
      .bind(event.workspaceId, event.eventId, row.id, row.kind)
      .run();
    const token = crypto.randomUUID();
    const claim = await env.DB.prepare(
      `UPDATE notification_deliveries SET lease_token=?,lease_until=strftime('%Y-%m-%dT%H:%M:%SZ','now','+1 minute'),attempts=attempts+1,attempted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE event_id=? AND integration_id=? AND workspace_id=? AND status<>'sent' AND status<>'abandoned' AND (lease_until IS NULL OR julianday(lease_until)<julianday('now')) RETURNING *`,
    )
      .bind(token, event.eventId, row.id, event.workspaceId)
      .first<Row>();
    if (!claim) {
      const current = await env.DB.prepare(
        "SELECT status FROM notification_deliveries WHERE event_id=? AND integration_id=? AND workspace_id=?",
      )
        .bind(event.eventId, row.id, event.workspaceId)
        .first<Row>();
      if (current?.status === "pending" || current?.status === "failed")
        retry = true;
      continue;
    }
    let code: number | null = null;
    let error: string | null = null;
    try {
      const config = JSON.parse(
        await decryptSecret(
          {
            ciphertext: row.config_ciphertext,
            iv: row.config_iv,
            version: row.config_version,
          },
          env.SECRET_ENCRYPTION_KEY ?? "",
        ),
      );
      code = await deliver(row, config, event, monitor?.name ?? row.name);
      if (code < 200 || code >= 300) error = `Provider returned HTTP ${code}`;
    } catch {
      error = "Delivery failed. Check provider configuration and connectivity.";
    }
    const transient = error && (code === null || code === 429 || code >= 500);
    const status = !error
      ? "sent"
      : transient && claim.attempts < 5
        ? "failed"
        : "abandoned";
    await env.DB.prepare(
      "UPDATE notification_deliveries SET status=?,response_code=?,error_message=?,lease_until=NULL,lease_token=NULL WHERE event_id=? AND integration_id=? AND workspace_id=? AND lease_token=?",
    )
      .bind(
        status,
        code,
        error,
        event.eventId,
        row.id,
        event.workspaceId,
        token,
      )
      .run();
    if (monitor)
      await env.DB.prepare(
        `INSERT INTO alert_log(workspace_id,event_id,integration_id,incident_id,monitor_id,channel,severity,route_decision,routed,delivery_status,delivery_error,sent_at) VALUES(?,?,?,?,?,?,?,'immediate',1,?,?,?) ON CONFLICT(event_id,integration_id) WHERE event_id IS NOT NULL AND integration_id IS NOT NULL DO UPDATE SET delivery_status=excluded.delivery_status,delivery_error=excluded.delivery_error,sent_at=excluded.sent_at`,
      )
        .bind(
          event.workspaceId,
          event.eventId,
          row.id,
          event.incidentId ?? null,
          event.monitorId,
          row.kind,
          event.severity,
          status,
          error,
          status === "sent" ? new Date().toISOString() : null,
        )
        .run();
    if (status === "failed") retry = true;
  }
  if (retry) throw new Error("Transient delivery failure");
}
export default {
  async queue(batch: MessageBatch<AlertQueueEvent>, env: Env) {
    for (const message of batch.messages) {
      try {
        await routeAlert(env, message.body);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};
