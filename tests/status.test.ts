import { describe, expect, it } from "vitest";
import {
  deriveState,
  shouldCreateIncident,
  shouldResolveIncident,
  uptimePercent,
} from "@pulseflare/shared";

describe("status", () => {
  it("derives core states", () => {
    expect(deriveState({ ok: false, latencyMs: 30 })).toBe("down");
    expect(deriveState({ ok: true, latencyMs: 80 })).toBe("up");
    expect(deriveState({ ok: true, latencyMs: 900, zScore: 4 })).toBe(
      "degraded",
    );
  });

  it("detects outage transitions", () => {
    expect(shouldCreateIncident("up", "down")).toBe(true);
    expect(shouldCreateIncident("down", "down")).toBe(false);
    expect(shouldResolveIncident("down", "up")).toBe(true);
  });

  it("computes uptime", () => {
    expect(uptimePercent([{ ok: true }, { ok: false }, { ok: true }])).toBe(
      66.67,
    );
  });
});
