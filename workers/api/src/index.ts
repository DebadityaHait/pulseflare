import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  createMonitorSchema,
  paginationSchema,
  settingsSchema,
  updateMonitorSchema,
  uptimePercent,
  type AlertQueueEvent,
  type LatestStatus,
  type Monitor
} from "@pulseflare/shared";

export interface Env {
  DB: D1Database;
  STATUS_KV: KVNamespace;
  ALERT_QUEUE: Queue<AlertQueueEvent>;
  ARCHIVE_BUCKET?: R2Bucket;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

type Variables = { isAdmin: boolean };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type MonitorRow = {
  id: string; name: string; url: string; method: "GET" | "HEAD" | "POST"; expected_status_min: number; expected_status_max: number;
  interval_s: number; timeout_ms: number; active: number; public: number; tags: string; notify_discord_webhook: string | null;
  notify_telegram_chat_id: string | null; notify_generic_webhook: string | null; created_at: string; updated_at: string;
};

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function mapMonitor(row: MonitorRow, includeSecrets = false): Monitor {
  const base = {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return includeSecrets ? {
    ...base,
    notifyDiscordWebhook: row.notify_discord_webhook,
    notifyTelegramChatId: row.notify_telegram_chat_id,
    notifyGenericWebhook: row.notify_generic_webhook
  } : base;
}

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

async function parseJson(c: AppContext) {
  try {
    return await c.req.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function requireAdmin(c: AppContext, next: Next) {
  if (c.req.path === "/api/health" || c.req.path === "/api/status" || c.req.path === "/api/status/history") return next();
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== c.env.ADMIN_TOKEN) return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid admin token" } }, 401);
  await next();
}

app.use("*", async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN || "*";
  return cors({ origin, allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] })(c, next);
});
app.use("/api/*", requireAdmin);

app.get("/api/health", (c) => c.json(ok({ name: "Pulseflare API", status: "ok", checkedAt: new Date().toISOString() })));

app.get("/api/status", async (c) => {
  const config = await c.env.DB.prepare(`SELECT * FROM public_status_config WHERE id = 'default'`).first<{ page_title: string; page_description: string; updated_at: string }>();
  const rows = await c.env.DB.prepare(`SELECT * FROM monitors WHERE active = 1 AND public = 1 ORDER BY name ASC`).all<MonitorRow>();
  const monitors = await Promise.all((rows.results ?? []).map(async (row) => {
    const latest = await c.env.STATUS_KV.get<LatestStatus>(`latest_status:${row.id}`, "json");
    const checks = await c.env.DB.prepare(`SELECT ok FROM checks WHERE monitor_id = ? AND checked_at >= datetime('now', '-1 day')`).bind(row.id).all<{ ok: number }>();
    return {
      id: row.id,
      name: row.name,
      state: latest?.state ?? "unknown",
      status: latest?.status ?? 0,
      latencyMs: latest?.latencyMs ?? 0,
      uptime24h: uptimePercent((checks.results ?? []).map((item) => ({ ok: item.ok === 1 }))),
      checkedAt: latest?.checkedAt ?? null
    };
  }));
  const incidents = await c.env.DB.prepare(
    `SELECT i.id, i.monitor_id, m.name AS monitor_name, i.started_at, i.ai_summary, i.ai_severity
     FROM incidents i JOIN monitors m ON m.id = i.monitor_id
     WHERE i.status = 'open' AND m.public = 1 ORDER BY i.started_at DESC`
  ).all();
  const overallState = monitors.some((monitor) => monitor.state === "down") ? "major_outage" : monitors.some((monitor) => monitor.state === "degraded") ? "degraded" : "operational";
  return c.json(ok({
    page: {
      title: config?.page_title ?? "Pulseflare Status",
      description: config?.page_description ?? "Current system status and recent incidents.",
      updatedAt: config?.updated_at ?? new Date().toISOString()
    },
    overallState,
    monitors,
    activeIncidents: incidents.results ?? []
  }));
});

app.get("/api/status/history", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.monitor_id, m.name AS monitor_name, i.status, i.started_at, i.resolved_at, i.ai_summary, i.ai_severity
     FROM incidents i JOIN monitors m ON m.id = i.monitor_id
     WHERE m.public = 1 ORDER BY i.started_at DESC LIMIT 50`
  ).all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/monitors", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM monitors ORDER BY created_at DESC`).all<MonitorRow>();
  return c.json(ok((rows.results ?? []).map((row) => mapMonitor(row, true))));
});

