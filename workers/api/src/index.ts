import { createClerkClient } from "@clerk/backend";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  BETA_ENTITLEMENTS,
  MAX_GLOBAL_ACTIVE_MONITORS,
  apiKeySchema,
  createMonitorSchema,
  entitlementsForPlan,
  incidentUpdateSchema,
  integrationSchema,
  isValidMonitorUrl,
  maintenanceSchema,
  paginationSchema,
  randomToken,
  redactSecret,
  sha256Hex,
  statusPageSchema,
  encryptSecret,
  recordHeartbeat,
  runHttpMonitor,
  flushOutbox,
  incidentOutbox,
  databaseBudget,
  isDatabaseLimit,
  type AlertQueueEvent,
  type Entitlements,
  type IncidentQueueEvent,
  type Monitor,
  type MonitorState,
  type Workspace,
} from "@pulseflare/shared";

export interface Env {
  DB: D1Database;
  STATUS_KV?: KVNamespace;
  ALERT_QUEUE?: Queue<AlertQueueEvent>;
  INCIDENT_QUEUE?: Queue<IncidentQueueEvent>;
  MONITOR_COORDINATOR?: DurableObjectNamespace;
  ARCHIVE_BUCKET?: R2Bucket;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  SECRET_ENCRYPTION_KEY?: string;
  TURNSTILE_SECRET?: string;
  INTERNAL_ADMIN_TOKEN?: string;
  DEV_AUTH_BYPASS?: string;
  ALLOWED_ORIGIN?: string;
  RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

type AuthContext = {
  userId: string;
  clerkOrgId: string;
  workspaceId: string;
  role: "admin" | "member";
  scopes: string[];
  via: "clerk" | "api_key" | "development";
};

type Variables = { auth: AuthContext };
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

type DbRow = Record<string, unknown>;

// Deny by default: a read-only monitor key must never manage keys, secrets, or billing.
export function requiredApiKeyScope(
  method: string,
  path: string,
): string | null {
  if (/^\/api\/monitors(?:\/[^/]+)?$/.test(path))
    return method === "GET"
      ? "monitors:read"
      : ["POST", "PATCH", "DELETE"].includes(method)
        ? "monitors:write"
        : null;
  if (method === "GET" && /^\/api\/monitors\/[^/]+\/(checks|stats)$/.test(path))
    return "monitors:read";
  if (
    method === "POST" &&
    /^\/api\/monitors\/[^/]+\/(pause|resume|test|rotate-secret)$/.test(path)
  )
    return "monitors:write";
  if (
    method === "GET" &&
    (/^\/api\/incidents(?:\/[^/]+)?$/.test(path) ||
      /^\/api\/monitors\/[^/]+\/incidents$/.test(path))
  )
    return "incidents:read";
  if (method === "GET" && path === "/api/status-pages") return "status:read";
  return null;
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

function value<T>(row: DbRow | null | undefined, key: string, fallback: T): T {
  return row && row[key] !== undefined && row[key] !== null
    ? (row[key] as T)
    : fallback;
}

function asBool(input: unknown): boolean {
  return Number(input) === 1 || input === true;
}

function asArray(input: unknown): string[] {
  if (Array.isArray(input))
    return input.filter((item): item is string => typeof item === "string");
  try {
    const parsed = JSON.parse(String(input ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

// Constrain both leading index columns before the timestamp range. A workspace-
// only aggregate otherwise scans all retained prototype history on every read.
const recentMetricsSql = `(SELECT json_object('count',COUNT(*),'success',COALESCE(SUM(ok),0),'latency',COALESCE(AVG(latency_ms),0)) FROM checks WHERE workspace_id=m.workspace_id AND monitor_id=m.id AND checked_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day'))`;
function recentMetrics(row: DbRow) {
  return JSON.parse(String(row.metrics ?? "{}")) as {
    count: number;
    success: number;
    latency: number;
  };
}

function parseJson(c: AppContext): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new SyntaxError("Request body must be valid JSON");
  });
}

function requestId(c: AppContext): string {
  return c.req.header("x-request-id") ?? crypto.randomUUID();
}

function mapWorkspace(row: DbRow): Workspace {
  return {
    id: String(row.id),
    clerkOrgId: String(row.clerk_org_id),
    name: String(row.name),
    slug: String(row.slug),
    ownerClerkUserId: row.owner_clerk_user_id
      ? String(row.owner_clerk_user_id)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMonitor(row: DbRow): Monitor {
  const type = value(row, "monitor_type", "http") as "http" | "heartbeat";
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    url: String(row.url ?? ""),
    type,
    method: value(row, "method", "GET") as Monitor["method"],
    expectedStatusMin: Number(value(row, "expected_status_min", 200)),
    expectedStatusMax: Number(value(row, "expected_status_max", 299)),
    intervalS: Number(value(row, "interval_s", 300)),
    timeoutMs: Number(value(row, "timeout_ms", 10000)),
    latencyThresholdMs:
      row.latency_threshold_ms === null ||
      row.latency_threshold_ms === undefined
        ? null
        : Number(row.latency_threshold_ms),
    expectedText: row.expected_text ? String(row.expected_text) : null,
    forbiddenText: row.forbidden_text ? String(row.forbidden_text) : null,
    jsonPath: row.json_path ? String(row.json_path) : null,
    heartbeatExpectedS: row.heartbeat_expected_s
      ? Number(row.heartbeat_expected_s)
      : null,
    heartbeatGraceS:
      row.heartbeat_grace_s === null || row.heartbeat_grace_s === undefined
        ? null
        : Number(row.heartbeat_grace_s),
    heartbeatUrl: null,
    heartbeatLastAt: row.heartbeat_last_at
      ? String(row.heartbeat_last_at)
      : null,
    heartbeatDeadlineAt: row.heartbeat_deadline_at
      ? String(row.heartbeat_deadline_at)
      : null,
    secretConfigured: Boolean(
      row.headers_ciphertext || row.heartbeat_secret_hash,
    ),
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    lastState: value(row, "last_state", "unknown") as MonitorState,
    active: asBool(row.active),
    public: asBool(row.public),
    tags: asArray(row.tags),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapIntegration(row: DbRow) {
  const preview = row.secret_preview ? String(row.secret_preview) : null;
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind),
    name: String(row.name),
    enabled: asBool(row.enabled),
    secretPreview: preview,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function entitlementsFrom(row: DbRow | null | undefined): Entitlements {
  if (!row) return BETA_ENTITLEMENTS;
  return {
    ...entitlementsForPlan(value(row, "plan", "beta") as Entitlements["plan"]),
    maxActiveMonitors: Number(value(row, "max_active_monitors", 5)),
    minIntervalS: Number(value(row, "min_interval_s", 300)),
    maxStatusPages: Number(value(row, "max_status_pages", 1)),
    maxIntegrations: Number(value(row, "max_integrations", 5)),
    maxApiKeys: Number(value(row, "max_api_keys", 3)),
    rawRetentionDays: Number(value(row, "raw_retention_days", 7)),
    hourlyRetentionDays: Number(value(row, "hourly_retention_days", 90)),
    aiEnabled: asBool(value(row, "ai_enabled", 1)),
  };
}

async function ensureWorkspace(
  env: Env,
  clerkOrgId: string,
  userId: string,
  name = "Pulseflare Workspace",
): Promise<Workspace> {
  const id = `ws_${(await sha256Hex(clerkOrgId)).slice(0, 24)}`;
  const slug = `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "workspace"
  }-${id.slice(-6)}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (id, clerk_org_id, owner_clerk_user_id, name, slug) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, clerkOrgId, userId, name, slug)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO workspace_entitlements (workspace_id) VALUES (?)`,
  )
    .bind(id)
    .run();
  const row = await env.DB.prepare(
    `SELECT * FROM workspaces WHERE id = ? AND clerk_org_id = ?`,
  )
    .bind(id, clerkOrgId)
    .first<DbRow>();
  if (!row) throw new Error("Workspace could not be initialized");
  return mapWorkspace(row);
}

async function authenticateApiKey(
  env: Env,
  token: string,
): Promise<AuthContext | null> {
  if (!token.startsWith("pf_live_")) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT k.*, w.clerk_org_id FROM api_keys k JOIN workspaces w ON w.id = k.workspace_id
     WHERE k.sha256_hash = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR julianday(k.expires_at) > julianday('now'))`,
  )
    .bind(hash)
    .first<DbRow>();
  if (!row) return null;
  await env.DB.prepare(
    `UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
  )
    .bind(row.id)
    .run();
  return {
    userId: String(row.created_by ?? "api-key"),
    clerkOrgId: String(row.clerk_org_id),
    workspaceId: String(row.workspace_id),
    role: "admin",
    scopes: asArray(row.scopes),
    via: "api_key",
  };
}

async function authenticate(c: AppContext): Promise<AuthContext | null> {
  const authorization = c.req.header("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const apiKey = await authenticateApiKey(c.env, bearer);
  if (apiKey) return apiKey;

  if (
    c.env.DEV_AUTH_BYPASS === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(c.req.url).hostname)
  ) {
    const workspaceId = c.req.header("x-workspace-id") ?? "legacy";
    const workspace = await c.env.DB.prepare(
      `SELECT * FROM workspaces WHERE id = ?`,
    )
      .bind(workspaceId)
      .first<DbRow>();
    if (workspace)
      return {
        userId: "development",
        clerkOrgId: String(workspace.clerk_org_id),
        workspaceId,
        role: "admin",
        scopes: ["*"],
        via: "development",
      };
  }

  if (!c.env.CLERK_SECRET_KEY || !c.env.CLERK_AUTHORIZED_PARTIES?.trim())
    return null;
  try {
    const clerk = createClerkClient({
      secretKey: c.env.CLERK_SECRET_KEY,
      publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
    });
    const state = await clerk.authenticateRequest(c.req.raw, {
      authorizedParties: (c.env.CLERK_AUTHORIZED_PARTIES ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    });
    if (!state.isAuthenticated) return null;
    const auth = state.toAuth() as {
      userId: string;
      orgId: string | null;
      orgRole: string | null;
    };
    if (!auth.userId || !auth.orgId) return null;
    const workspace = await ensureWorkspace(c.env, auth.orgId, auth.userId);
    return {
      userId: auth.userId,
      clerkOrgId: auth.orgId,
      workspaceId: workspace.id,
      role:
        auth.orgRole?.endsWith(":admin") || auth.orgRole === "admin"
          ? "admin"
          : "member",
      scopes: ["*"],
      via: "clerk",
    };
  } catch (error) {
    if (isDatabaseLimit(error)) throw error;
    console.log(
      JSON.stringify({
        level: "warn",
        event: "auth.failed",
        request_id: requestId(c),
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return null;
  }
}

function hasScope(c: AppContext, scope: string): boolean {
  const scopes = c.get("auth").scopes;
  return scopes.includes("*") || scopes.includes(scope);
}

function isAdmin(c: AppContext): boolean {
  return (
    c.get("auth").role === "admin" ||
    c.get("auth").via === "api_key" ||
    c.get("auth").via === "development"
  );
}

async function requireAdmin(c: AppContext): Promise<Response | null> {
  if (!isAdmin(c))
    return fail("FORBIDDEN", "Workspace admin access is required", 403);
  return null;
}

async function audit(
  c: AppContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: unknown = {},
) {
  const auth = c.get("auth");
  await c.env.DB.prepare(
    `INSERT INTO audit_events (workspace_id, actor_clerk_user_id, action, resource_type, resource_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      auth.workspaceId,
      auth.userId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata),
    )
    .run();
}

async function rateLimit(
  c: AppContext,
  bucket: string,
  limit = 60,
  windowSeconds = 60,
): Promise<boolean> {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  return c.env.RATE_LIMITER
    ? (await c.env.RATE_LIMITER.limit({ key: `${bucket}:${ip}` })).success
    : true;
}

async function sendCoordinator(
  c: AppContext,
  monitorId: string,
  path: string,
  body?: unknown,
) {
  if (!c.env.MONITOR_COORDINATOR) return;
  const id = c.env.MONITOR_COORDINATOR.idFromName(`monitor:${monitorId}`);
  const stub = c.env.MONITOR_COORDINATOR.get(id);
  await stub.fetch(
    `https://monitor-coordinator${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}

async function getMonitor(
  c: AppContext,
  monitorId: string,
): Promise<DbRow | null> {
  return c.env.DB.prepare(
    `SELECT * FROM monitors WHERE id = ? AND workspace_id = ?`,
  )
    .bind(monitorId, c.get("auth").workspaceId)
    .first<DbRow>();
}

async function createEncrypted(valueToEncrypt: unknown, env: Env) {
  if (!valueToEncrypt) return null;
  if (!env.SECRET_ENCRYPTION_KEY)
    throw new Error("Secret encryption is not configured");
  return encryptSecret(
    JSON.stringify(valueToEncrypt),
    env.SECRET_ENCRYPTION_KEY,
  );
}

async function publicSnapshot(env: Env, slug: string) {
  const page = await env.DB.prepare(
    `SELECT * FROM status_pages WHERE slug = ? AND published = 1`,
  )
    .bind(slug)
    .first<DbRow>();
  if (!page) return null;
  const workspaceId = String(page.workspace_id);
  const monitorRows = await env.DB.prepare(
    `SELECT m.id, m.name, m.last_state, m.last_checked_at, m.last_check_id, m.public,${recentMetricsSql} AS metrics
     FROM monitors m
     WHERE m.workspace_id = ? AND m.active = 1 AND m.public = 1 AND EXISTS(SELECT 1 FROM status_component_monitors scm JOIN status_components sc ON sc.id=scm.component_id AND sc.workspace_id=scm.workspace_id WHERE scm.monitor_id=m.id AND scm.workspace_id=m.workspace_id AND sc.status_page_id=?) ORDER BY m.name ASC`,
  )
    .bind(workspaceId, page.id)
    .all<DbRow>();
  const incidents = await env.DB.prepare(
    `SELECT i.id, i.monitor_id, m.name AS monitor_name, i.status, i.started_at, i.resolved_at,
      (SELECT u.message FROM incident_updates u WHERE u.incident_id = i.id AND u.workspace_id = i.workspace_id AND u.public = 1 ORDER BY u.created_at DESC LIMIT 1) AS ai_summary
     FROM incidents i JOIN monitors m ON m.id = i.monitor_id AND m.workspace_id = i.workspace_id
     WHERE i.workspace_id = ? AND m.public = 1 AND i.status <> 'resolved' AND EXISTS(SELECT 1 FROM status_component_monitors scm JOIN status_components sc ON sc.id=scm.component_id AND sc.workspace_id=scm.workspace_id WHERE scm.monitor_id=m.id AND scm.workspace_id=m.workspace_id AND sc.status_page_id=?) ORDER BY i.started_at DESC LIMIT 50`,
  )
    .bind(workspaceId, page.id)
    .all<DbRow>();
  const maintenance = await env.DB.prepare(
    `SELECT id, title, description, starts_at, ends_at, public FROM maintenance_windows
     WHERE workspace_id = ? AND public = 1 AND julianday(starts_at) <= julianday('now') AND julianday(ends_at) >= julianday('now') ORDER BY starts_at ASC`,
  )
    .bind(workspaceId)
    .all<DbRow>();
  const monitors = (monitorRows.results ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    state: String(row.last_state ?? "unknown"),
    status: 0,
    latencyMs: Math.round(recentMetrics(row).latency),
    uptime24h: recentMetrics(row).count
      ? Math.round(
          (recentMetrics(row).success / recentMetrics(row).count) * 10000,
        ) / 100
      : null,
    checkedAt: row.last_checked_at ? String(row.last_checked_at) : null,
  }));
  const overallState = maintenance.results?.length
    ? "maintenance"
    : monitors.some((item) => item.state === "down")
      ? "major_outage"
      : monitors.some((item) => item.state === "degraded")
        ? "degraded"
        : !monitors.length || monitors.some((item) => item.state !== "up")
          ? "unknown"
          : "operational";
  return {
    page: {
      id: String(page.id),
      slug,
      title: String(page.title),
      description: String(page.description),
      brandColor: String(page.brand_color),
      logoUrl: page.logo_url ? String(page.logo_url) : null,
      updatedAt: String(page.updated_at),
    },
    overallState,
    monitors,
    activeIncidents: incidents.results ?? [],
    maintenance: maintenance.results ?? [],
  };
}

app.use("*", async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN || "";
  return cors({
    origin: origin === "*" ? "*" : origin.split(",").map((item) => item.trim()),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "X-Workspace-Id",
      "X-Turnstile-Token",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })(c, next);
});

app.use(
  "/api/*",
  bodyLimit({
    maxSize: 1_000_000,
    onError: () => fail("BODY_TOO_LARGE", "Request body is too large", 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.method === "OPTIONS") return next();
  const budget = await databaseBudget(c.env.DB);
  c.env = { ...c.env, DB: budget.DB };
  try {
    await next();
  } finally {
    await budget.finish();
  }
});
app.use("/api/*", async (c, next) => {
  if (
    c.req.method !== "GET" &&
    Number(c.req.header("content-length") ?? 0) > 1_000_000
  )
    return c.json(
      {
        ok: false,
        error: { code: "BODY_TOO_LARGE", message: "Request body is too large" },
      },
      413,
    );
  const publicRoute =
    c.req.path === "/api/health" ||
    c.req.path === "/api/status" ||
    c.req.path.startsWith("/api/status/") ||
    c.req.path.startsWith("/api/heartbeat/");
  if (publicRoute) return next();
  const auth = await authenticate(c);
  if (!auth)
    return c.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Sign in with Clerk or provide a valid workspace API key",
        },
      },
      401,
    );
  c.set("auth", auth);
  if (auth.via === "api_key") {
    const scope = requiredApiKeyScope(c.req.method, c.req.path);
    if (!scope || !auth.scopes.includes(scope))
      return fail(
        "FORBIDDEN",
        "API key is not authorized for this operation",
        403,
      );
  }
  if (
    auth.role !== "admin" &&
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    !/^\/api\/incidents\/[^/]+\/(acknowledge|update|resolve)$/.test(c.req.path)
  )
    return fail("FORBIDDEN", "Workspace admin access is required", 403);
  if (!(await rateLimit(c, "api")))
    return c.json(
      {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      },
      429,
    );
  return next();
});

app.get("/api/health", (c) =>
  c.json(
    ok({
      name: "Pulseflare API",
      status: "ok",
      checkedAt: new Date().toISOString(),
      requestId: requestId(c),
    }),
  ),
);

async function statusHandler(c: AppContext, slug: string) {
  const cacheKey = new Request(
    `${new URL(c.req.url).origin}/__status-cache/${slug}`,
  );
  const cache =
    typeof caches !== "undefined"
      ? await caches.open("pulseflare-status")
      : undefined;
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;
  const snapshot = await publicSnapshot(c.env, slug);
  if (!snapshot) return fail("NOT_FOUND", "Status page not found", 404);
  const response = c.json(ok(snapshot), 200, {
    "cache-control": "public, max-age=120",
    etag: `"${await sha256Hex(JSON.stringify(snapshot))}"`,
  });
  if (cache) await cache.put(cacheKey, response.clone());
  return response;
}

app.get("/api/status", (c) => statusHandler(c, "legacy"));
app.get("/api/status/:slug", (c) => statusHandler(c, c.req.param("slug")));
app.get("/api/status/:slug/incidents", async (c) => {
  const response = await statusHandler(c, c.req.param("slug"));
  if (!response.ok) return response;
  const snapshot = (await response.json()) as {
    data: { activeIncidents: unknown[] };
  };
  return c.json(ok(snapshot.data.activeIncidents), 200, {
    "cache-control": "public, max-age=120",
  });
});
app.get("/api/status/:slug/history", async (c) => {
  const page = await c.env.DB.prepare(
    `SELECT workspace_id FROM status_pages WHERE slug = ? AND published = 1`,
  )
    .bind(c.req.param("slug"))
    .first<{ workspace_id: string }>();
  if (!page) return fail("NOT_FOUND", "Status page not found", 404);
  const rows = await c.env.DB.prepare(
    `SELECT i.id,i.monitor_id,m.name AS monitor_name,i.status,i.started_at,i.resolved_at,(SELECT u.message FROM incident_updates u WHERE u.incident_id=i.id AND u.workspace_id=i.workspace_id AND u.public=1 ORDER BY u.created_at DESC LIMIT 1) AS message FROM incidents i JOIN monitors m ON m.id=i.monitor_id AND m.workspace_id=i.workspace_id WHERE i.workspace_id=? AND m.public=1 AND EXISTS(SELECT 1 FROM status_component_monitors scm JOIN status_components sc ON sc.id=scm.component_id AND sc.workspace_id=scm.workspace_id JOIN status_pages p ON p.id=sc.status_page_id AND p.workspace_id=sc.workspace_id WHERE scm.monitor_id=m.id AND scm.workspace_id=m.workspace_id AND p.slug=?) ORDER BY i.started_at DESC LIMIT 100`,
  )
    .bind(page.workspace_id, c.req.param("slug"))
    .all();
  return c.json(ok(rows.results ?? []), 200, {
    "cache-control": "public, max-age=45",
  });
});

app.on(["GET", "POST"], "/api/heartbeat/:secret", async (c) => {
  if (!(await rateLimit(c, "heartbeat", 30)))
    return c.json(
      {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many heartbeat requests" },
      },
      429,
    );
  const secretHash = await sha256Hex(c.req.param("secret"));
  const accepted = await recordHeartbeat(c.env, secretHash);
  if (!accepted) return fail("NOT_FOUND", "Heartbeat endpoint not found", 404);
  await flushOutbox(c.env);
  return c.json(ok(accepted), 200, {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
});

app.get("/api/workspace", async (c) => {
  const auth = c.get("auth");
  const row = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(auth.workspaceId)
    .first<DbRow>();
  const entitlements = await c.env.DB.prepare(
    `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
  )
    .bind(auth.workspaceId)
    .first<DbRow>();
  return c.json(
    ok({
      workspace: row ? mapWorkspace(row) : null,
      role: auth.role,
      entitlements: entitlementsFrom(entitlements),
    }),
  );
});

app.patch("/api/workspace", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = z
    .object({ name: z.string().trim().min(1).max(100) })
    .parse(await parseJson(c));
  await c.env.DB.prepare(
    `UPDATE workspaces SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
  )
    .bind(input.name, c.get("auth").workspaceId)
    .run();
  await audit(c, "workspace.updated", "workspace", c.get("auth").workspaceId, {
    name: input.name,
  });
  return c.json(ok({ updated: true }));
});

app.get("/api/usage", async (c) => {
  const workspaceId = c.get("auth").workspaceId;
  const entitlements = entitlementsFrom(
    await c.env.DB.prepare(
      `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<DbRow>(),
  );
  const [monitors, integrations, statusPages, apiKeys, usage] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM monitors WHERE workspace_id = ? AND active = 1`,
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM integrations WHERE workspace_id = ? AND enabled = 1`,
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM status_pages WHERE workspace_id = ?`,
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL`,
      )
        .bind(workspaceId)
        .first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT * FROM usage_daily WHERE workspace_id = ? AND usage_date = date('now')`,
      )
        .bind(workspaceId)
        .first<DbRow>(),
    ]);
  return c.json(
    ok({
      entitlements,
      current: {
        activeMonitors: monitors?.count ?? 0,
        integrations: integrations?.count ?? 0,
        statusPages: statusPages?.count ?? 0,
        apiKeys: apiKeys?.count ?? 0,
        checksScheduled: Number(usage?.checks_scheduled ?? 0),
        checksCompleted: Number(usage?.checks_completed ?? 0),
        aiEnrichments: Number(usage?.ai_enrichments ?? 0),
      },
    }),
  );
});

app.get("/api/monitors", async (c) => {
  if (!hasScope(c, "monitors:read"))
    return fail("FORBIDDEN", "API key lacks monitors:read scope", 403);
  const rows = await c.env.DB.prepare(
    `SELECT m.*,latest.latency_ms AS latest_latency_ms,${recentMetricsSql} AS metrics FROM monitors m
     LEFT JOIN checks latest ON latest.id=m.last_check_id AND latest.workspace_id=m.workspace_id
     WHERE m.workspace_id = ? ORDER BY m.created_at DESC`,
  )
    .bind(c.get("auth").workspaceId)
    .all<DbRow>();
  return c.json(
    ok(
      (rows.results ?? []).map((row) => ({
        ...mapMonitor(row),
        uptime24h: recentMetrics(row).count
          ? Math.round(
              (recentMetrics(row).success / recentMetrics(row).count) * 10000,
            ) / 100
          : null,
        latestLatencyMs:
          row.latest_latency_ms == null ? null : Number(row.latest_latency_ms),
      })),
    ),
  );
});

app.post("/api/monitors", async (c) => {
  if (!hasScope(c, "monitors:write"))
    return fail("FORBIDDEN", "API key lacks monitors:write scope", 403);
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  try {
    const input = createMonitorSchema.parse(await parseJson(c));
    const workspaceId = c.get("auth").workspaceId;
    const entitlements = entitlementsFrom(
      await c.env.DB.prepare(
        `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
      )
        .bind(workspaceId)
        .first<DbRow>(),
    );
    const active = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM monitors WHERE workspace_id = ? AND active = 1`,
    )
      .bind(workspaceId)
      .first<{ count: number }>();
    const global = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM monitors WHERE active = 1`,
    ).first<{ count: number }>();
    if ((active?.count ?? 0) >= entitlements.maxActiveMonitors)
      return fail(
        "QUOTA_EXCEEDED",
        `Beta workspaces can have ${entitlements.maxActiveMonitors} active monitors`,
        429,
      );
    if ((global?.count ?? 0) >= MAX_GLOBAL_ACTIVE_MONITORS)
      return fail(
        "CAPACITY_REACHED",
        "Pulseflare beta monitor capacity has been reached",
        503,
      );
    const intervalS = Math.max(input.intervalS, entitlements.minIntervalS);
    const heartbeatSecret =
      input.type === "heartbeat" ? `hb_${randomToken(24)}` : null;
    const encryptedHeaders = await createEncrypted(input.headers, c.env);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const row = await c.env.DB.prepare(
      `INSERT INTO monitors (id, workspace_id, name, url, monitor_type, method, expected_status_min, expected_status_max, interval_s, timeout_ms, public, tags, headers_ciphertext, headers_iv, headers_version, request_body, expected_text, forbidden_text, json_path, latency_threshold_ms, heartbeat_expected_s, heartbeat_grace_s, heartbeat_secret_hash, heartbeat_secret_prefix, heartbeat_deadline_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(
        id,
        workspaceId,
        input.name,
        input.url ?? "",
        input.type,
        input.method,
        input.expectedStatusMin,
        input.expectedStatusMax,
        intervalS,
        input.timeoutMs,
        input.public ? 1 : 0,
        JSON.stringify(input.tags),
        encryptedHeaders?.ciphertext ?? null,
        encryptedHeaders?.iv ?? null,
        encryptedHeaders?.version ?? null,
        input.requestBody ?? null,
        input.expectedText ?? null,
        input.forbiddenText ?? null,
        input.jsonPath ?? null,
        input.latencyThresholdMs ?? null,
        input.heartbeatExpectedS ?? null,
        input.heartbeatGraceS ?? 0,
        heartbeatSecret ? await sha256Hex(heartbeatSecret) : null,
        heartbeatSecret ? heartbeatSecret.slice(0, 11) : null,
        heartbeatSecret
          ? new Date(
              Date.now() +
                ((input.heartbeatExpectedS ?? 86400) +
                  (input.heartbeatGraceS ?? 0)) *
                  1000,
            ).toISOString()
          : null,
      )
      .first<DbRow>();
    if (!row) return fail("CREATE_FAILED", "Monitor could not be created", 500);
    await audit(c, "monitor.created", "monitor", id, {
      type: input.type,
      intervalS,
    });
    await sendCoordinator(c, id, "/sync");
    return c.json(
      ok({
        monitor: mapMonitor(row),
        heartbeatSecret,
        heartbeatUrl: heartbeatSecret
          ? `${new URL(c.req.url).origin}/api/heartbeat/${heartbeatSecret}`
          : null,
      }),
      201,
      { "cache-control": "no-store" },
    );
  } catch (error) {
    if (isDatabaseLimit(error)) throw error;
    return fail(
      "VALIDATION_ERROR",
      error instanceof z.ZodError
        ? (error.errors[0]?.message ?? "Invalid payload")
        : error instanceof Error
          ? error.message
          : "Invalid payload",
    );
  }
});

app.get("/api/monitors/:id", async (c) => {
  if (!hasScope(c, "monitors:read"))
    return fail("FORBIDDEN", "API key lacks monitors:read scope", 403);
  const row = await getMonitor(c, c.req.param("id"));
  if (!row) return fail("NOT_FOUND", "Monitor not found", 404);
  return c.json(ok(mapMonitor(row)));
});

app.patch("/api/monitors/:id", async (c) => {
  if (!hasScope(c, "monitors:write"))
    return fail("FORBIDDEN", "API key lacks monitors:write scope", 403);
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const existing = await getMonitor(c, c.req.param("id"));
  if (!existing) return fail("NOT_FOUND", "Monitor not found", 404);
  try {
    const raw = (await parseJson(c)) as Record<string, unknown>;
    const current = mapMonitor(existing);
    if (raw.type && raw.type !== current.type)
      return fail(
        "VALIDATION_ERROR",
        "A monitor's type cannot be changed. Create a new monitor instead.",
      );
    const input = createMonitorSchema.parse({
      name: raw.name ?? current.name,
      url: raw.url ?? current.url,
      type: raw.type ?? current.type ?? "http",
      method: raw.method ?? current.method,
      intervalS: raw.intervalS ?? current.intervalS,
      timeoutMs: raw.timeoutMs ?? current.timeoutMs,
      expectedStatusMin: raw.expectedStatusMin ?? current.expectedStatusMin,
      expectedStatusMax: raw.expectedStatusMax ?? current.expectedStatusMax,
      public: raw.public ?? current.public,
      tags: raw.tags ?? current.tags,
      headers: raw.headers,
      requestBody: raw.requestBody ?? existing.request_body ?? undefined,
      expectedText: raw.expectedText ?? current.expectedText ?? undefined,
      forbiddenText: raw.forbiddenText ?? current.forbiddenText ?? undefined,
      jsonPath: raw.jsonPath ?? current.jsonPath ?? undefined,
      latencyThresholdMs:
        raw.latencyThresholdMs === undefined
          ? current.latencyThresholdMs
          : raw.latencyThresholdMs,
      heartbeatExpectedS:
        raw.heartbeatExpectedS ?? current.heartbeatExpectedS ?? undefined,
      heartbeatGraceS:
        raw.heartbeatGraceS ?? current.heartbeatGraceS ?? undefined,
    });
    const entitlements = entitlementsFrom(
      await c.env.DB.prepare(
        `SELECT * FROM workspace_entitlements WHERE workspace_id=?`,
      )
        .bind(c.get("auth").workspaceId)
        .first<DbRow>(),
    );
    input.intervalS = Math.max(input.intervalS, entitlements.minIntervalS);
    const encryptedHeaders = raw.headers
      ? await createEncrypted(input.headers, c.env)
      : null;
    const row = await c.env.DB.prepare(
      `UPDATE monitors SET name=?, url=?, monitor_type=?, method=?, expected_status_min=?, expected_status_max=?, interval_s=?, timeout_ms=?, public=?, tags=?, headers_ciphertext=COALESCE(?, headers_ciphertext), headers_iv=COALESCE(?, headers_iv), headers_version=COALESCE(?, headers_version), request_body=?, expected_text=?, forbidden_text=?, json_path=?, latency_threshold_ms=?, heartbeat_expected_s=?, heartbeat_grace_s=?, check_lease_token=NULL, check_lease_until=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=? RETURNING *`,
    )
      .bind(
        input.name,
        input.url ?? "",
        input.type,
        input.method,
        input.expectedStatusMin,
        input.expectedStatusMax,
        input.intervalS,
        input.timeoutMs,
        input.public ? 1 : 0,
        JSON.stringify(input.tags),
        encryptedHeaders?.ciphertext ?? null,
        encryptedHeaders?.iv ?? null,
        encryptedHeaders?.version ?? null,
        input.requestBody ?? null,
        input.expectedText ?? null,
        input.forbiddenText ?? null,
        input.jsonPath ?? null,
        input.latencyThresholdMs ?? null,
        input.heartbeatExpectedS ?? null,
        input.heartbeatGraceS ?? 0,
        c.req.param("id"),
        c.get("auth").workspaceId,
      )
      .first<DbRow>();
    await audit(c, "monitor.updated", "monitor", c.req.param("id"), {
      fields: Object.keys(raw).filter(
        (key) => !["headers", "requestBody"].includes(key),
      ),
    });
    if (input.type === "heartbeat")
      await c.env.DB.prepare(
        `UPDATE monitors SET heartbeat_deadline_at=strftime('%Y-%m-%dT%H:%M:%SZ',COALESCE(heartbeat_last_at,updated_at),'+' || (heartbeat_expected_s+COALESCE(heartbeat_grace_s,0)) || ' seconds') WHERE id=? AND workspace_id=?`,
      )
        .bind(c.req.param("id"), c.get("auth").workspaceId)
        .run();
    await sendCoordinator(c, c.req.param("id"), "/sync");
    return c.json(ok(mapMonitor(row ?? existing)));
  } catch (error) {
    if (isDatabaseLimit(error)) throw error;
    return fail(
      "VALIDATION_ERROR",
      error instanceof z.ZodError
        ? (error.errors[0]?.message ?? "Invalid payload")
        : error instanceof Error
          ? error.message
          : "Invalid payload",
    );
  }
});

app.delete("/api/monitors/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  await c.env.DB.prepare(
    `DELETE FROM monitors WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "monitor.deleted", "monitor", c.req.param("id"));
  await sendCoordinator(c, c.req.param("id"), "/sync");
  return c.json(ok({ deleted: true }));
});

app.post("/api/monitors/:id/pause", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  await c.env.DB.prepare(
    `UPDATE monitors SET active = 0, last_state = 'paused', check_lease_token=NULL, check_lease_until=NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "monitor.paused", "monitor", c.req.param("id"));
  await sendCoordinator(c, c.req.param("id"), "/sync");
  return c.json(ok({ paused: true }));
});

app.post("/api/monitors/:id/resume", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  if (asBool(monitor.active)) return c.json(ok({ resumed: true }));
  const global = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM monitors WHERE active = 1`,
  ).first<{ count: number }>();
  if ((global?.count ?? 0) >= MAX_GLOBAL_ACTIVE_MONITORS)
    return fail("CAPACITY_REACHED", "Beta capacity reached", 503);
  const entitlements = entitlementsFrom(
    await c.env.DB.prepare(
      `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
    )
      .bind(c.get("auth").workspaceId)
      .first<DbRow>(),
  );
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM monitors WHERE workspace_id = ? AND active = 1`,
  )
    .bind(c.get("auth").workspaceId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= entitlements.maxActiveMonitors)
    return fail("QUOTA_EXCEEDED", "Active monitor quota reached", 429);
  await c.env.DB.prepare(
    `UPDATE monitors SET active = 1, last_state='unknown',consecutive_failures=0,last_checked_at=NULL,heartbeat_deadline_at=CASE WHEN monitor_type='heartbeat' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now','+' || (heartbeat_expected_s+COALESCE(heartbeat_grace_s,0)) || ' seconds') ELSE NULL END,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "monitor.resumed", "monitor", c.req.param("id"));
  await sendCoordinator(c, c.req.param("id"), "/sync");
  return c.json(ok({ resumed: true }));
});

app.post("/api/monitors/:id/test", async (c) => {
  if (!hasScope(c, "monitors:write"))
    return fail("FORBIDDEN", "API key lacks monitors:write scope", 403);
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  if (!(await rateLimit(c, "manual-check", 10)))
    return fail("RATE_LIMITED", "Manual checks are temporarily limited", 429);
  if (monitor.monitor_type === "heartbeat")
    return fail(
      "VALIDATION_ERROR",
      "Send a ping to your heartbeat URL to test this monitor",
    );
  const ran = await runHttpMonitor(
    c.env,
    c.req.param("id"),
    c.get("auth").workspaceId,
    true,
  );
  await flushOutbox(c.env);
  return c.json(ok({ completed: ran }));
});

app.post("/api/monitors/:id/rotate-secret", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor || monitor.monitor_type !== "heartbeat")
    return fail("NOT_FOUND", "Heartbeat monitor not found", 404);
  const secret = `hb_${randomToken(24)}`;
  await c.env.DB.prepare(
    `UPDATE monitors SET heartbeat_secret_hash=?,heartbeat_secret_prefix=?,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`,
  )
    .bind(
      await sha256Hex(secret),
      secret.slice(0, 11),
      monitor.id,
      c.get("auth").workspaceId,
    )
    .run();
  await audit(c, "heartbeat.secret_rotated", "monitor", String(monitor.id));
  return c.json(
    ok({
      heartbeatUrl: `${new URL(c.req.url).origin}/api/heartbeat/${secret}`,
    }),
    200,
    { "cache-control": "no-store" },
  );
});

