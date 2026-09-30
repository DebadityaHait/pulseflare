import { decryptSecret, readJsonPath } from "./security";
import { isValidMonitorUrl } from "./validation";
import { detectLatencyAnomaly } from "./anomaly";
import type { AlertQueueEvent, IncidentQueueEvent } from "./types";

export interface MonitoringEnv {
  DB: D1Database;
  SECRET_ENCRYPTION_KEY?: string;
  INCIDENT_QUEUE?: Queue<IncidentQueueEvent>;
  ALERT_QUEUE?: Queue<AlertQueueEvent>;
}
type Row = Record<string, any>;
export type ProbeResult = {
  status: number;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
  errorMsg?: string;
  responseSizeBytes?: number;
};

export async function probeHttp(
  row: Row,
  masterKey?: string,
): Promise<ProbeResult> {
  if (!isValidMonitorUrl(row.url))
    return {
      status: 0,
      ok: false,
      latencyMs: 0,
      errorCode: "INVALID_URL",
      errorMsg: "Endpoint is blocked",
    };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeout_ms);
  const started = Date.now();
  try {
    const headers = row.headers_ciphertext
      ? JSON.parse(
          await decryptSecret(
            {
              ciphertext: row.headers_ciphertext,
              iv: row.headers_iv,
              version: row.headers_version,
            },
            masterKey ?? "",
          ),
        )
      : {};
    const response = await fetch(row.url, {
      method: row.method,
      headers,
      body: row.method === "POST" ? row.request_body : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    let errorCode: string | undefined;
    if (
      response.status < row.expected_status_min ||
      response.status > row.expected_status_max
    )
      errorCode = "STATUS_MISMATCH";
    let size = Number(response.headers.get("content-length")) || undefined;
    if (
      !errorCode &&
      (row.expected_text || row.forbidden_text || row.json_path)
    ) {
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 262144) {
              errorCode = "BODY_TOO_LARGE";
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      size = length;
      if (!errorCode) {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const body = new TextDecoder().decode(bytes);
        if (row.expected_text && !body.includes(row.expected_text))
          errorCode = "TEXT_MISSING";
        if (row.forbidden_text && body.includes(row.forbidden_text))
          errorCode = "FORBIDDEN_TEXT";
        if (row.json_path) {
          try {
            if (readJsonPath(JSON.parse(body), row.json_path) === undefined)
              errorCode = "JSON_PATH_MISSING";
          } catch {
            errorCode = "INVALID_JSON";
          }
        }
      }
    } else await response.body?.cancel();
    const latencyMs = Date.now() - started;
    return {
      status: response.status,
      ok: !errorCode,
      latencyMs,
      errorCode,
      errorMsg: errorCode
        ? "Response did not satisfy the configured check"
        : undefined,
      responseSizeBytes: size,
    };
  } catch {
    return {
      status: 0,
      ok: false,
      latencyMs: Date.now() - started,
      errorCode: controller.signal.aborted ? "TIMEOUT" : "FETCH_ERROR",
      errorMsg: controller.signal.aborted
        ? "Request timed out"
        : "Endpoint request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Persisted in the same transaction as the incident; notifications and AI have
// independent dispatch flags, so enrichment cannot delay alerts.
export function incidentOutbox(
  db: D1Database,
  monitorId: string,
  workspaceId: string,
  kind: "opened" | "resolved",
  now: string,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO event_outbox(event_id,workspace_id,payload)
    SELECT i.id || ':${kind}', i.workspace_id,
      json_object('eventId',i.id || ':${kind}','workspaceId',i.workspace_id,'type','incident.${kind}',
      'monitorId',i.monitor_id,'incidentId',i.id,'checkId',COALESCE(i.${kind === "opened" ? "trigger" : "recovery"}_check_id,0),'createdAt',?)
    FROM incidents i WHERE i.monitor_id=? AND i.workspace_id=? AND ${kind === "opened" ? "i.status<>'resolved'" : "i.status='resolved' AND i.resolved_at=?"}`,
    )
    .bind(now, monitorId, workspaceId, ...(kind === "resolved" ? [now] : []));
}

export async function flushOutbox(env: MonitoringEnv) {
  const rows = await env.DB.prepare(
    "SELECT * FROM event_outbox WHERE event_id IN (SELECT event_id FROM event_outbox WHERE alert_sent=0 UNION SELECT event_id FROM event_outbox WHERE ai_sent=0) ORDER BY alert_sent,created_at LIMIT 50",
  ).all<Row>();
  for (const row of rows.results ?? []) {
    const event = JSON.parse(row.payload) as IncidentQueueEvent;
    if (!row.alert_sent && env.ALERT_QUEUE) {
      try {
        const opened = event.type !== "incident.resolved";
        await env.ALERT_QUEUE.send({
          ...event,
          type: "notification.route",
          eventType: opened ? "incident.opened" : "incident.resolved",
          severity: opened ? 5 : 1,
          summary: opened
            ? "A confirmed monitoring failure was detected. Open Pulseflare for the check evidence."
            : "The monitor recovered. The incident has been resolved.",
        });
        await env.DB.prepare(
          "UPDATE event_outbox SET alert_sent=1 WHERE event_id=?",
        )
          .bind(event.eventId)
          .run();
      } catch {
        console.log(
          JSON.stringify({
            event: "outbox.alert.retry",
            eventId: event.eventId,
          }),
        );
      }
    }
    if (!row.ai_sent && env.INCIDENT_QUEUE) {
      try {
        await env.INCIDENT_QUEUE.send(event);
        await env.DB.prepare(
          "UPDATE event_outbox SET ai_sent=1 WHERE event_id=?",
        )
          .bind(event.eventId)
          .run();
      } catch {
        console.log(
          JSON.stringify({ event: "outbox.ai.retry", eventId: event.eventId }),
        );
      }
    }
  }
}

export async function runHttpMonitor(
  env: MonitoringEnv,
  id: string,
  workspaceId: string,
  manual = false,
) {
  const token = crypto.randomUUID();
  const row = await env.DB.prepare(
    `UPDATE monitors SET check_lease_token=?,check_lease_until=strftime('%Y-%m-%dT%H:%M:%SZ','now','+2 minutes')
    WHERE id=? AND workspace_id=? AND active=1 AND monitor_type='http'
    AND (check_lease_until IS NULL OR julianday(check_lease_until)<julianday('now'))
    AND (?=1 OR last_checked_at IS NULL OR julianday(last_checked_at)<=julianday('now')-MAX(interval_s,300)/86400.0) RETURNING *`,
  )
    .bind(token, id, workspaceId, manual ? 1 : 0)
    .first<Row>();
  if (!row) return false;
  const result = await probeHttp(row, env.SECRET_ENCRYPTION_KEY);
  const now = new Date().toISOString();
  const previous = await env.DB.prepare(
    "SELECT ok,latency_ms FROM checks WHERE monitor_id=? AND workspace_id=? ORDER BY checked_at DESC,id DESC LIMIT 20",
  )
    .bind(id, workspaceId)
    .all<{ ok: number; latency_ms: number }>();
  const anomaly = result.ok
    ? detectLatencyAnomaly(
        (previous.results ?? [])
          .filter((x) => x.ok === 1)
          .map((x) => x.latency_ms)
          .reverse(),
        result.latencyMs,
      )
    : { anomalous: false };
  const failures = result.ok ? 0 : Number(row.consecutive_failures) + 1;
  const slow =
    result.ok &&
    ((row.latency_threshold_ms &&
      result.latencyMs > row.latency_threshold_ms) ||
      anomaly.anomalous);
  const state = result.ok
    ? slow
      ? "degraded"
      : "up"
    : failures >= 2
      ? "down"
      : "pending_down";
  const guard = `SELECT id FROM monitors WHERE id=? AND workspace_id=? AND active=1 AND check_lease_token=?`;
  const lastCheck = `(SELECT id FROM checks WHERE monitor_id=? AND workspace_id=? ORDER BY checked_at DESC,id DESC LIMIT 1)`;
  const statements = [
    env.DB.prepare(
      `INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,error_code,error_msg,response_size_bytes,state,confirmation,checked_at)
      SELECT workspace_id,id,?,?,?,?,?,?,?,?,? FROM monitors WHERE id=? AND workspace_id=? AND active=1 AND check_lease_token=?`,
    ).bind(
      result.status,
      result.ok ? 1 : 0,
      result.latencyMs,
      result.errorCode ?? null,
      result.errorMsg ?? null,
      result.responseSizeBytes ?? null,
      state,
      failures >= 2 ? 1 : 0,
      now,
      id,
      workspaceId,
      token,
    ),
  ];
  if (state === "down")
    statements.push(
      env.DB.prepare(
        `INSERT INTO incidents(workspace_id,monitor_id,type,status,started_at,trigger_check_id,failing_status,failing_error_code)
    SELECT workspace_id,id,'outage','open',?,${lastCheck},?,? FROM monitors WHERE id IN (${guard}) AND NOT EXISTS(SELECT 1 FROM incidents WHERE monitor_id=? AND workspace_id=? AND status<>'resolved')`,
      ).bind(
        now,
        id,
        workspaceId,
        result.status,
        result.errorCode ?? null,
        id,
        workspaceId,
        token,
        id,
        workspaceId,
      ),
    );
  if (result.ok)
    statements.push(
      env.DB.prepare(
        `UPDATE incidents SET status='resolved',resolved_at=?,recovery_check_id=${lastCheck},updated_at=? WHERE monitor_id=? AND workspace_id=? AND status<>'resolved' AND monitor_id IN (${guard})`,
      ).bind(
        now,
        id,
        workspaceId,
        now,
        id,
        workspaceId,
        id,
        workspaceId,
        token,
      ),
    );
  statements.push(
    incidentOutbox(env.DB, id, workspaceId, "opened", now),
    incidentOutbox(env.DB, id, workspaceId, "resolved", now),
  );
  statements.push(
    env.DB.prepare(
      `UPDATE monitors SET last_checked_at=?,last_check_id=${lastCheck},last_state=?,consecutive_failures=?,check_lease_token=NULL,check_lease_until=NULL WHERE id=? AND workspace_id=? AND active=1 AND check_lease_token=?`,
    ).bind(now, id, workspaceId, state, failures, id, workspaceId, token),
  );
  await env.DB.batch(statements);
  return true;
}

export async function recordHeartbeat(env: MonitoringEnv, secretHash: string) {
  const now = new Date().toISOString();
  const guard = `SELECT id FROM monitors WHERE monitor_type='heartbeat' AND active=1 AND heartbeat_secret_hash=?`;
  const row = await env.DB.prepare(
    `SELECT id,workspace_id FROM monitors WHERE id IN (${guard})`,
  )
    .bind(secretHash)
    .first<Row>();
  if (!row) return null;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,state,checked_at) SELECT workspace_id,id,200,1,0,'up',? FROM monitors WHERE id IN (${guard})`,
    ).bind(now, secretHash),
    env.DB.prepare(
      `UPDATE incidents SET status='resolved',resolved_at=?,updated_at=?,recovery_check_id=(SELECT id FROM checks WHERE monitor_id=incidents.monitor_id AND workspace_id=incidents.workspace_id ORDER BY checked_at DESC,id DESC LIMIT 1) WHERE monitor_id IN (${guard}) AND workspace_id=? AND status<>'resolved'`,
    ).bind(now, now, secretHash, row.workspace_id),
    incidentOutbox(env.DB, row.id, row.workspace_id, "resolved", now),
    env.DB.prepare(
      `UPDATE monitors SET heartbeat_last_at=?,heartbeat_deadline_at=strftime('%Y-%m-%dT%H:%M:%SZ',?,'+' || (heartbeat_expected_s+COALESCE(heartbeat_grace_s,0)) || ' seconds'),last_checked_at=?,last_state='up',consecutive_failures=0,last_check_id=(SELECT id FROM checks WHERE monitor_id=monitors.id AND workspace_id=monitors.workspace_id ORDER BY checked_at DESC,id DESC LIMIT 1) WHERE id IN (${guard}) RETURNING id`,
    ).bind(now, now, now, secretHash),
  ]);
  return results[3].results?.length
    ? { accepted: true, receivedAt: now }
    : null;
}

