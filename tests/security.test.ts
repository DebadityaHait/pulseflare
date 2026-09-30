import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isValidMonitorUrl,
  randomToken,
  readJsonPath,
} from "@pulseflare/shared";
import {
  demoIncidents,
  latencySeries,
  postmortemMarkdown,
  timelineFor,
} from "../frontend/src/data/demo";

describe("public URL validation", () => {
  it.each([
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:a00:1]",
    "http://[fd00::1]",
    "http://2130706433",
    "http://0x7f000001",
    "http://127.1",
    "http://localhost.",
    "http://metadata.google.internal.",
    "http://printer.local",
    "http://intranet",
    "http://100.64.1.2",
    "http://169.254.169.254",
    "http://user:password@example.com",
    "http://224.0.0.1",
  ])("rejects unsafe target %s", (url) => {
    expect(isValidMonitorUrl(url)).toBe(false);
  });
});
describe("secret storage", () => {
  it("round-trips encrypted secrets with unique IVs and rejects the wrong key", async () => {
    const encrypted = await encryptSecret("secret webhook", "test-master-key");
    expect(await decryptSecret(encrypted, "test-master-key")).toBe(
      "secret webhook",
    );
    expect(
      (await encryptSecret("secret webhook", "test-master-key")).iv,
    ).not.toBe(encrypted.iv);
    await expect(decryptSecret(encrypted, "wrong-key")).rejects.toThrow();
    await expect(
      decryptSecret(
        { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) },
        "test-master-key",
      ),
    ).rejects.toThrow();
  });
  it("generates URL-safe random tokens", () =>
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/));
  it("reads only JSON properties, not the prototype chain", () => {
    expect(readJsonPath({ items: [{ id: 1 }] }, "$.items[0].id")).toBe(1);
    expect(readJsonPath({}, "$.__proto__")).toBeUndefined();
    expect(readJsonPath({}, "$.constructor")).toBeUndefined();
  });
});
describe("showcase data integrity", () => {
  it("exports evidence for the selected incident", () => {
    const report = postmortemMarkdown(demoIncidents[1]);
    expect(report).toContain("Sample incident report");
    expect(report).toContain("Connection pool restarted");
    expect(report).not.toContain("Search responded");
    expect(timelineFor("inc-api").at(-1)?.title).toBe("Service recovered");
  });
  it("uses deterministic chart data with labels matching the selected period", () => {
    expect(latencySeries(2)).toEqual(latencySeries(2));
    expect(latencySeries(0, 12, 1).at(-1)?.time).toBe("00:55");
    expect(latencySeries(0, 120, 720).at(-1)?.time).toBe("Day 30");
  });
});
