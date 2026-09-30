import { describe, expect, it } from "vitest";
import { buildIncidentPrompt } from "@pulseflare/shared";

describe("buildIncidentPrompt", () => {
  it("includes evidence and excludes webhook secrets", () => {
    const prompt = buildIncidentPrompt({
      monitor: {
        id: "m1",
        name: "API",
        url: "https://api.example.com/health",
        method: "GET",
        expectedStatusMin: 200,
        expectedStatusMax: 299,
        intervalS: 60,
        timeoutMs: 10000,
        active: true,
        public: true,
        tags: [],
        notifyDiscordWebhook: "https://discord.com/api/webhooks/secret",
        createdAt: "now",
        updatedAt: "now",
      },
      incident: {
        id: "i1",
        monitorId: "m1",
        type: "outage",
        status: "open",
        startedAt: "2026-05-06T10:00:00Z",
        aiSummaryStatus: "pending",
        createdAt: "now",
        updatedAt: "now",
      },
      checks: [
        {
          id: 1,
          monitorId: "m1",
          status: 503,
          ok: false,
          latencyMs: 50,
          checkedAt: "2026-05-06T10:00:00Z",
        },
      ],
    });
    expect(prompt).toContain("status=503");
    expect(prompt).toContain("/health");
    expect(prompt).not.toContain("discord.com/api/webhooks/secret");
  });
});