app.get("/api/monitors/:id/checks", async (c) => {
  if (!hasScope(c, "monitors:read"))
    return fail("FORBIDDEN", "API key lacks monitors:read scope", 403);
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  const page = paginationSchema.parse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const rows = await c.env.DB.prepare(
    `SELECT * FROM checks WHERE workspace_id = ? AND monitor_id = ? AND checked_at>=strftime('%Y-%m-%dT%H:%M:%SZ','now','-' || COALESCE((SELECT raw_retention_days FROM workspace_entitlements WHERE workspace_id=?),7) || ' days') ORDER BY checked_at DESC, id DESC LIMIT ? OFFSET ?`,
  )
    .bind(
      c.get("auth").workspaceId,
      c.req.param("id"),
      c.get("auth").workspaceId,
      page.limit,
      page.offset,
    )
    .all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/monitors/:id/stats", async (c) => {
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  const retention = await c.env.DB.prepare(
    "SELECT raw_retention_days FROM workspace_entitlements WHERE workspace_id=?",
  )
    .bind(c.get("auth").workspaceId)
    .first<{ raw_retention_days: number }>();
  const requested = Number(c.req.query("days") ?? 1);
  const days = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 1, 1),
    retention?.raw_retention_days ?? 7,
  );
  const raw = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count,COALESCE(SUM(ok),0) AS success,COALESCE(AVG(latency_ms),0) AS latency FROM checks WHERE workspace_id = ? AND monitor_id = ? AND checked_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)`,
  )
    .bind(c.get("auth").workspaceId, c.req.param("id"), `-${days} days`)
    .first<{ count: number; success: number; latency: number }>();
  return c.json(
    ok({
      days,
      checks: raw?.count ?? 0,
      uptime: raw?.count
        ? Math.round((raw.success / raw.count) * 10000) / 100
        : null,
      avgLatencyMs: Math.round(raw?.latency ?? 0),
    }),
  );
});

app.get("/api/monitors/:id/incidents", async (c) => {
  const monitor = await getMonitor(c, c.req.param("id"));
  if (!monitor) return fail("NOT_FOUND", "Monitor not found", 404);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM incidents WHERE workspace_id = ? AND monitor_id = ? ORDER BY started_at DESC LIMIT 100`,
  )
    .bind(c.get("auth").workspaceId, c.req.param("id"))
    .all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/incidents", async (c) => {
  if (!hasScope(c, "incidents:read"))
    return fail("FORBIDDEN", "API key lacks incidents:read scope", 403);
  const rows = await c.env.DB.prepare(
    `SELECT i.*, m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id = i.monitor_id WHERE i.workspace_id = ? ORDER BY i.started_at DESC LIMIT 100`,
  )
    .bind(c.get("auth").workspaceId)
    .all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/incidents/:id", async (c) => {
  if (!hasScope(c, "incidents:read"))
    return fail("FORBIDDEN", "API key lacks incidents:read scope", 403);
  const incident = await c.env.DB.prepare(
    `SELECT i.*, m.name AS monitor_name, m.url FROM incidents i JOIN monitors m ON m.id = i.monitor_id WHERE i.id = ? AND i.workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first<DbRow>();
  if (!incident) return fail("NOT_FOUND", "Incident not found", 404);
  const [checks, updates, alerts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM checks WHERE workspace_id = ? AND monitor_id = ? ORDER BY checked_at DESC LIMIT 50`,
    )
      .bind(c.get("auth").workspaceId, incident.monitor_id)
      .all(),
    c.env.DB.prepare(
      `SELECT * FROM incident_updates WHERE workspace_id = ? AND incident_id = ? ORDER BY created_at ASC`,
    )
      .bind(c.get("auth").workspaceId, c.req.param("id"))
      .all(),
    c.env.DB.prepare(
      `SELECT * FROM alert_log WHERE workspace_id = ? AND incident_id = ? ORDER BY created_at DESC`,
    )
      .bind(c.get("auth").workspaceId, c.req.param("id"))
      .all(),
  ]);
  return c.json(
    ok({
      incident,
      checks: checks.results ?? [],
      updates: updates.results ?? [],
      alerts: alerts.results ?? [],
    }),
  );
});

