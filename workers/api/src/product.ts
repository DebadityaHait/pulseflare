import { z } from "zod";
import type { Context, Hono } from "hono";
import type { Env, AuthContext } from "./index";
import { isValidMonitorUrl } from "@pulseflare/shared";
type App = Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>;
type Ctx = Context<{ Bindings: Env; Variables: { auth: AuthContext } }>;
type Row = Record<string, unknown>;
const environment = z.enum([
  "production",
  "staging",
  "development",
  "unassigned",
]);
const deploymentSchema = z
  .object({
    version: z.string().trim().min(1).max(120),
    environment: environment.default("unassigned"),
    source: z.enum(["manual", "github", "other"]).default("manual"),
    monitorIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(10)
      .transform((v) => [...new Set(v)].sort()),
    url: z
      .string()
      .max(1000)
      .url()
      .refine((v) => v.startsWith("https://") && isValidMonitorUrl(v))
      .optional(),
  })
  .strict();
const reportSchema = z
  .object({
    revision: z.number().int().min(0),
    impact: z.string().trim().max(4000),
    rootCause: z.string().trim().max(4000),
    resolution: z.string().trim().max(4000),
    preventiveActions: z.string().trim().max(4000),
  })
  .strict();
const failure = (code: string, message: string, status: number) =>
  Response.json(
    { ok: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
function audit(c: Ctx, action: string, type: string, id: string) {
  const auth = c.get("auth");
  return c.env.DB.prepare(
    "INSERT INTO audit_events(workspace_id,actor_clerk_user_id,action,resource_type,resource_id,metadata_json) VALUES(?,?,?,?,?,'{}')",
  ).bind(auth.workspaceId, auth.userId, action, type, id);
}
function deployment(row: Row) {
  return {
    id: row.id,
    version: row.version,
    environment: row.environment,
    source: row.source,
    url: row.url,
    createdAt: row.created_at,
    monitorIds: String(row.monitor_ids || "")
      .split(",")
      .filter(Boolean),
  };
}
export function registerProductTools(app: App) {
  app.get("/api/deployments", async (c) => {
    c.header("Cache-Control", "no-store");
    const { workspaceId } = c.get("auth");
    const monitorId = z
      .string()
      .max(64)
      .optional()
      .parse(c.req.query("monitorId"));
    const since = z.string().datetime().optional().parse(c.req.query("since"));
    const until = z.string().datetime().optional().parse(c.req.query("until"));
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(0)
      .parse(c.req.query("offset"));
    const rows = await c.env.DB.prepare(
      `SELECT d.*, (SELECT GROUP_CONCAT(monitor_id) FROM deployment_monitors WHERE workspace_id=d.workspace_id AND deployment_id=d.id) AS monitor_ids FROM deployments d WHERE d.workspace_id=? AND d.created_at>=? AND d.created_at<=? ${monitorId ? "AND EXISTS(SELECT 1 FROM deployment_monitors dm WHERE dm.workspace_id=d.workspace_id AND dm.deployment_id=d.id AND dm.monitor_id=?)" : ""} ORDER BY d.created_at DESC,d.id DESC LIMIT 21 OFFSET ?`,
    )
      .bind(
        workspaceId,
        since && since > new Date(Date.now() - 30 * 86400000).toISOString()
          ? since
          : new Date(Date.now() - 30 * 86400000).toISOString(),
        until || new Date().toISOString(),
        ...(monitorId ? [monitorId] : []),
        offset,
      )
      .all<Row>();
    return c.json({
      ok: true,
      data: {
        items: (rows.results || []).slice(0, 20).map(deployment),
        hasMore: (rows.results?.length || 0) > 20,
      },
    });
  });
  app.post("/api/deployments", async (c) => {
    c.header("Cache-Control", "no-store");
    const input = deploymentSchema.parse(await c.req.json());
    const key = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9_.:-]+$/)
      .optional()
      .parse(c.req.header("Idempotency-Key"));
    const auth = c.get("auth");
    const canonical = JSON.stringify(input);
    if (key) {
      const old = await c.env.DB.prepare(
        "SELECT d.*, (SELECT GROUP_CONCAT(monitor_id) FROM deployment_monitors WHERE deployment_id=d.id AND workspace_id=d.workspace_id) AS monitor_ids FROM deployments d WHERE workspace_id=? AND idempotency_key=?",
      )
        .bind(auth.workspaceId, key)
        .first<Row>();
      if (old)
        return old.request_json === canonical
          ? c.json({ ok: true, data: deployment(old) })
          : failure(
              "CONFLICT",
              "This idempotency key belongs to another deployment",
              409,
            );
    }
    const placeholders = input.monitorIds.map(() => "?").join(",");
    const selected = await c.env.DB.prepare(
      `SELECT id FROM monitors WHERE workspace_id=? AND id IN (${placeholders})`,
    )
      .bind(auth.workspaceId, ...input.monitorIds)
      .all();
    if (selected.results?.length !== input.monitorIds.length)
      return failure(
        "NOT_FOUND",
        "Selected monitors were not found in this workspace",
        404,
      );
    const id = crypto.randomUUID();
    const time = new Date().toISOString();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO deployments(id,workspace_id,version,environment,source,url,idempotency_key,request_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id,
          auth.workspaceId,
          input.version,
          input.environment,
          input.source,
          input.url || null,
          key || null,
          canonical,
          auth.userId,
          time,
        ),
        ...input.monitorIds.map((m) =>
          c.env.DB.prepare(
            "INSERT INTO deployment_monitors(workspace_id,deployment_id,monitor_id) VALUES(?,?,?)",
          ).bind(auth.workspaceId, id, m),
        ),
        audit(c, "deployment.created", "deployment", id),
      ]);
    } catch (error) {
      if (
        key &&
        error instanceof Error &&
        error.message.includes("UNIQUE constraint")
      ) {
        const old = await c.env.DB.prepare(
          "SELECT * FROM deployments WHERE workspace_id=? AND idempotency_key=?",
        )
          .bind(auth.workspaceId, key)
          .first<Row>();
        if (old?.request_json === canonical)
          return c.json({
            ok: true,
            data: { id: old.id, ...input, createdAt: old.created_at },
          });
        return failure(
          "CONFLICT",
          "This idempotency key belongs to another deployment",
          409,
        );
      }
      throw error;
    }
    return c.json({ ok: true, data: { id, ...input, createdAt: time } }, 201);
  });
  app.get("/api/incidents/:id/postmortem", async (c) => {
    c.header("Cache-Control", "no-store");
    const workspace = c.get("auth").workspaceId;
    const incident = await c.env.DB.prepare(
      "SELECT i.id,i.started_at,i.resolved_at,i.type,i.failing_status,i.failing_error_code,m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id=i.monitor_id AND m.workspace_id=i.workspace_id WHERE i.workspace_id=? AND i.id=?",
    )
      .bind(workspace, c.req.param("id"))
      .first<Row>();
    if (!incident) return failure("NOT_FOUND", "Incident not found", 404);
    const row = await c.env.DB.prepare(
      "SELECT * FROM incident_postmortems WHERE workspace_id=? AND incident_id=?",
    )
      .bind(workspace, c.req.param("id"))
      .first<Row>();
    const updates = await c.env.DB.prepare(
      "SELECT status,message,created_at FROM incident_updates WHERE workspace_id=? AND incident_id=? ORDER BY created_at ASC LIMIT 50",
    )
      .bind(workspace, c.req.param("id"))
      .all<Row>();
    return c.json({
      ok: true,
      data: {
        revision: Number(row?.revision || 0),
        impact:
          row?.impact ??
          `Monitoring detected ${incident.type} on ${incident.monitor_name}. Customer impact has not been confirmed.`,
        rootCause: row?.root_cause ?? "Not yet confirmed.",
        resolution:
          row?.resolution ??
          (incident.resolved_at
            ? `Monitoring recorded recovery at ${incident.resolved_at}.`
            : "Recovery has not yet been recorded."),
        preventiveActions: row?.preventive_actions ?? "",
        updatedAt: row?.updated_at ?? null,
        evidence: { incident, updates: updates.results || [] },
      },
    });
  });
  app.put("/api/incidents/:id/postmortem", async (c) => {
    c.header("Cache-Control", "no-store");
    const input = reportSchema.parse(await c.req.json());
    const auth = c.get("auth"),
      id = c.req.param("id");
    const incident = await c.env.DB.prepare(
      "SELECT id FROM incidents WHERE workspace_id=? AND id=?",
    )
      .bind(auth.workspaceId, id)
      .first();
    if (!incident) return failure("NOT_FOUND", "Incident not found", 404);
    // INSERT revision 0 or compare-and-swap an existing report in one statement.
    const result = await c.env.DB.prepare(
      `INSERT INTO incident_postmortems(incident_id,workspace_id,impact,root_cause,resolution,preventive_actions,updated_by,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM incident_postmortems WHERE workspace_id=? AND incident_id=? AND revision=?) ON CONFLICT(incident_id) DO UPDATE SET impact=excluded.impact,root_cause=excluded.root_cause,resolution=excluded.resolution,preventive_actions=excluded.preventive_actions,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=incident_postmortems.revision+1 WHERE incident_postmortems.workspace_id=excluded.workspace_id AND incident_postmortems.revision=?`,
    )
      .bind(
        id,
        auth.workspaceId,
        input.impact,
        input.rootCause,
        input.resolution,
        input.preventiveActions,
        auth.userId,
        new Date().toISOString(),
        input.revision,
        auth.workspaceId,
        id,
        input.revision,
        input.revision,
      )
      .run();
    if (!result.meta.changes)
      return failure(
        "REVISION_CONFLICT",
        "This report changed in another session. Reload before saving.",
        409,
      );
    await audit(c, "postmortem.updated", "incident", id).run();
    return c.json({ ok: true, data: { revision: input.revision + 1 } });
  });
}
export const escapeXml = (value: unknown) =>
  String(value ?? "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
type Snapshot = {
  page: { id: string; slug: string; title: string };
  overallState: string;
};
export function registerPublicFeeds(
  app: App,
  snapshot: (env: Env, slug: string) => Promise<Snapshot | null>,
) {
  app.get("/api/status/:slug/badge.svg", async (c) => {
    const data = await snapshot(c.env, c.req.param("slug"));
    if (!data) return failure("NOT_FOUND", "Status page not found", 404);
    const labels: Record<string, string> = {
      operational: "operational",
      major_outage: "outage",
      degraded: "degraded",
      maintenance: "maintenance",
      unknown: "unknown",
    };
    const label = labels[data.overallState] || "unknown";
    const color =
      data.overallState === "operational"
        ? "#397963"
        : data.overallState === "major_outage"
          ? "#b33d42"
          : "#92621f";
    c.header("Cache-Control", "public, max-age=120");
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(
      `<svg xmlns="http://www.w3.org/2000/svg" width="210" height="24" role="img" aria-label="Pulseflare: ${escapeXml(label)}"><title>${escapeXml(data.page.title)}: ${escapeXml(label)}</title><rect width="90" height="24" fill="#292c30"/><rect x="90" width="120" height="24" fill="${color}"/><g fill="#f8f8f6" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11"><text x="45" y="16">Pulseflare</text><text x="150" y="16">${escapeXml(label)}</text></g></svg>`,
    );
  });
  app.get("/api/status/:slug/rss", async (c) => {
    const data = await snapshot(c.env, c.req.param("slug"));
    if (!data) return failure("NOT_FOUND", "Status page not found", 404);
    const rows = await c.env.DB.prepare(
      `SELECT u.id,u.message,u.created_at,u.incident_id,m.name FROM status_pages p JOIN status_components sc ON sc.status_page_id=p.id AND sc.workspace_id=p.workspace_id JOIN status_component_monitors scm ON scm.component_id=sc.id AND scm.workspace_id=sc.workspace_id JOIN monitors m ON m.id=scm.monitor_id AND m.workspace_id=scm.workspace_id JOIN incidents i ON i.monitor_id=m.id AND i.workspace_id=m.workspace_id JOIN incident_updates u ON u.incident_id=i.id AND u.workspace_id=i.workspace_id WHERE p.id=? AND p.published=1 AND m.public=1 AND u.public=1 GROUP BY u.id ORDER BY u.created_at DESC,u.id DESC LIMIT 20`,
    )
      .bind(data.page.id)
      .all<Row>();
    const link = `${new URL(c.req.url).origin}/status/${data.page.slug}`;
    c.header("Cache-Control", "public, max-age=120");
    c.header("Content-Type", "application/rss+xml; charset=utf-8");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(data.page.title)}</title><link>${escapeXml(link)}</link><description>Public incident updates</description>${(rows.results || []).map((r) => `<item><guid isPermaLink="false">${escapeXml(r.id)}</guid><title>${escapeXml(r.name)}</title><link>${escapeXml(link)}</link><description>${escapeXml(r.message)}</description><pubDate>${new Date(String(r.created_at)).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`,
    );
  });
}
