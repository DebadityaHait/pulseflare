import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import checker, { type Env } from "../workers/checker/src/index";

let db: DatabaseSync;
let env: Env;
const send = vi.fn();
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const file of ["0001_schema.sql", "0002_v2.sql"])
    db.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  db.exec(
    "INSERT INTO workspaces(id,clerk_org_id,name,slug) VALUES ('tenant','org_tenant','Tenant','tenant'); INSERT INTO monitors(id,workspace_id,name,url,interval_s) VALUES ('endpoint','tenant','API','https://example.com/health',600)",
  );
  const kv = new Map<string, string>();
  env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            values = args;
            return stmt;
          },
          async first() {
            return db.prepare(sql).get(...(values as never[])) || null;
          },
          async all() {
            return { results: db.prepare(sql).all(...(values as never[])) };
          },
          async run() {
            db.prepare(sql).run(...(values as never[]));
            return { success: true };
          },
        };
        return stmt;
      },
    } as unknown as D1Database,
    STATUS_KV: {
      get: async (key: string) => kv.get(key) || null,
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
    } as unknown as KVNamespace,
    INCIDENT_QUEUE: { send } as unknown as Env["INCIDENT_QUEUE"],
  };
  send.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("OK", { status: 200 })),
  );
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
async function tick() {
  const pending: Promise<unknown>[] = [];
  await checker.scheduled({} as ScheduledEvent, env, {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as ExecutionContext);
  await Promise.all(pending);
}
describe("scheduled HTTP checking", () => {
  it("persists tenant-scoped evidence and respects intervals across cron ticks", async () => {
    await tick();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/health",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(db.prepare("SELECT workspace_id,state FROM checks").get()).toEqual({
      workspace_id: "tenant",
      state: "up",
    });
    expect(
      db.prepare("SELECT last_state FROM monitors WHERE id='endpoint'").get()
        ?.last_state,
    ).toBe("up");
  });
  it("opens and resolves an acknowledged incident while preserving tenant event metadata", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unavailable", { status: 503 }),
    );
    await tick();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "tenant",
        type: "incident.created",
        eventId: expect.stringContaining(":opened"),
      }),
    );
    db.exec(
      "UPDATE incidents SET status='acknowledged'; UPDATE monitors SET last_checked_at='2020-01-01T00:00:00Z'",
    );
    await tick();
    expect(
      db.prepare("SELECT workspace_id,status FROM incidents").get(),
    ).toEqual({ workspace_id: "tenant", status: "resolved" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "tenant",
        type: "incident.resolved",
        eventId: expect.stringContaining(":resolved"),
      }),
    );
  });
  it("does not run paused or heartbeat monitors through HTTP probing", async () => {
    db.exec(
      "UPDATE monitors SET active=0; INSERT INTO monitors(id,workspace_id,name,url,monitor_type) VALUES ('job','tenant','Backup','','heartbeat')",
    );
    await tick();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not expose unauthenticated manual execution", async () => {
    expect((await checker.fetch()).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });
});