async function updateIncident(
  c: AppContext,
  status: string,
  message: string,
  isPublic: boolean,
) {
  const incidentId = c.req.param("id");
  if (!incidentId) return fail("NOT_FOUND", "Incident not found", 404);
  const incident = await c.env.DB.prepare(
    `SELECT id, monitor_id, status FROM incidents WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first<DbRow>();
  if (!incident) return fail("NOT_FOUND", "Incident not found", 404);
  if (incident.status === "resolved" && status !== "resolved")
    return fail(
      "CONFLICT",
      "Resolved incidents cannot be reopened. A new failure opens a new incident.",
      409,
    );
  const now = new Date().toISOString();
  const workspaceId = c.get("auth").workspaceId;
  const statements = [
    c.env.DB.prepare(
      `UPDATE incidents SET status=?,resolved_at=CASE WHEN ?='resolved' THEN COALESCE(resolved_at,?) ELSE resolved_at END,updated_at=? WHERE id=? AND workspace_id=? AND (status<>'resolved' OR ?='resolved')`,
    ).bind(status, status, now, now, incidentId, workspaceId, status),
    c.env.DB.prepare(
      `INSERT INTO incident_updates(workspace_id,incident_id,actor_type,actor_id,status,message,public) SELECT workspace_id,id,'user',?,status,?,? FROM incidents WHERE id=? AND workspace_id=?`,
    ).bind(
      c.get("auth").userId,
      message,
      isPublic ? 1 : 0,
      incidentId,
      workspaceId,
    ),
  ];
  if (status === "resolved")
    statements.push(
      incidentOutbox(
        c.env.DB,
        String(incident.monitor_id),
        workspaceId,
        "resolved",
        now,
      ),
    );
  await c.env.DB.batch(statements);
  await audit(c, `incident.${status}`, "incident", incidentId, {
    public: isPublic,
  });
  if (status === "resolved" && incident.status !== "resolved") {
    await flushOutbox(c.env);
  }
  return c.json(ok({ updated: true, status }));
}

app.post("/api/incidents/:id/acknowledge", async (c) =>
  updateIncident(
    c,
    "acknowledged",
    "Incident acknowledged by a workspace member.",
    false,
  ),
);
app.post("/api/incidents/:id/update", async (c) => {
  const input = incidentUpdateSchema.parse(await parseJson(c));
  return updateIncident(
    c,
    input.status ?? "investigating",
    input.message,
    input.public,
  );
});
app.post("/api/incidents/:id/resolve", async (c) =>
  updateIncident(c, "resolved", "Incident manually marked as resolved.", false),
);

app.get("/api/maintenance", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT mw.*, GROUP_CONCAT(mwm.monitor_id) AS monitor_ids FROM maintenance_windows mw LEFT JOIN maintenance_window_monitors mwm ON mwm.maintenance_window_id = mw.id WHERE mw.workspace_id = ? GROUP BY mw.id ORDER BY mw.starts_at DESC LIMIT 100`,
  )
    .bind(c.get("auth").workspaceId)
    .all<DbRow>();
  return c.json(
    ok(
      (rows.results ?? []).map((row) => ({
        ...row,
        monitor_ids: row.monitor_ids ? String(row.monitor_ids).split(",") : [],
      })),
    ),
  );
});

