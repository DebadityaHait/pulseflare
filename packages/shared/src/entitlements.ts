import type { Entitlements } from "./types";

export const MAX_GLOBAL_ACTIVE_MONITORS = 100;
export const MAX_AI_EVENTS_PER_WORKSPACE_PER_DAY = 10;

export const BETA_ENTITLEMENTS: Entitlements = {
  plan: "beta",
  maxActiveMonitors: 5,
  minIntervalS: 300,
  maxStatusPages: 1,
  maxIntegrations: 5,
  maxApiKeys: 3,
  rawRetentionDays: 7,
  hourlyRetentionDays: 90,
  aiEnabled: true
};

export function entitlementsForPlan(plan: Entitlements["plan"]): Entitlements {
  if (plan === "pro") return { ...BETA_ENTITLEMENTS, plan, maxActiveMonitors: 50, maxStatusPages: 3, maxIntegrations: 20, maxApiKeys: 10, rawRetentionDays: 30, hourlyRetentionDays: 365 };
  if (plan === "team") return { ...BETA_ENTITLEMENTS, plan, maxActiveMonitors: 200, maxStatusPages: 10, maxIntegrations: 50, maxApiKeys: 25, rawRetentionDays: 30, hourlyRetentionDays: 730 };
  return { ...BETA_ENTITLEMENTS, plan };
}

export function canCreateResource(current: number, limit: number): boolean {
  return current < limit;
}
