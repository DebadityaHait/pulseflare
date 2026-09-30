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

export function buildIncidentIntelligencePrompt(input: { monitor: Monitor; incident: Incident; checks: Check[] }): string {
  const evidence = input.checks
    .slice(0, 12)
    .map((check) => `${check.checkedAt}: status=${check.status}, ok=${check.ok}, latency=${check.latencyMs}ms, error=${check.errorCode ?? "none"}`)
    .join("\n");
  return `You are an uptime incident assistant. Return ONLY valid JSON with this exact shape: {"summary":"string","probable_causes":["string"],"recommended_actions":["string"],"model_severity":1,"confidence":0.0}. model_severity must be an integer from 1 to 5 and confidence must be between 0 and 1. Never include secrets or full URLs.\nMonitor: ${input.monitor.name}\nPath: ${new URL(input.monitor.url).pathname || "/"}\nIncident status: ${input.incident.status}\nStarted: ${input.incident.startedAt}\nResolved: ${input.incident.resolvedAt ?? "not resolved"}\nRecent evidence:\n${evidence}`;
}

export interface IncidentIntelligence {
  summary: string;
  probableCauses: string[];
  recommendedActions: string[];
  modelSeverity: number;
  confidence: number;
}

export function parseIncidentIntelligence(output: string | null | undefined): IncidentIntelligence | null {
  if (!output) return null;
  try {
    const cleaned = output.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const probableCauses = Array.isArray(parsed.probable_causes) ? parsed.probable_causes.filter((value): value is string => typeof value === "string").slice(0, 5) : [];
    const recommendedActions = Array.isArray(parsed.recommended_actions) ? parsed.recommended_actions.filter((value): value is string => typeof value === "string").slice(0, 5) : [];
    const modelSeverity = typeof parsed.model_severity === "number" ? Math.round(parsed.model_severity) : Number(parsed.model_severity);
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
    if (!summary || !Number.isFinite(modelSeverity) || modelSeverity < 1 || modelSeverity > 5 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    return { summary, probableCauses, recommendedActions, modelSeverity, confidence };
  } catch {
    return null;
  }
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