app.post("/api/maintenance", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = maintenanceSchema.parse(await parseJson(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO maintenance_windows (id, workspace_id, title, description, starts_at, ends_at, public, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      c.get("auth").workspaceId,
      input.title,
      input.description ?? null,
      input.startsAt,
      input.endsAt,
      input.public ? 1 : 0,
      c.get("auth").userId,
    )
    .run();
  for (const monitorId of input.monitorIds)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO maintenance_window_monitors (workspace_id, maintenance_window_id, monitor_id) SELECT ?, ?, id FROM monitors WHERE id = ? AND workspace_id = ?`,
    )
      .bind(c.get("auth").workspaceId, id, monitorId, c.get("auth").workspaceId)
      .run();
  await audit(c, "maintenance.created", "maintenance", id, {
    monitorIds: input.monitorIds,
  });
  return c.json(ok({ id }), 201);
});

app.patch("/api/maintenance/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = maintenanceSchema
    .innerType()
    .partial()
    .parse(await parseJson(c));
  const current = await c.env.DB.prepare(
    `SELECT * FROM maintenance_windows WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first<DbRow>();
  if (!current) return fail("NOT_FOUND", "Maintenance window not found", 404);
  const merged = maintenanceSchema.parse({
    title: input.title ?? String(current.title),
    description: input.description ?? String(current.description ?? ""),
    startsAt: input.startsAt ?? String(current.starts_at),
    endsAt: input.endsAt ?? String(current.ends_at),
    public: input.public ?? asBool(current.public),
  });
  await c.env.DB.prepare(
    `UPDATE maintenance_windows SET title=?, description=?, starts_at=?, ends_at=?, public=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`,
  )
    .bind(
      merged.title,
      merged.description,
      merged.startsAt,
      merged.endsAt,
      merged.public ? 1 : 0,
      c.req.param("id"),
      c.get("auth").workspaceId,
    )
    .run();
  if (input.monitorIds) {
    await c.env.DB.prepare(
      `DELETE FROM maintenance_window_monitors WHERE maintenance_window_id = ? AND workspace_id = ?`,
    )
      .bind(c.req.param("id"), c.get("auth").workspaceId)
      .run();
    for (const monitorId of input.monitorIds)
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO maintenance_window_monitors (workspace_id, maintenance_window_id, monitor_id) SELECT ?, ?, id FROM monitors WHERE id = ? AND workspace_id = ?`,
      )
        .bind(
          c.get("auth").workspaceId,
          c.req.param("id"),
          monitorId,
          c.get("auth").workspaceId,
        )
        .run();
  }
  await audit(c, "maintenance.updated", "maintenance", c.req.param("id"));
  return c.json(ok({ updated: true }));
});

app.delete("/api/maintenance/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  await c.env.DB.prepare(
    `DELETE FROM maintenance_windows WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "maintenance.deleted", "maintenance", c.req.param("id"));
  return c.json(ok({ deleted: true }));
});

app.get("/api/integrations", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, workspace_id, kind, name, enabled, substr(COALESCE(config_ciphertext, ''), 1, 4) AS secret_preview, created_at, updated_at FROM integrations WHERE workspace_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.get("auth").workspaceId)
    .all<DbRow>();
  return c.json(ok((rows.results ?? []).map(mapIntegration)));
});

