export type MonitorState = "unknown" | "up" | "pending_down" | "down" | "degraded" | "paused" | "maintenance";
export type HttpMethod = "GET" | "HEAD" | "POST";
export type MonitorType = "http" | "heartbeat";
export type AiStatus = "pending" | "complete" | "failed" | "fallback";
export type IncidentStatus = "open" | "acknowledged" | "investigating" | "identified" | "monitoring" | "resolved";

export interface Monitor {
  id: string;
  workspaceId?: string;
  name: string;
  url: string;
  type?: MonitorType;
  method: HttpMethod;
  expectedStatusMin: number;
  expectedStatusMax: number;
  intervalS: number;
  timeoutMs: number;
  latencyThresholdMs?: number | null;
  expectedText?: string | null;
  forbiddenText?: string | null;
  jsonPath?: string | null;
  heartbeatExpectedS?: number | null;
  heartbeatGraceS?: number | null;
  heartbeatUrl?: string | null;
  heartbeatLastAt?: string | null;
  heartbeatDeadlineAt?: string | null;
  secretConfigured?: boolean;
  lastCheckedAt?: string | null;
  lastState?: MonitorState;
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
  workspaceId?: string;
  monitorId: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  region?: string | null;
  errorCode?: string | null;
  errorMsg?: string | null;
  responseSizeBytes?: number | null;
  state?: MonitorState;
  confirmation?: boolean;
  cfColo?: string | null;
  checkedAt: string;
}

export interface Incident {
  id: string;
  workspaceId?: string;
  monitorId: string;
  type: "outage" | "degraded";
  status: IncidentStatus;
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
  aiProbableCauses?: string[];
  aiRecommendedActions?: string[];
  aiConfidence?: number | null;
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
  | { eventId: string; workspaceId: string; type: "incident.opened" | "incident.created"; monitorId: string; incidentId: string; checkId: number; createdAt: string }
  | { eventId: string; workspaceId: string; type: "incident.resolved"; monitorId: string; incidentId: string; checkId: number; createdAt: string }
  | { eventId: string; workspaceId: string; type: "anomaly.detected"; monitorId: string; anomalyId: string; checkId: number; createdAt: string };

export type AlertQueueEvent = {
  eventId: string;
  type: "notification.route" | "alert.route";
  workspaceId: string;
  eventType?: "incident.opened" | "incident.resolved" | "heartbeat.missed" | "maintenance.started" | "maintenance.completed" | "degraded";
  monitorId: string;
  incidentId?: string;
  anomalyId?: string;
  severity: number;
  summary: string;
  createdAt: string;
  integrationId?: string;
  test?: boolean;
};

export interface Workspace {
  id: string;
  clerkOrgId: string;
  name: string;
  slug: string;
  ownerClerkUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entitlements {
  plan: "beta" | "free" | "pro" | "team";
  maxActiveMonitors: number;
  minIntervalS: number;
  maxStatusPages: number;
  maxIntegrations: number;
  maxApiKeys: number;
  rawRetentionDays: number;
  hourlyRetentionDays: number;
  aiEnabled: boolean;
}

export interface Integration {
  id: string;
  workspaceId: string;
  kind: "browser_push" | "discord" | "slack" | "telegram" | "webhook";
  name: string;
  enabled: boolean;
  secretPreview?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRule {
  id: string;
  workspaceId: string;
  integrationId: string;
  eventTypes: string[];
  monitorIds: string[];
  minimumSeverity: number;
  enabled: boolean;
}

export interface StatusPage {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  description: string;
  brandColor: string;
  logoUrl?: string | null;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
