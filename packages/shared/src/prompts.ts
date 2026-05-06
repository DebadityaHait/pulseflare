import type { Check, Incident, Monitor } from "./types";

export function fallbackIncidentSummary(input: {
  monitorName: string;
  status: number;
  latencyMs: number;
  errorCode?: string | null;
  startedAt: string;
}): string {
  return `${input.monitorName} entered an unhealthy state at ${input.startedAt}. The latest check returned status ${input.status} in ${input.latencyMs}ms${input.errorCode ? ` with error ${input.errorCode}` : ""}. Review recent deployments, origin logs, and upstream dependencies.`;
}

export function fallbackAnomalyExplanation(input: { current: number; mean: number; z: number }): string {
  return `Latency increased to ${input.current}ms compared with a recent baseline near ${Math.round(input.mean)}ms (z-score ${input.z.toFixed(2)}). This may indicate transient network congestion or origin slowness; review whether the pattern repeats across future checks.`;
}

export function buildIncidentPrompt(input: { monitor: Monitor; incident: Incident; checks: Check[] }): string {
  const evidence = input.checks
    .map((check) => `${check.checkedAt}: status=${check.status}, ok=${check.ok}, latency=${check.latencyMs}ms, error=${check.errorCode ?? "none"}`)
    .join("\n");
  return `Summarize this uptime incident in 2-3 concise sentences. Include likely cause hints and what to check first. Do not mention secrets.
Monitor: ${input.monitor.name}
URL path: ${new URL(input.monitor.url).pathname || "/"}
Incident status: ${input.incident.status}
Started: ${input.incident.startedAt}
Resolved: ${input.incident.resolvedAt ?? "not resolved"}
Recent checks:
${evidence}`;
}

export function buildSeverityPrompt(summary: string): string {
  return `Classify incident severity as a single integer from 1 to 5. 1 means suppress, 5 means urgent. Return only the integer.\n${summary}`;
}

export function buildAnomalyPrompt(input: { monitor: Monitor; latencyMs: number; mean: number; stddev: number; zScore: number }): string {
  return `Explain this latency anomaly in 1-2 sentences for an on-call developer.
Monitor: ${input.monitor.name}
URL path: ${new URL(input.monitor.url).pathname || "/"}
Current latency: ${input.latencyMs}ms
Rolling mean: ${Math.round(input.mean)}ms
Rolling stddev: ${Math.round(input.stddev)}ms
Z-score: ${input.zScore.toFixed(2)}`;
}
