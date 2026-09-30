import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app, { type Env } from "../workers/api/src/index";
import { CHAT_MODEL } from "../workers/api/src/chat";
import { sha256Hex } from "@pulseflare/shared";
import { d1 } from "./d1";

let db: DatabaseSync;
let env: Env;
let run: ReturnType<typeof vi.fn>;
function request(
  path: string,
  body?: unknown,
  workspace = "legacy",
  headers: Record<string, string> = {},
) {
  return app.request(
    `http://localhost${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": workspace,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}
function ask(question = "What happened?", requestId = crypto.randomUUID()) {
  return request("/api/incidents/incident/chat", { question, requestId });
}
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const file of [
    "0001_schema.sql",
    "0002_v2.sql",
    "0003_mvp.sql",
    "0004_free_tier_budget.sql",
    "0005_incident_chat.sql",
  ])
    db.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  db.exec(`INSERT INTO monitors(id,workspace_id,name,url,request_body,headers_ciphertext) VALUES('monitor','legacy','API','https://example.com','secret-body','secret-header');
    INSERT INTO checks(id,workspace_id,monitor_id,status,ok,latency_ms,error_code) VALUES(10,'legacy','monitor',503,0,1800,'STATUS_MISMATCH');
    INSERT INTO incidents(id,workspace_id,monitor_id,started_at,trigger_check_id) VALUES('incident','legacy','monitor',strftime('%Y-%m-%dT%H:%M:%SZ','now'),10);
    INSERT INTO workspaces(id,clerk_org_id,name,slug) VALUES('other','other','Other','other');
    INSERT INTO workspace_entitlements(workspace_id) VALUES('other');
    INSERT INTO monitors(id,workspace_id,name,url) VALUES('other-monitor','other','Other API','https://example.com');
    INSERT INTO incidents(id,workspace_id,monitor_id,started_at) VALUES('other-incident','other','other-monitor',strftime('%Y-%m-%dT%H:%M:%SZ','now'));`);
  run = vi
    .fn()
    .mockResolvedValue({
      response:
        "The failed check returned 503 [C1]. The incident is open [I1]. Root cause is not established.",
    });
  env = { DB: d1(db), DEV_AUTH_BYPASS: "true", AI: { run } as unknown as Ai };
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe("incident assistant", () => {
  it("calls Llama 3.3 with bounded evidence, saves the answer, and restores memory", async () => {
    expect((await ask()).status).toBe(200);
    const restored = await (
      await request("/api/incidents/incident/chat")
    ).json();
    expect(restored.data.turns).toHaveLength(1);
    expect(restored.data.remaining).toBe(19);
    expect(restored.data.turns[0].answer).toContain("503");
    expect(run.mock.calls[0][0]).toBe(CHAT_MODEL);
    expect(run.mock.calls[0][1].max_tokens).toBe(384);
    expect(JSON.stringify(run.mock.calls[0][1])).not.toMatch(
      /secret-body|secret-header|https:\/\/example.com/,
    );
    expect((await ask("What should I check next?")).status).toBe(200);
    expect(
      run.mock.calls[1][1].messages.some(
        (message: { role: string; content: string }) =>
          message.role === "assistant" && message.content.includes("503"),
      ),
    ).toBe(true);
  });
  it("does not send requests to AI for another tenant's incident", async () => {
    expect((await request("/api/incidents/other-incident/chat")).status).toBe(
      404,
    );
    expect(
      (
        await request("/api/incidents/other-incident/chat", {
          question: "Explain",
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps conversations private to each user even in one workspace", async () => {
    await ask();
    db.exec("UPDATE incident_chat_turns SET user_id='someone-else'");
    const result = await (await request("/api/incidents/incident/chat")).json();
    expect(result.data.turns).toEqual([]);
    await ask();
    expect(
      run.mock.calls[1][1].messages.filter(
        (message: { role: string }) => message.role === "assistant",
      ),
    ).toHaveLength(0);
  });
  it("replays an idempotent request without an extra model call or quota reservation", async () => {
    const id = crypto.randomUUID();
    await ask("Explain", id);
    expect((await ask("Explain", id)).status).toBe(200);
    expect((await ask("Different", id)).status).toBe(409);
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare("SELECT requests FROM chat_usage_daily WHERE scope='platform'")
        .get()?.requests,
    ).toBe(1);
  });
  it("enforces a workspace daily cap atomically before calling the model", async () => {
    db.prepare("INSERT INTO chat_usage_daily VALUES(?,?,20)").run(
      "workspace:legacy",
      new Date().toISOString().slice(0, 10),
    );
    const response = await ask();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM incident_chat_turns").get()?.n,
    ).toBe(0);
  });
  it("enforces the shared platform cap and resets on a new UTC date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("INSERT INTO chat_usage_daily VALUES('platform',?,40)").run(
      today,
    );
    expect((await ask()).status).toBe(429);
    db.prepare("UPDATE chat_usage_daily SET usage_date='2000-01-01'").run();
    expect((await ask()).status).toBe(200);
  });
  it("refuses overlapping model calls for the same conversation", async () => {
    let finish: (value: unknown) => void = () => {};
    run.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = ask();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect((await ask("Second question")).status).toBe(409);
    finish({ response: "No root cause is confirmed [I1]." });
    expect((await first).status).toBe(200);
    expect(
      db
        .prepare("SELECT requests FROM chat_usage_daily WHERE scope='platform'")
        .get()?.requests,
    ).toBe(1);
  });
  it("records failures truthfully and releases the pending reservation", async () => {
    run.mockRejectedValueOnce(new Error("Provider failed"));
    expect((await ask()).status).toBe(503);
    const result = await (await request("/api/incidents/incident/chat")).json();
    expect(result.data.turns[0]).toMatchObject({
      status: "failed",
      answer: null,
    });
    expect(result.data.remaining).toBe(19);
    expect((await ask()).status).toBe(200);
  });
  it("rejects malformed output and nonexistent evidence citations", async () => {
    run.mockResolvedValueOnce({ response: "Definitely deployment C99 [C99]." });
    expect((await ask()).status).toBe(503);
    run.mockResolvedValueOnce({ response: { text: "invalid" } });
    expect((await ask()).status).toBe(503);
  });
  it("validates questions and does not accept client-provided context", async () => {
    expect((await ask(" ")).status).toBe(400);
    expect((await ask("x".repeat(1001))).status).toBe(400);
    expect(
      (
        await request("/api/incidents/incident/chat", {
          question: "Explain",
          requestId: crypto.randomUUID(),
          context: "made-up evidence",
        })
      ).status,
    ).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it("fails closed when AI is disabled or unavailable", async () => {
    env.AI = undefined;
    expect((await ask()).status).toBe(503);
    db.exec(
      "UPDATE workspace_entitlements SET ai_enabled=0 WHERE workspace_id='legacy'",
    );
    expect((await ask()).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not permit API keys to use chat even with wildcard scopes", async () => {
    const key = "pf_live_chat_key";
    db.prepare(
      "INSERT INTO api_keys(id,workspace_id,name,sha256_hash,prefix,scopes) VALUES('key','legacy','Test',?,'pf_live','[\"*\",\"incidents:read\"]')",
    ).run(await sha256Hex(key));
    expect(
      (
        await request("/api/incidents/incident/chat", undefined, "legacy", {
          authorization: `Bearer ${key}`,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/incidents/incident/chat",
          { question: "Explain", requestId: crypto.randomUUID() },
          "legacy",
          { authorization: `Bearer ${key}` },
        )
      ).status,
    ).toBe(403);
  });
  it("enforces composite tenant references and cascade cleanup", async () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO incident_chat_turns(id,workspace_id,incident_id,user_id,question,model,created_at,updated_at) VALUES('bad','other','incident','u','q','m','2026-09-30','2026-09-30')",
        )
        .run(),
    ).toThrow();
    await ask();
    db.exec("DELETE FROM incidents WHERE id='incident'");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM incident_chat_turns").get()?.n,
    ).toBe(0);
  });
  it("releases abandoned pending turns without refunding inference quota", async () => {
    await ask();
    db.exec(
      "UPDATE incident_chat_turns SET status='pending',answer=NULL,created_at='2000-01-01T00:00:00.000Z'",
    );
    expect((await ask("Try again")).status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT status FROM incident_chat_turns WHERE created_at LIKE '2000%'",
        )
        .get()?.status,
    ).toBe("failed");
  });
  it("bounds a slow model response and makes the conversation usable again", async () => {
    vi.useFakeTimers();
    run.mockImplementationOnce(() => new Promise(() => {}));
    const response = ask();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(25001);
    expect((await response).status).toBe(503);
    expect(
      db.prepare("SELECT status FROM incident_chat_turns").get()?.status,
    ).toBe("failed");
  });
  it("counts reservations atomically even when multiple incidents are submitted", async () => {
    db.prepare("INSERT INTO chat_usage_daily VALUES(?,?,19)").run(
      "workspace:legacy",
      new Date().toISOString().slice(0, 10),
    );
    db.exec(
      "INSERT INTO incidents(id,workspace_id,monitor_id,status,started_at) VALUES('second','legacy','monitor','resolved','2026-01-01')",
    );
    const replies = await Promise.all([
      ask(),
      request("/api/incidents/second/chat", {
        question: "Explain",
        requestId: crypto.randomUUID(),
      }),
    ]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 429]);
    expect(run).toHaveBeenCalledOnce();
  });
});