app.post("/api/integrations", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = integrationSchema.parse(await parseJson(c));
  const configError = validateIntegration(input.kind, input.config);
  if (configError) return fail("VALIDATION_ERROR", configError);
  const workspaceId = c.get("auth").workspaceId;
  const entitlement = entitlementsFrom(
    await c.env.DB.prepare(
      `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<DbRow>(),
  );
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM integrations WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= entitlement.maxIntegrations)
    return fail("QUOTA_EXCEEDED", "Integration quota reached", 429);
  const encrypted = await createEncrypted(input.config, c.env);
  if (!encrypted && input.kind !== "browser_push")
    return fail(
      "CONFIGURATION_ERROR",
      "SECRET_ENCRYPTION_KEY is required for notification integrations",
      503,
    );
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO integrations (id, workspace_id, kind, name, config_ciphertext, config_iv, config_version, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      input.kind,
      input.name,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.version ?? null,
      input.enabled ? 1 : 0,
    )
    .run();
  await c.env.DB.prepare(
    `INSERT INTO notification_rules (workspace_id, integration_id, event_types, monitor_ids, minimum_severity) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      workspaceId,
      id,
      JSON.stringify(input.eventTypes),
      JSON.stringify(input.monitorIds),
      input.minimumSeverity,
    )
    .run();
  await audit(c, "integration.created", "integration", id, {
    kind: input.kind,
  });
  return c.json(
    ok({
      id,
      kind: input.kind,
      name: input.name,
      secretPreview: redactSecret(Object.values(input.config)[0]),
    }),
    201,
  );
});

