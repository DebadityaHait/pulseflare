import { describe, expect, it } from "vitest";
import { applySeverityOverrides, fallbackSeverity, parseSeverity } from "@pulseflare/shared";

describe("severity", () => {
  it("parses severity integers", () => {
    expect(parseSeverity("4")).toBe(4);
    expect(parseSeverity("Severity: 5 urgent")).toBe(5);
  });

  it("rejects malformed severity", () => {
    expect(parseSeverity("critical")).toBeNull();
    expect(parseSeverity("9")).toBeNull();
  });

  it("falls back for long outages", () => {
    expect(fallbackSeverity({ isOpen: true, durationMinutes: 31, failureRateLast5: 0.2, publicMonitor: true })).toBe(5);
  });

  it("overrides low AI score upward", () => {
    expect(applySeverityOverrides(1, { isOpen: true, durationMinutes: 12, failureRateLast5: 1, publicMonitor: true })).toBe(4);
  });
});
