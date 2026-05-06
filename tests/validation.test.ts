import { describe, expect, it } from "vitest";
import { isValidMonitorUrl } from "@pulseflare/shared";

describe("isValidMonitorUrl", () => {
  it("accepts public http and https URLs", () => {
    expect(isValidMonitorUrl("https://example.com/health")).toBe(true);
    expect(isValidMonitorUrl("http://example.com")).toBe(true);
  });

  it("rejects unsafe URLs", () => {
    expect(isValidMonitorUrl("ftp://example.com")).toBe(false);
    expect(isValidMonitorUrl("http://localhost:3000")).toBe(false);
    expect(isValidMonitorUrl("http://127.0.0.1")).toBe(false);
    expect(isValidMonitorUrl("http://192.168.1.2")).toBe(false);
  });
});
