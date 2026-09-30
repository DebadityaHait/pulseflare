import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app, { type Env, requiredApiKeyScope } from "../workers/api/src/index";
import { sha256Hex } from "@pulseflare/shared";

let db: DatabaseSync;
let env: Env;
function adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          return statement;
        },
        async first(column?: string) {
          const row = sqlite.prepare(sql).get(...(values as never[]));
          return row ? (column ? row[column] : row) : null;
        },
        async all() {
          return {
            results: sqlite.prepare(sql).all(...(values as never[])),
            success: true,
          };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...(values as never[]));
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_schema.sql", import.meta.url),
      "utf8",
    ),
  );
  // Exercise an upgrade of a populated prototype database, not just a fresh schema.
  db.exec(
    "INSERT INTO monitors (id,name,url) VALUES ('existing','Original','https://example.com')",
  );
  db.exec(
    readFileSync(new URL("../migrations/0002_v2.sql", import.meta.url), "utf8"),
  );
  db.exec(
    "INSERT INTO workspaces(id,clerk_org_id,name,slug) VALUES ('other','org_other','Other','other'); INSERT INTO workspace_entitlements(workspace_id) VALUES ('other'); INSERT INTO monitors(id,workspace_id,name,url,public) VALUES ('private','other','Private endpoint','https://private.example.com',0),('visible','other','Public endpoint','https://example.com',1); INSERT INTO status_pages(workspace_id,slug,title) VALUES ('other','other','Other status')",
  );
  env = { DB: adapter(db), DEV_AUTH_BYPASS: "true" };
});
afterEach(() => db.close());
function request(path: string, init: RequestInit = {}, workspace = "legacy") {
  return app.request(
    `http://localhost${path}`,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace,
        ...init.headers,
      },
    },
    env,
  );
}

describe("tenant and authentication boundaries", () => {
  it("upgrades existing monitor data without losing it", () => {
    expect(
      db.prepare("SELECT workspace_id FROM monitors WHERE id='existing'").get()
        ?.workspace_id,
    ).toBe("legacy");
  });
  it("does not allow development bypass on an external host", async () => {
    const response = await app.request(
      "https://api.example.com/api/monitors",
      {},
      env,
    );
    expect(response.status).toBe(401);
  });
  it("scopes monitor lists and individual reads to the workspace", async () => {
    const response = await request("/api/monitors");
    expect(
      (await response.json()).data.map((m: { id: string }) => m.id),
    ).toEqual(["existing"]);
    expect((await request("/api/monitors/private")).status).toBe(404);
    expect(
      (await request("/api/monitors/private", { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      db.prepare("SELECT active FROM monitors WHERE id='private'").get()
        ?.active,
    ).toBe(1);
  });
  it("enforces API key scopes before reaching admin routes", async () => {
    const token = "pf_live_test_readonly";
    db.prepare(
      "INSERT INTO api_keys(id,workspace_id,name,prefix,sha256_hash,scopes) VALUES (?,?,?,?,?,?)",
    ).run(
      "key",
      "legacy",
      "Read only",
      "pf_live_test",
      await sha256Hex(token),
      '["monitors:read"]',
    );
    const headers = { authorization: `Bearer ${token}` };
    expect((await request("/api/monitors", { headers })).status).toBe(200);
    for (const [method, path] of [
      ["POST", "/api/api-keys"],
      ["GET", "/api/integrations"],
      ["POST", "/api/monitors/existing/pause"],
      ["GET", "/api/incidents"],
    ]) {
      expect(
        (
          await request(path, {
            method,
            headers,
            ...(method === "POST" ? { body: "{}" } : {}),
          })
        ).status,
      ).toBe(403);
    }
  });
  it("does not expose private monitor incidents or internal evidence publicly", async () => {
    db.exec(
      "INSERT INTO incidents(id,workspace_id,monitor_id,status,started_at,ai_summary) VALUES ('hidden','other','private','open','2026-01-01T00:00:00Z','secret origin detail'),('public-event','other','visible','open','2026-01-01T00:00:00Z','private investigation hint')",
    );
    const response = await request("/api/status/other/incidents");
    const rows = (await response.json()).data;
    expect(rows.map((i: { id: string }) => i.id)).toEqual(["public-event"]);
    expect(JSON.stringify(rows)).not.toContain("private investigation hint");
  });
  it("validates merged maintenance dates on partial edits", async () => {
    db.exec(
      "INSERT INTO maintenance_windows(id,workspace_id,title,starts_at,ends_at) VALUES ('window','legacy','Upgrade','2026-10-01T10:00:00Z','2026-10-01T11:00:00Z')",
    );
    const response = await request("/api/maintenance/window", {
      method: "PATCH",
      body: JSON.stringify({ startsAt: "2026-10-01T12:00:00Z" }),
    });
    expect(response.status).toBe(400);
    expect(
      db
        .prepare("SELECT starts_at FROM maintenance_windows WHERE id='window'")
        .get()?.starts_at,
    ).toBe("2026-10-01T10:00:00Z");
  });
  it("creates and pauses a basic HTTP monitor in the correct workspace", async () => {
    const created = await request(
      "/api/monitors",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Health",
          url: "https://example.com/health",
          public: false,
        }),
      },
      "other",
    );
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.monitor.workspaceId).toBe("other");
    expect(data.monitor.intervalS).toBe(300);
    expect(
      (
        await request(
          `/api/monitors/${data.monitor.id}/pause`,
          { method: "POST" },
          "other",
        )
      ).status,
    ).toBe(200);
    expect(
      db.prepare("SELECT active FROM monitors WHERE id=?").get(data.monitor.id)
        ?.active,
    ).toBe(0);
  });
  it("does not pretend unsupported manual or heartbeat checks succeeded", async () => {
    expect(
      (await request("/api/monitors/existing/test", { method: "POST" })).status,
    ).toBe(503);
    expect(
      (await request("/api/heartbeat/missing", { method: "POST" })).status,
    ).toBe(503);
    expect(
      (
        await request("/api/monitors", {
          method: "POST",
          body: JSON.stringify({
            name: "Advanced",
            url: "https://example.com",
            expectedText: "OK",
          }),
        })
      ).status,
    ).toBe(503);
  });
  it("keeps unobserved services unknown and public summaries sanitized", async () => {
    db.exec(
      "INSERT INTO incidents(id,workspace_id,monitor_id,status,started_at,ai_summary) VALUES ('incident','other','visible','open','2026-01-01T00:00:00Z','internal credential detail')",
    );
    const response = await request("/api/status/other");
    const { data } = await response.json();
    expect(data.overallState).toBe("unknown");
    expect(data.monitors[0].uptime24h).toBeNull();
    expect(JSON.stringify(data)).not.toContain("internal credential detail");
  });
  it("rejects mismatched monitor ownership at the database boundary", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms) VALUES (?,?,?,?,?)",
        )
        .run("legacy", "private", 200, 1, 50),
    ).toThrow("Invalid monitor workspace");
  });
});
describe("API scope policy", () => {
  it("denies unrecognized and administrative routes by default", () => {
    expect(requiredApiKeyScope("POST", "/api/integrations")).toBeNull();
    expect(requiredApiKeyScope("GET", "/api/internal/ops")).toBeNull();
    expect(requiredApiKeyScope("DELETE", "/api/api-keys/key")).toBeNull();
    expect(requiredApiKeyScope("POST", "/api/monitors/id/pause")).toBe(
      "monitors:write",
    );
    expect(requiredApiKeyScope("GET", "/api/monitors/id/incidents")).toBe(
      "incidents:read",
    );
  });
});
