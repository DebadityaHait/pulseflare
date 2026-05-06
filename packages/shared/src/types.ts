export type MonitorState = "unknown" | "up" | "down" | "degraded";
export type HttpMethod = "GET" | "HEAD" | "POST";
export type AiStatus = "pending" | "complete" | "failed" | "fallback";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: HttpMethod;
  expectedStatusMin: number;
  expectedStatusMax: number;
  intervalS: number;
  timeoutMs: number;
  active: boolean;
  public: boolean;
  tags: string[];
  notifyDiscordWebhook?: string | null;
  notifyTelegramChatId?: string | null;
  notifyGenericWebhook?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Check {
  id: number;
  monitorId: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  region?: string | null;
  errorCode?: string | null;
  errorMsg?: string | null;
  responseSizeBytes?: number | null;
  checkedAt: string;
}

export interface Incident {
  id: string;
  monitorId: string;
  type: "outage" | "degraded";
  status: "open" | "resolved";
  startedAt: string;
  resolvedAt?: string | null;
  triggerCheckId?: number | null;
  recoveryCheckId?: number | null;
  failingStatus?: number | null;
  failingErrorCode?: string | null;
  aiSummary?: string | null;
  aiSummaryStatus: AiStatus;
  aiSeverity?: number | null;
  aiSeverityReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Anomaly {
  id: string;
  monitorId: string;
  checkId: number;
  latencyMs: number;
  rollingMeanMs: number;
  rollingStddevMs: number;
  zScore: number;
  aiExplanation?: string | null;
  aiStatus: AiStatus;
  createdAt: string;
}

export interface LatestStatus {
  monitorId: string;
  state: MonitorState;
  ok: boolean;
  status: number;
  latencyMs: number;
  checkedAt: string;
  region?: string | null;
  activeIncidentId?: string | null;
}

export type IncidentQueueEvent =
  | { type: "incident.created"; monitorId: string; incidentId: string; checkId: number; createdAt: string }
  | { type: "incident.resolved"; monitorId: string; incidentId: string; checkId: number; createdAt: string }
  | { type: "anomaly.detected"; monitorId: string; anomalyId: string; checkId: number; createdAt: string };

export type AlertQueueEvent = {
  type: "alert.route";
  monitorId: string;
  incidentId?: string;
  anomalyId?: string;
  severity: number;
  summary: string;
  createdAt: string;
};

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
