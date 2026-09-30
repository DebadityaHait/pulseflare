import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { d1 } from "./d1";
import api, { type Env } from "../workers/api/src/index";
import {
  checkHeartbeatDeadlines,
  recordHeartbeat,
  runHttpMonitor,
  flushOutbox,
  encryptSecret,
  sha256Hex,
  probeHttp,
  type AlertQueueEvent,
} from "@pulseflare/shared";
import { routeAlert } from "../workers/alert/src/index";
import ai from "../workers/ai/src/index";
import { runScheduled } from "../workers/checker/src/index";

let db: DatabaseSync;
let env: Env;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const file of ["0001_schema.sql", "0002_v2.sql", "0003_mvp.sql", "0004_free_tier_budget.sql", "0005_incident_chat.sql", "0006_product_tools.sql"])
    db.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  env = {
    DB: d1(db),
    DEV_AUTH_BYPASS: "true",
    SECRET_ENCRYPTION_KEY: "test-encryption-key",
    ALERT_QUEUE: { send: vi.fn() } as unknown as Queue<AlertQueueEvent>,
    INCIDENT_QUEUE: { send: vi.fn() } as unknown as Env["INCIDENT_QUEUE"],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('{"status":"healthy"}', { status: 200 })),
  );
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function request(path: string, method = "GET", body?: unknown) {
  return api.request(
    `http://localhost${path}`,
    {
      method,
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
    env,
  );
}
async function heartbeat() {
  const r = await request("/api/monitors", "POST", {
    name: "Backup",
    type: "heartbeat",
    heartbeatExpectedS: 60,
    heartbeatGraceS: 30,
  });
  expect(r.status).toBe(201);
  return (await r.json()).data;
}
async function http(extra = {}) {
  const r = await request("/api/monitors", "POST", {
    name: "API",
    url: "https://example.com",
    ...extra,
  });
  expect(r.status).toBe(201);
  return (await r.json()).data.monitor;
}

describe("heartbeat lifecycle", () => {
  it("creates without a URL and only reveals the full secret once", async () => {
    const h = await heartbeat();
    expect(h.heartbeatUrl).toContain("/api/heartbeat/hb_");
    expect(
      JSON.stringify(
        (await (await request(`/api/monitors/${h.monitor.id}`)).json()).data,
      ),
    ).not.toContain(h.heartbeatSecret);
    expect(
      await recordHeartbeat(env, await sha256Hex(h.heartbeatSecret)),
    ).toMatchObject({ accepted: true });
    expect(
      db.prepare("SELECT last_state FROM monitors WHERE id=?").get(h.monitor.id)
        ?.last_state,
    ).toBe("up");
  });
  it("waits through the grace window, opens once, and resolves on GET or POST", async () => {
    const h = await heartbeat();
    await checkHeartbeatDeadlines(env);
    expect(
      db.prepare("SELECT COUNT(*) count FROM incidents").get()?.count,
    ).toBe(0);
    db.prepare(
      "UPDATE monitors SET heartbeat_deadline_at='2020-01-01T00:00:00Z' WHERE id=?",
    ).run(h.monitor.id);
    await Promise.all([
      checkHeartbeatDeadlines(env),
      checkHeartbeatDeadlines(env),
    ]);
    expect(
      db.prepare("SELECT COUNT(*) count FROM incidents").get()?.count,
    ).toBe(1);
    await flushOutbox(env);
    expect(env.ALERT_QUEUE?.send).toHaveBeenCalledTimes(1);
    expect((await request(`/api/heartbeat/${h.heartbeatSecret}`)).status).toBe(
      200,
    );
    expect(
      (await request(`/api/heartbeat/${h.heartbeatSecret}`, "POST")).status,
    ).toBe(200);
    expect(db.prepare("SELECT status FROM incidents").get()?.status).toBe(
      "resolved",
    );
    expect(env.ALERT_QUEUE?.send).toHaveBeenCalledTimes(2);
  });
  it("a recent ping cannot produce a stale missed incident", async () => {
    const h = await heartbeat();
    db.prepare(
      "UPDATE monitors SET heartbeat_deadline_at='2020-01-01T00:00:00Z' WHERE id=?",
    ).run(h.monitor.id);
    await recordHeartbeat(env, await sha256Hex(h.heartbeatSecret));
    await checkHeartbeatDeadlines(env);
    expect(
      db.prepare("SELECT COUNT(*) count FROM incidents").get()?.count,
    ).toBe(0);
  });
  it("rotation rejects the old URL, pause rejects pings, and resume gives a fresh deadline", async () => {
    const h = await heartbeat();
    const r = await request(
      `/api/monitors/${h.monitor.id}/rotate-secret`,
      "POST",
    );
    const { heartbeatUrl } = (await r.json()).data;
    expect((await request(`/api/heartbeat/${h.heartbeatSecret}`)).status).toBe(
      404,
    );
    await request(`/api/monitors/${h.monitor.id}/pause`, "POST");
    expect((await api.request(heartbeatUrl, {}, env)).status).toBe(404);
    await request(`/api/monitors/${h.monitor.id}/resume`, "POST");
    await checkHeartbeatDeadlines(env);
    expect(
      db.prepare("SELECT COUNT(*) count FROM incidents").get()?.count,
    ).toBe(0);
    expect((await api.request(heartbeatUrl, {}, env)).status).toBe(200);
  });
});
describe("HTTP execution and reliability", () => {
  it("exposes observed table metrics and leaves unchecked monitors empty", async () => {
    const m = await http();
    const empty = (await (await request("/api/monitors")).json()).data[0];
    expect(empty).toMatchObject({ uptime24h: null, latestLatencyMs: null });
    await runHttpMonitor(env, m.id, "legacy", true);
    const observed = (await (await request("/api/monitors")).json()).data[0];
    expect(observed.uptime24h).toBe(100);
    expect(observed.latestLatencyMs).toBeTypeOf("number");
    db.prepare("UPDATE checks SET checked_at='2020-01-01T00:00:00Z'").run();
    expect(
      (await (await request("/api/monitors")).json()).data[0].uptime24h,
    ).toBeNull();
  });
  it("hides expired raw evidence and deletes it without losing incident lifecycle", async () => {
    const m = await http();
    await request(`/api/monitors/${m.id}/pause`, "POST");
    const check = db
      .prepare(
        "INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,checked_at) VALUES('legacy',?,503,0,12,'2020-01-01T00:00:00Z') RETURNING id",
      )
      .get(m.id)!;
    db.prepare(
      "INSERT INTO incidents(id,workspace_id,monitor_id,started_at,status,trigger_check_id) VALUES('old','legacy',?,'2020-01-01T00:00:00Z','resolved',?)",
    ).run(m.id, check.id);
    expect(
      (await (await request(`/api/monitors/${m.id}/checks`)).json()).data,
    ).toEqual([]);
    expect(
      (await (await request(`/api/monitors/${m.id}/stats?days=90`)).json())
        .data,
    ).toMatchObject({ days: 7, checks: 0, uptime: null });
    const now = new Date();
    now.setUTCMinutes(0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await runScheduled(env);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM checks").get()?.count,
    ).toBe(0);
    expect(
      db
        .prepare("SELECT status,trigger_check_id FROM incidents WHERE id='old'")
        .get(),
    ).toEqual({ status: "resolved", trigger_check_id: null });
  });
  it("discards an in-flight observation after a monitor edit", async () => {
    const m = await http();
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = runHttpMonitor(env, m.id, "legacy", true);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await request(`/api/monitors/${m.id}`, "PATCH", {
      name: "Changed",
      expectedText: "different",
    });
    release(new Response("old response"));
    await running;
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM checks").get()?.count,
    ).toBe(0);
  });
  it("executes encrypted headers, text and JSON assertions", async () => {
    const m = await http({
      headers: { Authorization: "Bearer secret" },
      expectedText: "healthy",
      jsonPath: "$.status",
    });
    await runHttpMonitor(env, m.id, "legacy", true);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: { Authorization: "Bearer secret" } }),
    );
    expect(db.prepare("SELECT ok FROM checks").get()?.ok).toBe(1);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"status":"broken"}', { status: 200 }),
    );
    await runHttpMonitor(env, m.id, "legacy", true);
    expect(
      db.prepare("SELECT error_code FROM checks ORDER BY id DESC").get()
        ?.error_code,
    ).toBe("TEXT_MISSING");
  });
  it("bounds assertion bodies and rejects missing JSON paths", async () => {
    const m = await http({ jsonPath: "$.status" });
    const row = db.prepare("SELECT * FROM monitors WHERE id=?").get(m.id)!;
    vi.mocked(fetch).mockResolvedValueOnce(new Response("x".repeat(262145)));
    expect((await probeHttp(row)).errorCode).toBe("BODY_TOO_LARGE");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}"));
    expect((await probeHttp(row)).errorCode).toBe("JSON_PATH_MISSING");
  });
  it("claims a check once across overlapping ticks", async () => {
    const m = await http();
    await Promise.all([
      runHttpMonitor(env, m.id, "legacy"),
      runHttpMonitor(env, m.id, "legacy"),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT COUNT(*) count FROM checks").get()?.count).toBe(
      1,
    );
  });
  it("keeps queue events durable and dispatches alerts when AI queue fails", async () => {
    const m = await http();
    vi.mocked(fetch).mockImplementation(
      async () => new Response("Unavailable", { status: 503 }),
    );
    await runHttpMonitor(env, m.id, "legacy", true);
    expect(
      db.prepare("SELECT COUNT(*) count FROM incidents").get()?.count,
    ).toBe(0);
    await runHttpMonitor(env, m.id, "legacy", true);
    vi.mocked(env.INCIDENT_QUEUE!.send).mockRejectedValue(
      new Error("AI queue unavailable"),
    );
    await flushOutbox(env);
    await flushOutbox(env);
    expect(env.ALERT_QUEUE?.send).toHaveBeenCalledTimes(1);
    expect(
      db.prepare("SELECT alert_sent,ai_sent FROM event_outbox").get(),
    ).toEqual({ alert_sent: 1, ai_sent: 0 });
  });
  it("deletes monitor evidence and enforces active quotas", async () => {
    const m = await http();
    await runHttpMonitor(env, m.id, "legacy");
    expect((await request(`/api/monitors/${m.id}`, "DELETE")).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) count FROM checks").get()?.count).toBe(
      0,
    );
    for (let i = 0; i < 5; i++) await http();
    expect(
      (
        await request("/api/monitors", "POST", {
          name: "Sixth",
          url: "https://example.com",
        })
      ).status,
    ).toBe(429);
  });
});
describe("integrations and public sharing", () => {
  it("preserves unspecified notification filters during partial edits", async () => {
    const m = await http();
    const result = await request("/api/integrations", "POST", {
      name: "Rules",
      kind: "webhook",
      config: { webhookUrl: "https://example.com/hook" },
      monitorIds: [m.id],
      eventTypes: ["incident.opened"],
      minimumSeverity: 4,
    });
    const id = (await result.json()).data.id;
    await request(`/api/integrations/${id}`, "PATCH", { minimumSeverity: 2 });
    expect(
      db
        .prepare(
          "SELECT event_types,monitor_ids,minimum_severity FROM notification_rules WHERE integration_id=?",
        )
        .get(id),
    ).toEqual({
      event_types: '["incident.opened"]',
      monitor_ids: JSON.stringify([m.id]),
      minimum_severity: 2,
    });
  });
  it("targets one integration, signs webhooks, and skips duplicate successful deliveries", async () => {
    const m = await http();
    const c = await request("/api/integrations", "POST", {
      kind: "webhook",
      name: "Engineering",
      config: { webhookUrl: "https://example.com/hook", signingSecret: "sign" },
    });
    const id = (await c.json()).data.id;
    await request("/api/integrations", "POST", {
      kind: "webhook",
      name: "Other",
      config: { webhookUrl: "https://example.com/other" },
    });
    const event: AlertQueueEvent = {
      eventId: "test-1",
      workspaceId: "legacy",
      type: "notification.route",
      eventType: "incident.opened",
      monitorId: m.id,
      integrationId: id,
      test: true,
      severity: 5,
      summary: "Test",
      createdAt: new Date().toISOString(),
    };
    await routeAlert(env, event);
    await routeAlert(env, event);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-pulseflare-signature": expect.stringContaining("sha256="),
        }),
      }),
    );
    expect(
      db.prepare("SELECT status,attempts FROM notification_deliveries").get(),
    ).toEqual({ status: "sent", attempts: 1 });
  });
  it("records transient failures and retries without resending successful integrations", async () => {
    const m = await http();
    for (const name of ["one", "two"])
      await request("/api/integrations", "POST", {
        kind: "webhook",
        name,
        config: { webhookUrl: `https://example.com/${name}` },
      });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("OK"))
      .mockResolvedValueOnce(new Response("Busy", { status: 503 }));
    const event: AlertQueueEvent = {
      eventId: "event",
      workspaceId: "legacy",
      type: "notification.route",
      eventType: "incident.opened",
      monitorId: m.id,
      severity: 5,
      summary: "Test",
      createdAt: new Date().toISOString(),
    };
    await expect(routeAlert(env, event)).rejects.toThrow("Transient");
    await routeAlert(env, event);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM notification_deliveries WHERE status='sent'",
        )
        .get()?.count,
    ).toBe(2);
  });
  it("public pages show only selected public monitors and explicit public incident messages", async () => {
    const m = await http({ public: true });
    await http({ name: "Not selected", public: true });
    const p = (await (await request("/api/status-pages")).json()).data[0];
    await request(`/api/status-pages/${p.id}`, "PATCH", {
      slug: "my-service",
      title: "Service status",
    });
    await request(`/api/status-pages/${p.id}/monitors`, "PUT", {
      monitorIds: [m.id],
    });
    db.prepare(
      "INSERT INTO incidents(id,workspace_id,monitor_id,status,started_at,ai_summary) VALUES('incident','legacy',?,'open',?,'PRIVATE INVESTIGATION')",
    ).run(m.id, new Date().toISOString());
    await request("/api/incidents/incident/update", "POST", {
      message: "We are investigating.",
      public: true,
    });
    const snapshot = (await (await request("/api/status/my-service")).json())
      .data;
    expect(snapshot.monitors.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
    expect(snapshot.activeIncidents[0].ai_summary).toBe(
      "We are investigating.",
    );
  });
  it("issued scoped keys authenticate, cannot escalate, and stop working after revocation", async () => {
    const k = (
      await (
        await request("/api/api-keys", "POST", {
          name: "Automation",
          scopes: ["monitors:read", "monitors:write"],
        })
      ).json()
    ).data;
    const authorized = (path: string, method = "GET") =>
      api.request(
        `https://api.example.com${path}`,
        { method, headers: { authorization: `Bearer ${k.key}` } },
        env,
      );
    expect((await authorized("/api/monitors")).status).toBe(200);
    expect((await authorized("/api/api-keys", "POST")).status).toBe(403);
    await request(`/api/api-keys/${k.id}`, "DELETE");
    expect((await authorized("/api/monitors")).status).toBe(401);
  });
  it("AI uses a deterministic fallback when the daily budget is exhausted", async () => {
    const m = await http();
    db.prepare(
      "INSERT INTO incidents(id,workspace_id,monitor_id,status,started_at) VALUES('incident','legacy',?,'open',?)",
    ).run(m.id, new Date().toISOString());
    db.exec(
      "INSERT INTO usage_daily(workspace_id,usage_date,ai_enrichments) VALUES('legacy',date('now'),10)",
    );
    const run = vi.fn();
    const ack = vi.fn();
    await ai.queue(
      {
        messages: [
          {
            body: {
              eventId: "incident:opened",
              workspaceId: "legacy",
              type: "incident.opened",
              monitorId: m.id,
              incidentId: "incident",
              checkId: 0,
              createdAt: new Date().toISOString(),
            },
            ack,
            retry: vi.fn(),
          },
        ],
      } as unknown as MessageBatch<any>,
      { ...env, AI: { run } } as any,
    );
    expect(run).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalled();
    expect(
      db
        .prepare("SELECT ai_summary_status FROM incidents WHERE id='incident'")
        .get()?.ai_summary_status,
    ).toBe("fallback");
  });
});
