import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Download, GitCommitHorizontal, Plus, RefreshCw } from "lucide-react";
import { api } from "../api/client";
import { CopyButton, Empty } from "./ui";
export type Deployment = {
  id: string;
  version: string;
  environment: string;
  source: string;
  url: string | null;
  createdAt: string;
  monitorIds: string[];
};
type DeploymentsResponse = { items: Deployment[]; hasMore: boolean };
const sampleDeployment: Deployment = {
  id: "sample-deployment",
  version: "a834fe2",
  environment: "production",
  source: "github",
  url: null,
  createdAt: "2026-09-28T14:29:00Z",
  monitorIds: ["search"],
};
export function useDeployments(
  demo: boolean,
  monitorId?: string,
  since?: string,
  until?: string,
) {
  const [offset, setOffset] = useState(0),
    [version, setVersion] = useState(0);
  const [data, setData] = useState<DeploymentsResponse>({
    items: [],
    hasMore: false,
  });
  const [loading, setLoading] = useState(!demo),
    [error, setError] = useState("");
  const query = new URLSearchParams({
    offset: String(offset),
    ...(monitorId ? { monitorId } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  }).toString();
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<DeploymentsResponse>(`/api/deployments?${query}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, query, version]);
  return {
    data: demo ? { items: [sampleDeployment], hasMore: false } : data,
    loading,
    error,
    offset,
    setOffset,
    reload: () => setVersion((v) => v + 1),
  };
}
export function DeploymentRows({ items }: { items: Deployment[] }) {
  return (
    <div className="deployment-list">
      {items.map((d) => (
        <div className="deployment-row" key={d.id}>
          <GitCommitHorizontal size={18} />
          <div>
            <strong>{d.version}</strong>
            <small>
              {d.environment} · {d.source}
            </small>
            <time>{new Date(d.createdAt).toLocaleString()}</time>
          </div>
          {d.url && (
            <a
              className="text-link"
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View change
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
export function Deployments({ demo }: { demo: boolean }) {
  const result = useDeployments(demo);
  const [monitors, setMonitors] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    api<Array<{ id: string; name: string }>>("/api/monitors", {
      signal: c.signal,
    })
      .then(setMonitors)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [demo]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const monitorIds = form.getAll("monitors").map(String).sort();
    if (!monitorIds.length) {
      setError("Select at least one affected monitor.");
      setBusy(false);
      return;
    }
    const body = JSON.stringify({
      version: form.get("version"),
      environment: form.get("environment"),
      source: "manual",
      monitorIds,
      ...(form.get("url") ? { url: form.get("url") } : {}),
    });
    if (submission.current?.body !== body)
      submission.current = { body, key: crypto.randomUUID() };
    try {
      await api("/api/deployments", {
        method: "POST",
        headers: { "Idempotency-Key": submission.current.key },
        body,
      });
      submission.current = null;
      setCreating(false);
      result.setOffset(0);
      result.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="workspace-heading">
        <div>
          <h1>Deployments</h1>
          <p>
            Changes alongside monitoring evidence, without assuming causation.
          </p>
        </div>
        {!demo && (
          <button
            className="button primary small"
            onClick={() => setCreating(!creating)}
          >
            <Plus size={15} /> Record deployment
          </button>
        )}
      </div>
      {demo && (
        <p className="form-hint">
          Sample deployment history. This workspace is read-only.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {creating && (
        <form className="data-panel monitor-form" onSubmit={create}>
          <h2>Record a change</h2>
          <fieldset disabled={busy} className="plain-fieldset">
            <label>
              Version or commit
              <input
                name="version"
                maxLength={120}
                required
                placeholder="a834fe2"
              />
            </label>
            <label>
              Environment
              <select
                name="environment"
                aria-label="Environment"
                defaultValue="production"
              >
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </label>
            <label>
              Reference URL (optional)
              <input
                name="url"
                type="url"
                maxLength={1000}
                placeholder="https://github.com/your-org/your-repo/commit/..."
              />
            </label>
            <fieldset className="deployment-monitors">
              <legend>Affected monitors</legend>
              {monitors.map((m) => (
                <label key={m.id}>
                  <input type="checkbox" name="monitors" value={m.id} />
                  {m.name}
                </label>
              ))}
            </fieldset>
            <p className="form-hint">
              Select at least one monitor. Recording a deployment does not
              trigger checks or alerts.
            </p>
            <div className="button-row">
              <button className="button primary" disabled={!monitors.length}>
                {busy ? "Recording..." : "Save deployment"}
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <section className="data-panel">
        <div className="panel-heading">
          <h2>Recent deployments</h2>
          <button
            aria-label="Refresh deployments"
            className="button ghost small"
            onClick={result.reload}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {result.loading ? (
          <p className="product-state" role="status">
            Loading deployments...
          </p>
        ) : result.error ? (
          <p className="product-state form-error" role="alert">
            {result.error}
          </p>
        ) : result.data.items.length ? (
          <DeploymentRows items={result.data.items} />
        ) : (
          <Empty
            title="No changes recorded"
            text="Record a deployment or submit one from CI with a scoped API key."
          />
        )}
        <div className="product-pagination">
          <button
            className="button secondary small"
            disabled={result.offset === 0}
            onClick={() => result.setOffset(Math.max(0, result.offset - 20))}
          >
            Previous
          </button>
          <button
            className="button secondary small"
            disabled={!result.data.hasMore}
            onClick={() => result.setOffset(result.offset + 20)}
          >
            Next
          </button>
        </div>
      </section>
      <section className="data-panel product-help">
        <h2>Connect your deployment pipeline</h2>
        <p>
          Create a key with deployments:write in API keys, then POST your commit
          and affected monitor IDs to /api/deployments. Use a stable
          Idempotency-Key for retries.
        </p>
        <Link
          className="text-link"
          to={demo ? "/demo/api-keys" : "/dashboard/api-keys"}
        >
          Manage API keys
        </Link>
      </section>
    </>
  );
}
type Report = {
  revision: number;
  impact: string;
  rootCause: string;
  resolution: string;
  preventiveActions: string;
  updatedAt: string | null;
  evidence: {
    incident: Record<string, unknown>;
    updates: Array<{ status: string; message: string; created_at: string }>;
  };
};
const sampleReport: Report = {
  revision: 1,
  impact:
    "Search API response times increased. The endpoint remained available.",
  rootCause:
    "Not yet confirmed. Origin logs are needed to establish the cause.",
  resolution: "Monitoring recorded a return to normal latency.",
  preventiveActions:
    "Review connection-pool metrics and compare them with the deployment timeline.",
  updatedAt: null,
  evidence: {
    incident: {
      monitor_name: "Search API",
      started_at: "2026-09-28T14:31:00Z",
      resolved_at: null,
    },
    updates: [],
  },
};
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Postmortem({
  incidentId,
  demo,
}: {
  incidentId: string;
  demo: boolean;
}) {
  const [saved, setSaved] = useState<Report | null>(demo ? sampleReport : null),
    [draft, setDraft] = useState<Report | null>(demo ? sampleReport : null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    setError("");
    api<Report>(`/api/incidents/${incidentId}/postmortem`, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) {
          setSaved(r);
          setDraft(r);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [demo, incidentId, version]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (demo || !draft || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api<{ revision: number }>(
        `/api/incidents/${incidentId}/postmortem`,
        {
          method: "PUT",
          body: JSON.stringify({
            revision: draft.revision,
            impact: draft.impact,
            rootCause: draft.rootCause,
            resolution: draft.resolution,
            preventiveActions: draft.preventiveActions,
          }),
        },
      );
      const next = {
        ...draft,
        revision: r.revision,
        updatedAt: new Date().toISOString(),
      };
      setSaved(next);
      setDraft(next);
      setMessage("Report saved. It remains private to your workspace.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportReport() {
    if (!saved) return;
    const i = saved.evidence.incident;
    const timeline = saved.evidence.updates
      .map((u) => `- ${u.created_at}: ${u.status}. ${u.message}`)
      .join("\n");
    download(
      `# ${i.monitor_name} incident report\n\nStarted: ${i.started_at}\nResolved: ${i.resolved_at || "Not recorded"}\n\n## Impact\n${saved.impact}\n\n## Root cause\n${saved.rootCause}\n\n## Resolution\n${saved.resolution}\n\n## Preventive actions\n${saved.preventiveActions}\n\n## Recorded timeline\n${timeline || "No timeline updates recorded."}\n\nIncident: ${incidentId}\n`,
      `pulseflare-${incidentId}${demo ? "-sample" : ""}.md`,
    );
  }
  return (
    <section className="data-panel report-panel">
      <div className="panel-heading">
        <h2>Incident report</h2>
        <button
          className="button secondary small"
          disabled={!saved || busy || (!demo && !saved.revision)}
          onClick={exportReport}
        >
          <Download size={14} /> Export Markdown
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}
      {draft ? (
        <>
          <p className="form-hint">
            {demo
              ? "Sample report. This workspace is read-only."
              : "Private report. Save before exporting; changes here are never published automatically."}
          </p>
          <form className="postmortem-form" onSubmit={save}>
            <fieldset disabled={demo || busy} className="plain-fieldset">
              {(
                [
                  ["impact", "Impact"],
                  ["rootCause", "Root cause"],
                  ["resolution", "Resolution"],
                  ["preventiveActions", "Preventive actions"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    maxLength={4000}
                    rows={4}
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </fieldset>
            {!demo && (
              <div className="button-row">
                <button className="button primary small" disabled={busy}>
                  {busy ? "Saving..." : "Save report"}
                </button>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => setVersion((v) => v + 1)}
                >
                  Reload saved report
                </button>
              </div>
            )}
          </form>
          <details className="report-evidence">
            <summary>Recorded incident evidence</summary>
            <pre>{JSON.stringify(draft.evidence.incident, null, 2)}</pre>
            {draft.evidence.updates.map((u, index) => (
              <p key={index}>
                {u.created_at}: {u.message}
              </p>
            ))}
          </details>
        </>
      ) : (
        !error && <p role="status">Loading report...</p>
      )}
    </section>
  );
}
export function StatusDistribution({ slug }: { slug: string }) {
  const origin = window.location.origin;
  const base = `${origin}/api/status/${slug}`;
  return (
    <section className="data-panel product-help">
      <h2>Share your service health</h2>
      <p>
        Embed a badge in your README or subscribe to public updates. These links
        include only the published services and public incident updates.
      </p>
      <img
        src={`${base}/badge.svg`}
        alt="Public service status badge"
        width={210}
        height={24}
      />
      <div className="status-distribution">
        {[
          [
            "Markdown badge",
            `[![Service status](${base}/badge.svg)](${origin}/status/${slug})`,
          ],
          ["JSON status", base],
          ["RSS updates", `${base}/rss`],
        ].map(([label, text]) => (
          <div key={label}>
            <strong>{label}</strong>
            <code>{text}</code>
            <CopyButton text={text} label={`Copy ${label.toLowerCase()}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
