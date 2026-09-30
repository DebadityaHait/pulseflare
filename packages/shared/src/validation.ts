import { z } from "zod";

const blockedHostnames = new Set(["localhost", "localhost.", "metadata.google.internal", "metadata.google.internal.", "instance-data.ec2.internal"]);

export function isPrivateIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // Reject literals until the probe has a DNS-aware egress policy. In particular,
  // URL canonicalization turns mapped IPv4 into hex (::ffff:7f00:1).
  if (host.includes(":")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = numbers;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b));
}

export function isValidMonitorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (url.username || url.password || url.hostname.length === 0 || url.hostname.length > 253) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (blockedHostnames.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") || (!host.includes(".") && !host.includes(":"))) return false;
    if (isPrivateIpLiteral(host)) return false;
    return true;
  } catch {
    return false;
  }
}

const webhookUrl = z.string().url().refine((value) => value.startsWith("https://") && isValidMonitorUrl(value), "Webhook URL must use public https").optional();

const monitorSchemaBase = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["http", "heartbeat"]).default("http"),
  url: z.string().refine(isValidMonitorUrl, "URL must be a valid public http or https URL"),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  intervalS: z.number().int().min(300).max(86400).default(300),
  timeoutMs: z.number().int().min(500).max(30000).default(10000),
  expectedStatusMin: z.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.number().int().min(100).max(599).default(299),
  public: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  headers: z.record(z.string().trim().max(200), z.string().max(2000)).optional(),
  requestBody: z.string().max(32768).optional(),
  expectedText: z.string().max(500).optional(),
  forbiddenText: z.string().max(500).optional(),
  jsonPath: z.string().regex(/^[A-Za-z0-9_$.[\]-]+$/).max(120).optional(),
  latencyThresholdMs: z.number().int().min(1).max(120000).nullable().optional(),
  heartbeatExpectedS: z.number().int().min(60).max(2592000).optional(),
  heartbeatGraceS: z.number().int().min(0).max(2592000).optional(),
  notifyDiscordWebhook: webhookUrl,
  notifyTelegramChatId: z.string().trim().max(80).optional(),
  notifyGenericWebhook: webhookUrl
});

export const createMonitorSchema = monitorSchemaBase.superRefine((data, ctx) => {
  if (data.expectedStatusMin > data.expectedStatusMax) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected status range is invalid", path: ["expectedStatusMax"] });
  if (data.type === "heartbeat" && !data.heartbeatExpectedS) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Heartbeat monitors require an expected frequency", path: ["heartbeatExpectedS"] });
  if (data.type === "heartbeat" && data.method !== "GET") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Heartbeat monitors use GET", path: ["method"] });
});

export const updateMonitorSchema = monitorSchemaBase.partial().refine((data) => {
  if (data.expectedStatusMin === undefined || data.expectedStatusMax === undefined) return true;
  return data.expectedStatusMin <= data.expectedStatusMax;
}, "Expected status range is invalid");

export const settingsSchema = z.object({
  pageTitle: z.string().trim().min(1).max(120).optional(),
  pageDescription: z.string().trim().max(240).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  showHistoryDays: z.number().int().min(1).max(90).optional()
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

export const integrationSchema = z.object({
  kind: z.enum(["browser_push", "discord", "slack", "telegram", "webhook"]),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  config: z.record(z.string().max(5000)).default({}),
  eventTypes: z.array(z.string()).max(10).default(["incident.opened", "incident.resolved"]),
  monitorIds: z.array(z.string().max(64)).max(100).default([]),
  minimumSeverity: z.number().int().min(1).max(5).default(1)
});

export const maintenanceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  monitorIds: z.array(z.string().max(64)).max(100).default([]),
  public: z.boolean().default(true)
}).refine((data) => Date.parse(data.endsAt) > Date.parse(data.startsAt), "Maintenance must end after it starts");

export const statusPageSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(50),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default("Current system status and recent incidents."),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0e9eb8"),
  logoUrl: z.string().url().optional(),
  published: z.boolean().default(true)
});

export const incidentUpdateSchema = z.object({
  status: z.enum(["open", "acknowledged", "investigating", "identified", "monitoring", "resolved"]).optional(),
  message: z.string().trim().min(1).max(4000),
  public: z.boolean().default(false)
});

export const apiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(["monitors:read", "monitors:write", "incidents:read", "status:read", "heartbeat:write"])).min(1).max(10).default(["monitors:read"]),
  expiresAt: z.string().datetime().nullable().optional()
});
