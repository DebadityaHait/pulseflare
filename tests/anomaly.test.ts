import { describe, expect, it } from "vitest";
import { detectLatencyAnomaly } from "@pulseflare/shared";

describe("detectLatencyAnomaly", () => {
  it("skips when samples are insufficient", () => {
    expect(detectLatencyAnomaly([100, 110], 400).anomalous).toBe(false);
  });

  it("does not flag normal latency", () => {
    expect(
      detectLatencyAnomaly([100, 105, 98, 102, 101, 99, 103, 104, 97, 100], 106)
        .anomalous,
    ).toBe(false);
  });

  it("flags high z-score latency", () => {
    expect(
      detectLatencyAnomaly([100, 105, 98, 102, 101, 99, 103, 104, 97, 100], 250)
        .anomalous,
    ).toBe(true);
  });

  it("handles zero stddev", () => {
    const result = detectLatencyAnomaly(Array(10).fill(100), 120);
    expect(result.stddev).toBe(0);
    expect(result.zScore).toBe(0);
  });
});
