import { z } from "zod";

const blockedHostnames = new Set(["localhost", "metadata.google.internal"]);
const privateIpPatterns = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i
];

export function isValidMonitorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (blockedHostnames.has(host)) return false;
    if (privateIpPatterns.some((pattern) => pattern.test(host))) return false;
    return true;
  } catch {
    return false;
  }
}

const webhookUrl = z.string().url().refine((value) => value.startsWith("https://"), "Webhook URL must use https").optional();

const monitorSchemaBase = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().refine(isValidMonitorUrl, "URL must be a valid public http or https URL"),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  timeoutMs: z.number().int().min(500).max(30000).default(10000),
  expectedStatusMin: z.number().int().min(100).max(599).default(200),
  expectedStatusMax: z.number().int().min(100).max(599).default(299),
  public: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  notifyDiscordWebhook: webhookUrl,
  notifyTelegramChatId: z.string().trim().max(80).optional(),
  notifyGenericWebhook: webhookUrl
});

export const createMonitorSchema = monitorSchemaBase.refine((data) => data.expectedStatusMin <= data.expectedStatusMax, "Expected status range is invalid");

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