app.patch("/api/integrations/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = integrationSchema.partial().parse(await parseJson(c));
  const current = await c.env.DB.prepare(
    `SELECT * FROM integrations WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first<DbRow>();
  if (!current) return fail("NOT_FOUND", "Integration not found", 404);
  if (input.kind && input.kind !== current.kind)
    return fail(
      "VALIDATION_ERROR",
      "Create a new integration to change its provider",
    );
  if (input.config) {
    const configError = validateIntegration(String(current.kind), input.config);
    if (configError) return fail("VALIDATION_ERROR", configError);
  }
  await c.env.DB.prepare(
    `UPDATE integrations SET name=?, enabled=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`,
  )
    .bind(
      input.name ?? current.name,
      input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      c.req.param("id"),
      c.get("auth").workspaceId,
    )
    .run();
  if (input.config) {
    const encrypted = await createEncrypted(input.config, c.env);
    await c.env.DB.prepare(
      `UPDATE integrations SET config_ciphertext=?, config_iv=?, config_version=? WHERE id=? AND workspace_id=?`,
    )
      .bind(
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.version ?? null,
        c.req.param("id"),
        c.get("auth").workspaceId,
      )
      .run();
  }
  if (
    input.eventTypes ||
    input.monitorIds ||
    input.minimumSeverity !== undefined
  ) {
    const rule = await c.env.DB.prepare(
      "SELECT event_types,monitor_ids,minimum_severity FROM notification_rules WHERE integration_id=? AND workspace_id=?",
    )
      .bind(c.req.param("id"), c.get("auth").workspaceId)
      .first<DbRow>();
    await c.env.DB.prepare(
      "UPDATE notification_rules SET event_types=?,monitor_ids=?,minimum_severity=? WHERE integration_id=? AND workspace_id=?",
    )
      .bind(
        input.eventTypes
          ? JSON.stringify(input.eventTypes)
          : (rule?.event_types ?? '["incident.opened","incident.resolved"]'),
        input.monitorIds
          ? JSON.stringify(input.monitorIds)
          : (rule?.monitor_ids ?? "[]"),
        input.minimumSeverity ?? rule?.minimum_severity ?? 1,
        c.req.param("id"),
        c.get("auth").workspaceId,
      )
      .run();
  }
  await audit(c, "integration.updated", "integration", c.req.param("id"));
  return c.json(ok({ updated: true }));
});

app.delete("/api/integrations/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  await c.env.DB.prepare(
    `DELETE FROM integrations WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "integration.deleted", "integration", c.req.param("id"));
  return c.json(ok({ deleted: true }));
});

