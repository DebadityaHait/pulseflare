import type { Check, MonitorState } from "./types";

export function deriveState(input: { ok: boolean; latencyMs: number; baselineMeanMs?: number; zScore?: number }): MonitorState {
  if (!input.ok) return "down";
  if (input.zScore !== undefined && input.zScore >= 3 && input.latencyMs >= 500) return "degraded";
  return "up";
}

export function derivePerformanceState(input: { ok: boolean; latencyThresholdMs?: number | null; consecutiveViolations: number; currentState?: MonitorState }): MonitorState {
  if (!input.ok) return "down";
  if (input.latencyThresholdMs && input.consecutiveViolations >= 2) return "degraded";
  return input.currentState === "degraded" ? "up" : "up";
}

export function nextConfirmedState(input: { ok: boolean; latencyThresholdMs?: number | null; consecutiveLatencyViolations: number }): MonitorState {
  return derivePerformanceState({ ok: input.ok, latencyThresholdMs: input.latencyThresholdMs, consecutiveViolations: input.consecutiveLatencyViolations });
}

export function shouldCreateIncident(previous: MonitorState | null, next: MonitorState): boolean {
  const from = previous ?? "unknown";
  return next === "down" && from !== "down";
}

export function shouldResolveIncident(previous: MonitorState | null, next: MonitorState): boolean {
  return (previous === "down" || previous === "degraded") && (next === "up" || next === "maintenance");
}

export function uptimePercent(checks: Pick<Check, "ok">[]): number {
  if (checks.length === 0) return 100;
  return Math.round((checks.filter((check) => check.ok).length / checks.length) * 10000) / 100;
}
