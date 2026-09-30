import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app, { type Env, requiredApiKeyScope } from "../workers/api/src/index";
import { sha256Hex } from "@pulseflare/shared";
import { runScheduled } from "../workers/checker/src/index";
import { d1 } from "./d1";
let db: DatabaseSync, env: Env;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    `http://localhost${path}`,
    {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}
const payload = {
  version: "a834fe2",
  environment: "production",
  source: "github",
  monitorIds: ["m1"],
};
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations", import.meta.url))
    .filter((f) => /^\d.*sql$/.test(f))
    .sort())
    db.exec(
      readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"),
    );
  db.exec(
    `INSERT INTO monitors(id,workspace_id,name,url,last_state,active) VALUES('m1','legacy','API','https://example.com','up',0),('m2','legacy','Private API','https://example.com','down',0); INSERT INTO incidents(id,workspace_id,monitor_id,started_at) VALUES('i1','legacy','m1','2026-09-28T14:31:00Z'); INSERT INTO workspaces(id,clerk_org_id,name,slug) VALUES('other','other','Other','other'); INSERT INTO workspace_entitlements(workspace_id) VALUES('other'); INSERT INTO monitors(id,workspace_id,name,url,active) VALUES('foreign','other','Foreign','https://example.com',0); INSERT INTO incidents(id,workspace_id,monitor_id,started_at) VALUES('foreign-incident','other','foreign','2026-09-28T14:31:00Z');`,
  );
  env = { DB: d1(db), DEV_AUTH_BYPASS: "true" };
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});
async function publicPage() {
  db.exec(
    `DELETE FROM status_pages WHERE workspace_id='legacy'; INSERT INTO status_pages(id,workspace_id,slug,title) VALUES('p','legacy','testing','Service & health'); INSERT INTO status_components(id,workspace_id,status_page_id,name) VALUES('c','legacy','p','Services'); INSERT INTO status_component_monitors(workspace_id,component_id,monitor_id) VALUES('legacy','c','m1'); UPDATE monitors SET active=1 WHERE id='m1';`,
  );
}
describe("product tools", () => {
  it("creates and lists tenant-scoped deployment annotations", async () => {
    const r = await request("/api/deployments", "POST", payload);
    expect(r.status).toBe(201);
    const row = (await r.json()).data;
    expect(row.monitorIds).toEqual(["m1"]);
    expect(
      (await (await request("/api/deployments?monitorId=m1")).json()).data
        .items,
    ).toHaveLength(1);
    expect(
      (await (await request("/api/deployments?monitorId=m2")).json()).data
        .items,
    ).toHaveLength(0);
    expect(
      (
        await (
          await request("/api/deployments", "GET", undefined, {
            "x-workspace-id": "other",
          })
        ).json()
      ).data.items,
    ).toHaveLength(0);
  });
  it("deduplicates retries and rejects altered idempotent requests", async () => {
    const headers = { "Idempotency-Key": "deploy-1" };
    const first = await (
      await request("/api/deployments", "POST", payload, headers)
    ).json();
    const second = await (
      await request("/api/deployments", "POST", payload, headers)
    ).json();
    expect(first.data.id).toBe(second.data.id);
    expect(
      (
        await request(
          "/api/deployments",
          "POST",
          { ...payload, version: "new" },
          headers,
        )
      ).status,
    ).toBe(409);
    expect(db.prepare("SELECT COUNT(*) AS n FROM deployments").get()?.n).toBe(
      1,
    );
  });
  it("rejects foreign monitors atomically and validates links and environments", async () => {
    expect(
      (
        await request("/api/deployments", "POST", {
          ...payload,
          monitorIds: ["m1", "foreign"],
        })
      ).status,
    ).toBe(404);
    for (const extra of [
      { monitorIds: [] },
      { url: "javascript:alert(1)" },
      { url: "https://localhost/private" },
      { environment: "invalid" },
    ])
      expect(
        (await request("/api/deployments", "POST", { ...payload, ...extra }))
          .status,
      ).toBe(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM deployments").get()?.n).toBe(
      0,
    );
  });
  it("paginates deployments and filters time ranges without expired history", async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 22; i++)
      db.prepare(
        "INSERT INTO deployments(id,workspace_id,version,environment,source,request_json,created_by,created_at) VALUES(?,'legacy',?,'production','manual','{}','test',?)",
      ).run(`d${i}`, `${i}`, now);
    db.prepare(
      "INSERT INTO deployments(id,workspace_id,version,environment,source,request_json,created_by,created_at) VALUES('expired','legacy','old','production','manual','{}','test',?)",
    ).run(new Date(Date.now() - 31 * 86400000).toISOString());
    const first = (await (await request("/api/deployments")).json()).data;
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const next = (await (await request("/api/deployments?offset=20")).json())
      .data;
    expect(next.items).toHaveLength(2);
    expect(next.hasMore).toBe(false);
  });
  it("allows only explicit deployment scopes on API keys", async () => {
    expect(requiredApiKeyScope("POST", "/api/deployments")).toBe(
      "deployments:write",
    );
    const token = "pf_live_deploytest";
    db.prepare(
      "INSERT INTO api_keys(id,workspace_id,name,prefix,sha256_hash,scopes) VALUES('key','legacy','CI','pf_live',?,?)",
    ).run(await sha256Hex(token), JSON.stringify(["deployments:write"]));
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await request("/api/deployments", "POST", payload, headers)).status,
    ).toBe(201);
    expect(
      (await request("/api/deployments", "GET", undefined, headers)).status,
    ).toBe(403);
    expect(
      (await request("/api/monitors", "GET", undefined, headers)).status,
    ).toBe(403);
    expect(
      (await request("/api/incidents/i1/postmortem", "GET", undefined, headers))
        .status,
    ).toBe(403);
  });
  it("stores tags and environment without erasing partial configuration", async () => {
    expect(
      (
        await request("/api/monitors/m1", "PATCH", {
          tags: ["critical", "backend"],
          environment: "production",
        })
      ).status,
    ).toBe(200);
    const row = (
      await (
        await request("/api/monitors/m1", "PATCH", { name: "New name" })
      ).json()
    ).data;
    expect(row.environment).toBe("production");
    expect(row.tags).toEqual(["critical", "backend"]);
    expect(
      (await request("/api/monitors/m1", "PATCH", { environment: "unknown" }))
        .status,
    ).toBe(400);
  });
  it("defaults upgraded monitors to unassigned and new monitor configuration persists", async () => {
    expect(
      (await (await request("/api/monitors/m1")).json()).data.environment,
    ).toBe("unassigned");
    const r = await request("/api/monitors", "POST", {
      name: "New API",
      url: "https://example.com",
      tags: ["customer-facing"],
      environment: "staging",
    });
    expect(r.status).toBe(201);
    expect((await r.json()).data.monitor.environment).toBe("staging");
  });
  it("prefills reports only from recorded facts", async () => {
    const report = (
      await (await request("/api/incidents/i1/postmortem")).json()
    ).data;
    expect(report.revision).toBe(0);
    expect(report.rootCause).toBe("Not yet confirmed.");
    expect(report.impact).toContain("Customer impact has not been confirmed");
    expect(report.evidence.incident.started_at).toBe("2026-09-28T14:31:00Z");
  });
  it("persists report revisions and rejects stale writes without losing edits", async () => {
    const report = {
      revision: 0,
      impact: "Observed impact",
      rootCause: "Unknown",
      resolution: "Recovered",
      preventiveActions: "Investigate",
    };
    expect(
      (await request("/api/incidents/i1/postmortem", "PUT", report)).status,
    ).toBe(200);
    expect(
      (
        await request("/api/incidents/i1/postmortem", "PUT", {
          ...report,
          impact: "Stale",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("/api/incidents/i1/postmortem", "PUT", {
          ...report,
          revision: 1,
          impact: "Updated",
        })
      ).status,
    ).toBe(200);
    const saved = (await (await request("/api/incidents/i1/postmortem")).json())
      .data;
    expect(saved.revision).toBe(2);
    expect(saved.impact).toBe("Updated");
  });
  it("protects reports across tenants and refuses oversize or unknown fields", async () => {
    const report = {
      revision: 0,
      impact: "",
      rootCause: "",
      resolution: "",
      preventiveActions: "",
    };
    expect(
      (await request("/api/incidents/foreign-incident/postmortem")).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/api/incidents/foreign-incident/postmortem",
          "PUT",
          report,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/api/incidents/i1/postmortem", "PUT", {
          ...report,
          impact: "x".repeat(4001),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/incidents/i1/postmortem", "PUT", {
          ...report,
          public: true,
        })
      ).status,
    ).toBe(400);
  });
  it("cascades reports and monitor links without exposing other tenants", async () => {
    await request("/api/deployments", "POST", payload);
    await request("/api/incidents/i1/postmortem", "PUT", {
      revision: 0,
      impact: "",
      rootCause: "",
      resolution: "",
      preventiveActions: "",
    });
    expect(() =>
      db.exec(
        "INSERT INTO deployment_monitors(workspace_id,deployment_id,monitor_id) SELECT 'legacy',id,'foreign' FROM deployments LIMIT 1",
      ),
    ).toThrow();
    db.exec("DELETE FROM monitors WHERE id='m1'");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM incident_postmortems").get()?.n,
    ).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM deployment_monitors").get()?.n,
    ).toBe(0);
  });
  it("serves escaped SVG badges and JSON from published public selection", async () => {
    await publicPage();
    const r = await request("/api/status/testing/badge.svg");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("image/svg+xml");
    expect(r.headers.get("cache-control")).toContain("120");
    expect(await r.text()).toContain("Service &amp; health");
    const json = (await (await request("/api/status/testing")).json()).data;
    expect(json.monitors.map((m: { id: string }) => m.id)).toEqual(["m1"]);
  });
  it("RSS contains only public updates for selected public monitors and escapes XML", async () => {
    await publicPage();
    db.exec(
      `INSERT INTO incidents(id,workspace_id,monitor_id,started_at) VALUES('i2','legacy','m2','2026-09-28T14:31:00Z'); INSERT INTO incident_updates(id,workspace_id,incident_id,status,message,public) VALUES('u1','legacy','i1','resolved','Public <update> & done',1),('u2','legacy','i1','open','secret chat evidence',0),('u3','legacy','i2','open','unselected monitor',1);`,
    );
    const response = await request("/api/status/testing/rss");
    expect(response.headers.get("content-type")).toContain(
      "application/rss+xml",
    );
    const xml = await response.text();
    expect(xml).toContain("Public &lt;update&gt; &amp; done");
    expect(xml).not.toMatch(/secret chat|unselected monitor/);
  });
  it("returns 404 for unpublished, unknown, or removed public surfaces", async () => {
    await publicPage();
    db.exec("UPDATE status_pages SET published=0 WHERE id='p'");
    for (const path of [
      "/api/status/testing",
      "/api/status/testing/rss",
      "/api/status/testing/badge.svg",
      "/api/status/missing/rss",
    ])
      expect((await request(path)).status).toBe(404);
  });
  it("keeps private postmortems and deployments out of all public outputs", async () => {
    await publicPage();
    await request("/api/deployments", "POST", {
      ...payload,
      version: "private-version",
    });
    await request("/api/incidents/i1/postmortem", "PUT", {
      revision: 0,
      impact: "private-impact",
      rootCause: "private-root",
      resolution: "private-resolution",
      preventiveActions: "private-actions",
    });
    for (const path of [
      "/api/status/testing",
      "/api/status/testing/rss",
      "/api/status/testing/badge.svg",
    ])
      expect(await (await request(path)).text()).not.toMatch(
        /private-version|private-impact|private-root|private-resolution|private-actions/,
      );
  });
  it("bounds deployment cleanup and uses indexed retrieval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    for (let i = 0; i < 205; i++)
      db.prepare(
        "INSERT INTO deployments(id,workspace_id,version,environment,source,request_json,created_by,created_at) VALUES(?,'legacy','old','production','manual','{}','test','2026-08-01T00:00:00Z')",
      ).run(`old${i}`);
    await runScheduled(env);
    expect(db.prepare("SELECT COUNT(*) AS n FROM deployments").get()?.n).toBe(
      5,
    );
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM deployments WHERE workspace_id=? AND created_at>=? ORDER BY created_at DESC,id DESC LIMIT 21",
      )
      .all("legacy", "2026-09-01");
    expect(JSON.stringify(plan)).toContain("idx_deployments_workspace_time");
  });
});
