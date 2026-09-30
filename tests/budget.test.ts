import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  databaseBudget,
  PROJECT_DAILY_READ_BUDGET,
  PROJECT_DAILY_WRITE_BUDGET,
  isDatabaseLimit,
} from "@pulseflare/shared";
import api from "../workers/api/src/index";
import { d1 } from "./d1";

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0001_schema.sql",
    "0002_v2.sql",
    "0003_mvp.sql",
    "0004_free_tier_budget.sql",
  ])
    sqlite.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
});
afterEach(() => {
  sqlite.close();
  vi.useRealTimers();
});

describe("shared daily database budget", () => {
  it("meters first/all/run/batch metadata and flushes once", async () => {
    const db = d1(sqlite);
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      const all = statement.all.bind(statement);
      const run = statement.run.bind(statement);
      statement.all = (async () => ({
        ...(await all()),
        meta: { rows_read: 7, rows_written: 0 },
      })) as typeof statement.all;
      statement.run = (async () => ({
        ...(await run()),
        meta: { rows_read: 2, rows_written: 1 },
      })) as typeof statement.run;
      return statement;
    }) as typeof db.prepare;
    const budget = await databaseBudget(db);
    expect(await budget.DB.prepare("SELECT 42 AS answer").first("answer")).toBe(
      42,
    );
    await budget.DB.prepare("SELECT 1").all();
    await budget.DB.prepare(
      "UPDATE workspaces SET name=name WHERE id='legacy'",
    ).run();
    await budget.DB.batch([budget.DB.prepare("SELECT 1")]);
    await budget.finish();
    await budget.finish();
    expect(
      sqlite
        .prepare("SELECT rows_read,rows_written FROM platform_daily_budget")
        .get(),
    ).toEqual({ rows_read: 21, rows_written: 3 });
  });
  it.each(["rows_read", "rows_written"])(
    "rejects further work at the %s budget",
    async (column) => {
      sqlite
        .prepare(
          `INSERT INTO platform_daily_budget(usage_date,${column}) VALUES(date('now'),?)`,
        )
        .run(
          column === "rows_read"
            ? PROJECT_DAILY_READ_BUDGET
            : PROJECT_DAILY_WRITE_BUDGET,
        );
      await expect(databaseBudget(d1(sqlite))).rejects.toThrow(
        "PROJECT_DAILY_BUDGET",
      );
    },
  );
  it("starts a new ledger day after midnight UTC", async () => {
    sqlite.exec(
      `INSERT INTO platform_daily_budget VALUES('2020-01-01',${PROJECT_DAILY_READ_BUDGET},${PROJECT_DAILY_WRITE_BUDGET})`,
    );
    const budget = await databaseBudget(d1(sqlite));
    await budget.finish();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM platform_daily_budget")
        .get()?.count,
    ).toBe(2);
  });
  it("returns retryable 503 rather than an authentication error, with health still available", async () => {
    sqlite
      .prepare(
        "INSERT INTO platform_daily_budget(usage_date,rows_read) VALUES(date('now'),?)",
      )
      .run(PROJECT_DAILY_READ_BUDGET);
    const env = { DB: d1(sqlite), DEV_AUTH_BYPASS: "true" };
    const response = await api.request(
      "http://localhost/api/monitors",
      {},
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await response.json()).error.code).toBe("DAILY_BUDGET_REACHED");
    expect(
      (await api.request("http://localhost/api/health", {}, env)).status,
    ).toBe(200);
    expect(
      isDatabaseLimit(
        new Error(
          "Your account has exceeded D1's free tier daily row write limit.",
        ),
      ),
    ).toBe(true);
  });
  it("public/list statistics seek tenant, monitor and time instead of scanning old history", async () => {
    sqlite.exec(`INSERT INTO monitors(id,workspace_id,name,url,public) VALUES('m','legacy','Site','https://example.com',1);
      INSERT INTO status_component_monitors VALUES('legacy','legacy-services','m');
      WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,checked_at) SELECT 'legacy','m',200,1,90,'2020-01-01T00:00:00Z' FROM n;
      INSERT INTO checks(workspace_id,monitor_id,status,ok,latency_ms,checked_at) VALUES('legacy','m',503,0,100,strftime('%Y-%m-%dT%H:%M:%SZ','now'));`);
    const db = d1(sqlite);
    const queries: string[] = [];
    const original = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      queries.push(sql);
      return original(sql);
    }) as typeof db.prepare;
    const env = { DB: db, DEV_AUTH_BYPASS: "true" };
    const list = await api.request("http://localhost/api/monitors", {}, env);
    expect((await list.json()).data[0].uptime24h).toBe(0);
    const status = await api.request(
      "http://localhost/api/status/legacy",
      {},
      env,
    );
    expect((await status.json()).data.monitors[0].uptime24h).toBe(0);
    const aggregates = queries.filter((sql) =>
      sql.includes("json_object('count'"),
    );
    expect(aggregates).toHaveLength(2);
    for (const query of aggregates) {
      const argumentsCount = (query.match(/\?/g) ?? []).length;
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .all(...Array(argumentsCount).fill("legacy"));
      expect(
        plan.some((row) =>
          String(row.detail).includes(
            "idx_checks_workspace_monitor_time (workspace_id=? AND monitor_id=? AND checked_at>?)",
          ),
        ),
      ).toBe(true);
    }
  });
});