app.post("/api/monitors", async (c) => {
  try {
    const input = createMonitorSchema.parse(await parseJson(c));
    const row = await c.env.DB.prepare(
      `INSERT INTO monitors (name, url, method, expected_status_min, expected_status_max, timeout_ms, public, tags, notify_discord_webhook, notify_telegram_chat_id, notify_generic_webhook)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(
      input.name, input.url, input.method, input.expectedStatusMin, input.expectedStatusMax, input.timeoutMs, input.public ? 1 : 0,
      JSON.stringify(input.tags), input.notifyDiscordWebhook ?? null, input.notifyTelegramChatId ?? null, input.notifyGenericWebhook ?? null
    ).first<MonitorRow>();
    return c.json(ok(mapMonitor(row!, true)), 201);
  } catch (error) {
    return fail("VALIDATION_ERROR", error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload" : error instanceof Error ? error.message : "Invalid payload");
  }
});

app.get("/api/monitors/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM monitors WHERE id = ?`).bind(c.req.param("id")).first<MonitorRow>();
  if (!row) return fail("NOT_FOUND", "Monitor not found", 404);
  const latest = await c.env.STATUS_KV.get<LatestStatus>(`latest_status:${row.id}`, "json");
  return c.json(ok({ ...mapMonitor(row, true), latest }));
});

app.patch("/api/monitors/:id", async (c) => {
  try {
    const input = updateMonitorSchema.parse(await parseJson(c));
    const existing = await c.env.DB.prepare(`SELECT * FROM monitors WHERE id = ?`).bind(c.req.param("id")).first<MonitorRow>();
    if (!existing) return fail("NOT_FOUND", "Monitor not found", 404);
    const merged = { ...mapMonitor(existing, true), ...input };
    const row = await c.env.DB.prepare(
      `UPDATE monitors SET name=?, url=?, method=?, expected_status_min=?, expected_status_max=?, timeout_ms=?, public=?, tags=?, notify_discord_webhook=?, notify_telegram_chat_id=?, notify_generic_webhook=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? RETURNING *`
    ).bind(merged.name, merged.url, merged.method, merged.expectedStatusMin, merged.expectedStatusMax, merged.timeoutMs, merged.public ? 1 : 0, JSON.stringify(merged.tags), merged.notifyDiscordWebhook ?? null, merged.notifyTelegramChatId ?? null, merged.notifyGenericWebhook ?? null, existing.id).first<MonitorRow>();
    return c.json(ok(mapMonitor(row!, true)));
  } catch (error) {
    return fail("VALIDATION_ERROR", error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload" : "Invalid payload");
  }
});

app.delete("/api/monitors/:id", async (c) => {
  await c.env.DB.prepare(`UPDATE monitors SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(c.req.param("id")).run();
  return c.json(ok({ disabled: true }));
});

app.get("/api/monitors/:id/checks", async (c) => {
  const page = paginationSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const rows = await c.env.DB.prepare(`SELECT * FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?`).bind(c.req.param("id"), page.limit, page.offset).all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/monitors/:id/incidents", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 100`).bind(c.req.param("id")).all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/incidents", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT i.*, m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id = i.monitor_id ORDER BY i.started_at DESC LIMIT 100`).all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/incidents/:id", async (c) => {
  const incident = await c.env.DB.prepare(`SELECT i.*, m.name AS monitor_name, m.url FROM incidents i JOIN monitors m ON m.id = i.monitor_id WHERE i.id = ?`).bind(c.req.param("id")).first();
  if (!incident) return fail("NOT_FOUND", "Incident not found", 404);
  const checks = await c.env.DB.prepare(`SELECT * FROM checks WHERE monitor_id = (SELECT monitor_id FROM incidents WHERE id = ?) ORDER BY checked_at DESC LIMIT 50`).bind(c.req.param("id")).all();
  const alerts = await c.env.DB.prepare(`SELECT * FROM alert_log WHERE incident_id = ? ORDER BY created_at DESC`).bind(c.req.param("id")).all();
  return c.json(ok({ incident, checks: checks.results ?? [], alerts: alerts.results ?? [] }));
});

app.post("/api/incidents/:id/resolve", async (c) => {
  const now = new Date().toISOString();
  await c.env.DB.prepare(`UPDATE incidents SET status='resolved', resolved_at=?, updated_at=? WHERE id=? AND status='open'`).bind(now, now, c.req.param("id")).run();
  return c.json(ok({ resolved: true, resolvedAt: now }));
});

app.get("/api/anomalies", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT a.*, m.name AS monitor_name FROM anomalies a JOIN monitors m ON m.id = a.monitor_id ORDER BY a.created_at DESC LIMIT 100`).all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/stats", async (c) => {
  const monitors = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM monitors WHERE active = 1`).first<{ count: number }>();
  const openIncidents = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM incidents WHERE status = 'open'`).first<{ count: number }>();
  const checks = await c.env.DB.prepare(`SELECT ok, latency_ms FROM checks WHERE checked_at >= datetime('now', '-1 day')`).all<{ ok: number; latency_ms: number }>();
  const latencies = (checks.results ?? []).map((row) => row.latency_ms);
  return c.json(ok({
    activeMonitors: monitors?.count ?? 0,
    openIncidents: openIncidents?.count ?? 0,
    uptime24h: uptimePercent((checks.results ?? []).map((row) => ({ ok: row.ok === 1 }))),
    avgLatency24h: latencies.length ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / latencies.length) : 0,
    lastCheckerRun: await c.env.STATUS_KV.get("diagnostics:last_checker_run")
  }));
});

app.post("/api/test-alert", async (c) => {
  await c.env.ALERT_QUEUE.send({ type: "alert.route", monitorId: "test", severity: 4, summary: "Pulseflare test alert", createdAt: new Date().toISOString() });
  return c.json(ok({ queued: true }));
});

app.get("/api/settings", async (c) => {
  const config = await c.env.DB.prepare(`SELECT * FROM public_status_config WHERE id = 'default'`).first();
  const rows = await c.env.DB.prepare(`SELECT key, value, updated_at FROM settings`).all();
  return c.json(ok({ publicStatus: config, settings: rows.results ?? [] }));
});

app.patch("/api/settings", async (c) => {
  try {
    const input = settingsSchema.parse(await parseJson(c));
    const existing = await c.env.DB.prepare(`SELECT * FROM public_status_config WHERE id='default'`).first<{ page_title: string; page_description: string; brand_color: string; show_history_days: number }>();
    await c.env.DB.prepare(
      `UPDATE public_status_config SET page_title=?, page_description=?, brand_color=?, show_history_days=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id='default'`
    ).bind(input.pageTitle ?? existing?.page_title ?? "Pulseflare Status", input.pageDescription ?? existing?.page_description ?? "", input.brandColor ?? existing?.brand_color ?? "#f6821f", input.showHistoryDays ?? existing?.show_history_days ?? 7).run();
    return c.json(ok({ updated: true }));
  } catch (error) {
    return fail("VALIDATION_ERROR", error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload" : "Invalid payload");
  }
});

app.post("/api/archive", async (c) => {
  if (!c.env.ARCHIVE_BUCKET) return fail("R2_UNAVAILABLE", "R2 is not enabled or ARCHIVE_BUCKET is not configured", 503);
  const until = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await c.env.DB.prepare(`SELECT * FROM checks WHERE checked_at < ? ORDER BY checked_at ASC LIMIT 10000`).bind(until).all();
  const body = (rows.results ?? []).map((row) => JSON.stringify(row)).join("\n");
  const key = `checks/manual-${new Date().toISOString().slice(0, 10)}.ndjson`;
  await c.env.ARCHIVE_BUCKET.put(key, body, { httpMetadata: { contentType: "application/x-ndjson" } });
  return c.json(ok({ key, rows: rows.results?.length ?? 0, deleted: false }));
});

app.notFound(() => fail("NOT_FOUND", "Route not found", 404));
app.onError((error) => {
  console.log(JSON.stringify({ level: "error", event: "api.error", message: error.message }));
  return fail("INTERNAL_ERROR", "Unexpected server error", 500);
});

export default app;
