import type { Check, MonitorState } from "./types";

export function deriveState(input: { ok: boolean; latencyMs: number; baselineMeanMs?: number; zScore?: number }): MonitorState {
  if (!input.ok) return "down";
  if (input.zScore !== undefined && input.zScore >= 3 && input.latencyMs >= 500) return "degraded";
  return "up";
}

export function shouldCreateIncident(previous: MonitorState | null, next: MonitorState): boolean {
  const from = previous ?? "unknown";
  return next === "down" && from !== "down";
}

export function shouldResolveIncident(previous: MonitorState | null, next: MonitorState): boolean {
  return previous === "down" && next === "up";
}

export function uptimePercent(checks: Pick<Check, "ok">[]): number {
  if (checks.length === 0) return 100;
  return Math.round((checks.filter((check) => check.ok).length / checks.length) * 10000) / 100;
}