app.post("/api/integrations/:id/test", async (c) => {
  const integration = await c.env.DB.prepare(
    `SELECT id FROM integrations WHERE id = ? AND workspace_id = ? AND enabled = 1`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first();
  if (!integration) return fail("NOT_FOUND", "Integration not found", 404);
  if (!c.env.ALERT_QUEUE)
    return fail(
      "QUEUE_UNAVAILABLE",
      "Notification queue is not configured",
      503,
    );
  await c.env.ALERT_QUEUE.send({
    eventId: crypto.randomUUID(),
    workspaceId: c.get("auth").workspaceId,
    type: "notification.route",
    eventType: "incident.opened",
    monitorId: "test",
    integrationId: c.req.param("id"),
    test: true,
    severity: 5,
    summary: "Pulseflare integration test",
    createdAt: new Date().toISOString(),
  });
  return c.json(ok({ queued: true }));
});

function validateIntegration(
  kind: string,
  config: Record<string, string>,
): string | null {
  if (kind === "browser_push") return "Browser push is coming soon";
  if (kind === "telegram")
    return /^[0-9]+:[A-Za-z0-9_-]+$/.test(config.botToken ?? "") &&
      /^-?[0-9]+$/.test(config.chatId ?? "")
      ? null
      : "Provide a Telegram bot token and numeric chat ID";
  if (
    !config.webhookUrl ||
    !config.webhookUrl.startsWith("https://") ||
    !isValidMonitorUrl(config.webhookUrl)
  )
    return "Provide a public HTTPS webhook URL";
  const url = new URL(config.webhookUrl);
  if (
    kind === "slack" &&
    (url.hostname !== "hooks.slack.com" ||
      !url.pathname.startsWith("/services/"))
  )
    return "Provide a Slack incoming webhook URL";
  if (
    kind === "discord" &&
    (!["discord.com", "discordapp.com"].includes(url.hostname) ||
      !url.pathname.startsWith("/api/webhooks/"))
  )
    return "Provide a Discord webhook URL";
  return null;
}

app.get("/api/integrations/:id/deliveries", async (c) => {
  const integration = await c.env.DB.prepare(
    "SELECT id FROM integrations WHERE id=? AND workspace_id=?",
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first();
  if (!integration) return fail("NOT_FOUND", "Integration not found", 404);
  const deliveries = await c.env.DB.prepare(
    "SELECT event_id,channel,status,response_code,error_message,attempts,attempted_at,created_at FROM notification_deliveries WHERE integration_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .all();
  return c.json(ok(deliveries.results ?? []));
});

app.put("/api/status-pages/:id/monitors", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = z
    .object({ monitorIds: z.array(z.string().max(64)).max(5) })
    .parse(await parseJson(c));
  const workspaceId = c.get("auth").workspaceId;
  const page = await c.env.DB.prepare(
    "SELECT id FROM status_pages WHERE id=? AND workspace_id=?",
  )
    .bind(c.req.param("id"), workspaceId)
    .first();
  if (!page) return fail("NOT_FOUND", "Status page not found", 404);
  const monitors = await c.env.DB.prepare(
    "SELECT id FROM monitors WHERE workspace_id=? AND public=1",
  )
    .bind(workspaceId)
    .all<{ id: string }>();
  if (
    input.monitorIds.some((id) => !monitors.results?.some((m) => m.id === id))
  )
    return fail(
      "VALIDATION_ERROR",
      "Select public monitors from this workspace",
    );
  const componentId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM status_components WHERE status_page_id=? AND workspace_id=?",
    ).bind(c.req.param("id"), workspaceId),
    c.env.DB.prepare(
      "INSERT INTO status_components(id,workspace_id,status_page_id,name) VALUES(?,?,?,?)",
    ).bind(componentId, workspaceId, c.req.param("id"), "Services"),
    ...[...new Set(input.monitorIds)].map((id) =>
      c.env.DB.prepare(
        "INSERT INTO status_component_monitors(workspace_id,component_id,monitor_id) VALUES(?,?,?)",
      ).bind(workspaceId, componentId, id),
    ),
  ]);
  await audit(
    c,
    "status_page.monitors_updated",
    "status_page",
    c.req.param("id"),
  );
  return c.json(ok({ updated: true }));
});

app.get("/api/status-pages", async (c) => {
  // Return the saved selection so the editor and public page share one source.
  const rows = await c.env.DB.prepare(
    `SELECT p.*,COALESCE((SELECT json_group_array(DISTINCT scm.monitor_id) FROM status_components sc JOIN status_component_monitors scm ON scm.component_id=sc.id AND scm.workspace_id=sc.workspace_id WHERE sc.status_page_id=p.id AND sc.workspace_id=p.workspace_id),'[]') AS monitor_ids FROM status_pages p WHERE p.workspace_id=? ORDER BY p.created_at ASC`,
  )
    .bind(c.get("auth").workspaceId)
    .all<DbRow>();
  return c.json(
    ok(
      (rows.results ?? []).map((r) => ({
        ...r,
        monitorIds: asArray(r.monitor_ids),
      })),
    ),
  );
});

app.post("/api/status-pages", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = statusPageSchema.parse(await parseJson(c));
  const workspaceId = c.get("auth").workspaceId;
  const entitlement = entitlementsFrom(
    await c.env.DB.prepare(
      `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<DbRow>(),
  );
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM status_pages WHERE workspace_id = ?`,
  )
    .bind(workspaceId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= entitlement.maxStatusPages)
    return fail("QUOTA_EXCEEDED", "Status page quota reached", 429);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO status_pages (id, workspace_id, slug, title, description, brand_color, logo_url, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      input.slug,
      input.title,
      input.description,
      input.brandColor,
      input.logoUrl ?? null,
      input.published ? 1 : 0,
    )
    .run();
  await audit(c, "status_page.created", "status_page", id);
  return c.json(ok({ id, ...input }), 201);
});