export async function checkHeartbeatDeadlines(env: MonitoringEnv) {
  const now = new Date().toISOString();
  const expired = `monitor_type='heartbeat' AND active=1 AND julianday(heartbeat_deadline_at)<=julianday(?) AND last_state<>'down'`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,state,error_code,error_msg,checked_at) SELECT workspace_id,id,0,0,0,'down','HEARTBEAT_MISSED','Expected heartbeat was not received within its grace period',? FROM monitors WHERE ${expired}`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT INTO incidents(workspace_id,monitor_id,type,status,started_at,trigger_check_id,failing_error_code)
      SELECT workspace_id,id,'outage','open',?,(SELECT id FROM checks WHERE monitor_id=monitors.id AND workspace_id=monitors.workspace_id ORDER BY checked_at DESC,id DESC LIMIT 1),'HEARTBEAT_MISSED' FROM monitors WHERE ${expired} AND NOT EXISTS(SELECT 1 FROM incidents WHERE monitor_id=monitors.id AND workspace_id=monitors.workspace_id AND status<>'resolved')`,
    ).bind(now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO event_outbox(event_id,workspace_id,payload)
      SELECT i.id || ':opened',i.workspace_id,json_object('eventId',i.id || ':opened','workspaceId',i.workspace_id,'type','incident.opened','monitorId',i.monitor_id,'incidentId',i.id,'checkId',i.trigger_check_id,'createdAt',?)
      FROM incidents i JOIN monitors m ON m.id=i.monitor_id AND m.workspace_id=i.workspace_id WHERE m.monitor_type='heartbeat' AND i.status<>'resolved'`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE monitors SET last_state='down',last_checked_at=?,last_check_id=(SELECT id FROM checks WHERE monitor_id=monitors.id AND workspace_id=monitors.workspace_id ORDER BY checked_at DESC,id DESC LIMIT 1) WHERE ${expired}`,
    ).bind(now, now),
  ]);
}