app.patch("/api/status-pages/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = statusPageSchema.partial().parse(await parseJson(c));
  const current = await c.env.DB.prepare(
    `SELECT * FROM status_pages WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first<DbRow>();
  if (!current) return fail("NOT_FOUND", "Status page not found", 404);
  await c.env.DB.prepare(
    `UPDATE status_pages SET slug=?, title=?, description=?, brand_color=?, logo_url=?, published=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=? AND workspace_id=?`,
  )
    .bind(
      input.slug ?? current.slug,
      input.title ?? current.title,
      input.description ?? current.description,
      input.brandColor ?? current.brand_color,
      input.logoUrl ?? current.logo_url,
      input.published === undefined
        ? current.published
        : input.published
          ? 1
          : 0,
      c.req.param("id"),
      c.get("auth").workspaceId,
    )
    .run();
  await audit(c, "status_page.updated", "status_page", c.req.param("id"));
  return c.json(ok({ updated: true }));
});

app.post("/api/status-pages/:id/components", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = z
    .object({
      name: z.string().trim().min(1).max(100),
      description: z.string().max(300).optional(),
      monitorIds: z.array(z.string()).max(100).default([]),
      position: z.number().int().min(0).default(0),
    })
    .parse(await parseJson(c));
  const page = await c.env.DB.prepare(
    `SELECT id FROM status_pages WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .first();
  if (!page) return fail("NOT_FOUND", "Status page not found", 404);
  const componentId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO status_components (id, workspace_id, status_page_id, name, description, position) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      componentId,
      c.get("auth").workspaceId,
      c.req.param("id"),
      input.name,
      input.description ?? null,
      input.position,
    )
    .run();
  for (const monitorId of input.monitorIds)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO status_component_monitors (workspace_id, component_id, monitor_id) SELECT ?, ?, id FROM monitors WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        c.get("auth").workspaceId,
        componentId,
        monitorId,
        c.get("auth").workspaceId,
      )
      .run();
  return c.json(ok({ id: componentId }), 201);
});

app.get("/api/api-keys", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, prefix, scopes, created_at, expires_at, last_used_at, revoked_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.get("auth").workspaceId)
    .all<DbRow>();
  return c.json(
    ok(
      (rows.results ?? []).map((row) => ({
        ...row,
        scopes: asArray(row.scopes),
      })),
    ),
  );
});

app.post("/api/api-keys", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  const input = apiKeySchema.parse(await parseJson(c));
  const workspaceId = c.get("auth").workspaceId;
  const entitlement = entitlementsFrom(
    await c.env.DB.prepare(
      `SELECT * FROM workspace_entitlements WHERE workspace_id = ?`,
    )
      .bind(workspaceId)
      .first<DbRow>(),
  );
  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL`,
  )
    .bind(workspaceId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= entitlement.maxApiKeys)
    return fail("QUOTA_EXCEEDED", "API key quota reached", 429);
  const secret = `pf_live_${randomToken(32)}`;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO api_keys (id, workspace_id, name, prefix, sha256_hash, scopes, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      input.name,
      secret.slice(0, 16),
      await sha256Hex(secret),
      JSON.stringify(input.scopes),
      c.get("auth").userId,
      input.expiresAt ?? null,
    )
    .run();
  await audit(c, "api_key.created", "api_key", id, { scopes: input.scopes });
  return c.json(
    ok({
      id,
      name: input.name,
      key: secret,
      scopes: input.scopes,
      warning: "This key is shown once. Store it securely.",
    }),
    201,
    { "cache-control": "no-store" },
  );
});

app.delete("/api/api-keys/:id", async (c) => {
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  await c.env.DB.prepare(
    `UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND workspace_id = ?`,
  )
    .bind(c.req.param("id"), c.get("auth").workspaceId)
    .run();
  await audit(c, "api_key.revoked", "api_key", c.req.param("id"));
  return c.json(ok({ revoked: true }));
});

app.get("/api/audit", async (c) => {
  const page = paginationSchema.parse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const rows = await c.env.DB.prepare(
    `SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(c.get("auth").workspaceId, page.limit, page.offset)
    .all();
  return c.json(ok(rows.results ?? []));
});

app.get("/api/stats", async (c) => {
  const workspaceId = c.get("auth").workspaceId;
  const [monitors, incidents, checks] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM monitors WHERE workspace_id = ? AND active = 1`,
    )
      .bind(workspaceId)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM incidents WHERE workspace_id = ? AND status <> 'resolved'`,
    )
      .bind(workspaceId)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT ${recentMetricsSql} AS metrics FROM monitors m WHERE m.workspace_id=?`,
    )
      .bind(workspaceId)
      .all<DbRow>(),
  ]);
  const metrics = (checks.results ?? []).map(recentMetrics);
  const total = metrics.reduce((n, m) => n + m.count, 0);
  const successes = metrics.reduce((n, m) => n + m.success, 0);
  return c.json(
    ok({
      activeMonitors: monitors?.count ?? 0,
      openIncidents: incidents?.count ?? 0,
      uptime24h: total ? Math.round((successes / total) * 10000) / 100 : null,
      avgLatency24h: total
        ? Math.round(
            metrics.reduce((n, m) => n + m.latency * m.count, 0) / total,
          )
        : 0,
    }),
  );
});

app.get("/api/internal/ops", async (c) => {
  const token = c.req.header("x-internal-token") ?? "";
  if (!c.env.INTERNAL_ADMIN_TOKEN || token !== c.env.INTERNAL_ADMIN_TOKEN)
    return fail("UNAUTHORIZED", "Operator access required", 401);
  const [users, workspaces, monitors, checks, incidents, failed, stale] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT owner_clerk_user_id) AS count FROM workspaces`,
      ).first<{ count: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM workspaces`).first<{
        count: number;
      }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM monitors WHERE active = 1`,
      ).first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM((SELECT COUNT(*) FROM checks c WHERE c.workspace_id=m.workspace_id AND c.monitor_id=m.id AND c.checked_at>=strftime('%Y-%m-%dT00:00:00Z','now'))),0) AS count FROM monitors m`,
      ).first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM incidents WHERE started_at >= datetime('now','start of day')`,
      ).first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM notification_deliveries WHERE status = 'failed' AND created_at >= datetime('now','start of day')`,
      ).first<{ count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM monitors WHERE active = 1 AND (last_checked_at IS NULL OR last_checked_at < datetime('now','-20 minutes'))`,
      ).first<{ count: number }>(),
    ]);
  return c.json(
    ok({
      users: users?.count ?? 0,
      workspaces: workspaces?.count ?? 0,
      activeMonitors: monitors?.count ?? 0,
      checksToday: checks?.count ?? 0,
      incidentsToday: incidents?.count ?? 0,
      failedNotifications: failed?.count ?? 0,
      staleMonitors: stale?.count ?? 0,
      globalCapacity: MAX_GLOBAL_ACTIVE_MONITORS,
    }),
  );
});

app.get("/api/settings", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM status_pages WHERE workspace_id = ? ORDER BY created_at LIMIT 1`,
  )
    .bind(c.get("auth").workspaceId)
    .first();
  return c.json(ok({ publicStatus: row }));
});

app.notFound(() => fail("NOT_FOUND", "Route not found", 404));
app.onError((error, c) => {
  if (isDatabaseLimit(error)) {
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    return Response.json(
      {
        ok: false,
        error: {
          code: "DAILY_BUDGET_REACHED",
          message:
            "Monitoring is temporarily paused to protect the free daily database allowance. Please retry after midnight UTC.",
        },
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(
            Math.max(1, Math.ceil((midnight.getTime() - Date.now()) / 1000)),
          ),
        },
      },
    );
  }
  if (error.message.includes("QUOTA_EXCEEDED"))
    return fail("QUOTA_EXCEEDED", "Workspace quota reached", 429);
  if (error.message.includes("CAPACITY_REACHED"))
    return fail("CAPACITY_REACHED", "Beta capacity reached", 503);
  if (error.message.includes("UNIQUE constraint failed: status_pages.slug"))
    return fail(
      "CONFLICT",
      "This public URL is already in use. Choose another slug.",
      409,
    );
  if (error instanceof z.ZodError)
    return fail(
      "VALIDATION_ERROR",
      error.errors[0]?.message ?? "Invalid input",
      400,
    );
  if (error instanceof SyntaxError)
    return fail("VALIDATION_ERROR", "Request body must be valid JSON", 400);
  console.log(
    JSON.stringify({
      level: "error",
      event: "api.error",
      request_id: requestId(c),
      message: error.message,
    }),
  );
  return fail("INTERNAL_ERROR", "Unexpected server error", 500);
});

export default app;
