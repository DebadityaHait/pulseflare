import { useAuth } from "@clerk/clerk-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ExternalLink,
  Globe,
  HeartPulse,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { api } from "./api/client";
import { Badge, CopyButton, Empty } from "./components/ui";
import { LatencyChart } from "./components/telemetry";
import {
  StatusDistribution,
  DeploymentRows,
  useDeployments,
} from "./components/ProductTools";

function useLive<T>(path: string, initial: T, poll = false) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = poll
      ? window.setInterval(() => {
          if (!document.hidden) void load();
        }, 30000)
      : undefined;
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [path, version, poll]);
  return { data, loading, error, reload: () => setVersion((v) => v + 1) };
}
function Header({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="workspace-heading">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}
function ErrorLine({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function State({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  return loading ? (
    <p role="status">Loading your workspace...</p>
  ) : error ? (
    <div className="error-state">
      <ErrorLine error={error} />
      <button className="button secondary" onClick={reload}>
        Try again
      </button>
    </div>
  ) : null;
}
function useAdmin() {
  const { orgRole } = useAuth();
  return orgRole === "org:admin" || orgRole === "admin";
}
export type LiveMonitor = {
  id: string;
  name: string;
  url: string;
  type: "http" | "heartbeat";
  active: boolean;
  public: boolean;
  lastState: string;
  lastCheckedAt: string | null;
  intervalS: number;
  timeoutMs: number;
  method: string;
  expectedStatusMin: number;
  expectedStatusMax: number;
  expectedText?: string | null;
  forbiddenText?: string | null;
  jsonPath?: string | null;
  latencyThresholdMs?: number | null;
  heartbeatExpectedS?: number | null;
  heartbeatGraceS?: number | null;
  heartbeatLastAt?: string | null;
  heartbeatDeadlineAt?: string | null;
  secretConfigured: boolean;
  tags: string[];
  environment: string;
};
type Evidence = {
  id: number;
  checked_at: string;
  ok: number;
  status: number;
  state: string;
  latency_ms: number;
  error_code: string | null;
  error_msg: string | null;
};

export function MonitorEditor({
  existing,
  onSaved,
}: {
  existing?: LiveMonitor;
  onSaved?: () => void;
}) {
  const navigate = useNavigate();
  const admin = useAdmin();
  const [type, setType] = useState(existing?.type ?? "http");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const payload = {
        name: String(f.get("name")),
        type,
        public: f.get("public") === "on",
        tags: [
          ...new Set(
            String(f.get("tags") || "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
        environment: f.get("environment"),
        ...(type === "heartbeat"
          ? {
              heartbeatExpectedS: Number(f.get("frequency")) * 60,
              heartbeatGraceS: Number(f.get("grace")) * 60,
            }
          : {
              url: String(f.get("url")),
              method: String(f.get("method")),
              intervalS: Number(f.get("interval")),
              timeoutMs: Number(f.get("timeout")),
              expectedStatusMin: Number(f.get("statusMin")),
              expectedStatusMax: Number(f.get("statusMax")),
              expectedText: String(f.get("expectedText") || ""),
              forbiddenText: String(f.get("forbiddenText") || ""),
              jsonPath: String(f.get("jsonPath") || ""),
              latencyThresholdMs: f.get("latency")
                ? Number(f.get("latency"))
                : null,
              ...(f.get("headers")
                ? { headers: JSON.parse(String(f.get("headers"))) }
                : {}),
              ...(f.get("requestBody") || !existing
                ? { requestBody: String(f.get("requestBody") || "") }
                : {}),
            }),
      };
      if (existing) {
        await api(`/api/monitors/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        onSaved?.();
      } else {
        const result = await api<{
          monitor: LiveMonitor;
          heartbeatUrl: string | null;
        }>("/api/monitors", { method: "POST", body: JSON.stringify(payload) });
        if (result.heartbeatUrl) {
          setSecret(result.heartbeatUrl);
          setCreatedId(result.monitor.id);
        } else navigate(`/dashboard/monitors/${result.monitor.id}`);
      }
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? 'Headers must be a JSON object, for example {"Authorization":"Bearer ..."}.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  if (secret)
    return (
      <section className="data-panel monitor-form">
        <HeartPulse className="text-good" size={30} />
        <h2>Your heartbeat is ready.</h2>
        <p>
          Call this URL when your job completes successfully. Copy it now; it is
          shown only once.
        </p>
        <code className="secret-code">{secret}</code>
        <CopyButton text={`curl -fsS '${secret}'`} label="Copy curl command" />
        <p className="form-hint">
          Keep this URL private. You can rotate it from the monitor page.
        </p>
        <Link
          className="button primary"
          to={`/dashboard/monitors/${createdId}`}
        >
          Open monitor <ArrowRight size={15} />
        </Link>
      </section>
    );
  return (
    <>
      {!existing && (
        <>
          <Link className="back-link" to="/dashboard/monitors">
            <ArrowLeft size={14} /> Monitors
          </Link>
          <Header
            title="Keep an eye on it."
            text="Monitor a website, an API, or a background job."
          />
          <div className="monitor-templates">
            <button
              className={type === "http" ? "selected" : ""}
              onClick={() => setType("http")}
            >
              <Globe />
              <strong>Website or API</strong>
              <span>HTTP checks and assertions</span>
            </button>
            <button
              className={type === "heartbeat" ? "selected" : ""}
              onClick={() => setType("heartbeat")}
            >
              <HeartPulse />
              <strong>Background job</strong>
              <span>Watch for missing heartbeats</span>
            </button>
          </div>
        </>
      )}
      <form
        className="data-panel monitor-form"
        onSubmit={submit}
        key={existing?.id ?? type}
      >
        <h2>
          {existing
            ? "Monitor settings"
            : type === "http"
              ? "HTTP monitor"
              : "Heartbeat monitor"}
        </h2>
        <fieldset disabled={busy || !admin} className="plain-fieldset">
          <div className="form-grid">
            <label>
              Environment
              <select
                name="environment"
                aria-label="Environment"
                defaultValue={existing?.environment || "unassigned"}
              >
                <option value="unassigned">Unassigned</option>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </label>
            <label>
              Tags
              <input
                name="tags"
                aria-label="Tags"
                maxLength={500}
                defaultValue={existing?.tags?.join(", ")}
                placeholder="critical, customer-facing"
              />
              <span className="form-hint">Comma-separated, up to 12 tags.</span>
            </label>
          </div>
          <label>
            Monitor name
            <input
              name="name"
              defaultValue={existing?.name}
              placeholder={
                type === "http" ? "Production API" : "Nightly backup"
              }
              required
              maxLength={120}
            />
          </label>
          {type === "heartbeat" ? (
            <>
              <div className="form-columns">
                <label>
                  Expected interval (minutes)
                  <input
                    name="frequency"
                    type="number"
                    min={1}
                    max={43200}
                    defaultValue={(existing?.heartbeatExpectedS ?? 86400) / 60}
                    required
                  />
                </label>
                <label>
                  Grace period (minutes)
                  <input
                    name="grace"
                    type="number"
                    min={0}
                    max={43200}
                    defaultValue={(existing?.heartbeatGraceS ?? 1800) / 60}
                    required
                  />
                </label>
              </div>
              <p className="form-hint">
                The first deadline starts when you create or resume the monitor.
                Missed runs are detected within about a minute of the deadline.
              </p>
            </>
          ) : (
            <>
              <label>
                Endpoint URL
                <input
                  name="url"
                  type="url"
                  defaultValue={existing?.url}
                  placeholder="https://api.example.com/health"
                  required
                />
              </label>
              <div className="form-columns">
                <label>
                  Method
                  <select
                    name="method"
                    defaultValue={existing?.method ?? "GET"}
                  >
                    <option>GET</option>
                    <option>HEAD</option>
                    <option>POST</option>
                  </select>
                </label>
                <label>
                  Check interval
                  <select
                    name="interval"
                    defaultValue={existing?.intervalS ?? 300}
                  >
                    {[300, 600, 1800, 3600, 86400].map((s) => (
                      <option key={s} value={s}>
                        Every {s / 60} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Timeout
                  <select
                    name="timeout"
                    defaultValue={existing?.timeoutMs ?? 10000}
                  >
                    <option value={5000}>5 seconds</option>
                    <option value={10000}>10 seconds</option>
                    <option value={30000}>30 seconds</option>
                  </select>
                </label>
              </div>
              <details className="advanced-settings" open={!!existing}>
                <summary>Response assertions and request settings</summary>
                <div className="form-columns">
                  <label>
                    Minimum HTTP status
                    <input
                      name="statusMin"
                      type="number"
                      min={100}
                      max={599}
                      defaultValue={existing?.expectedStatusMin ?? 200}
                      required
                    />
                  </label>
                  <label>
                    Maximum HTTP status
                    <input
                      name="statusMax"
                      type="number"
                      min={100}
                      max={599}
                      defaultValue={existing?.expectedStatusMax ?? 299}
                      required
                    />
                  </label>
                </div>
                <label>
                  Response must contain
                  <input
                    name="expectedText"
                    maxLength={500}
                    defaultValue={existing?.expectedText ?? ""}
                    placeholder="healthy"
                  />
                </label>
                <label>
                  Response must not contain
                  <input
                    name="forbiddenText"
                    maxLength={500}
                    defaultValue={existing?.forbiddenText ?? ""}
                    placeholder="error"
                  />
                </label>
                <label>
                  JSON path that must exist
                  <input
                    name="jsonPath"
                    maxLength={120}
                    defaultValue={existing?.jsonPath ?? ""}
                    placeholder="$.status"
                  />
                </label>
                <label>
                  Degraded above (milliseconds)
                  <input
                    name="latency"
                    type="number"
                    min={1}
                    max={120000}
                    defaultValue={existing?.latencyThresholdMs ?? ""}
                    placeholder="1500"
                  />
                </label>
                <label>
                  Request headers (JSON)
                  <textarea
                    name="headers"
                    rows={3}
                    placeholder={
                      existing?.secretConfigured
                        ? "Saved headers are encrypted. Leave blank to keep them."
                        : '{"Authorization":"Bearer ..."}'
                    }
                  />
                </label>
                <label>
                  POST request body
                  <textarea
                    name="requestBody"
                    rows={3}
                    maxLength={32768}
                    placeholder={
                      existing
                        ? "Leave blank to keep the saved request body."
                        : '{"ping":true}'
                    }
                  />
                </label>
                <p className="form-hint">
                  Assertions inspect up to 256 KB. Redirects are not followed.
                  Outages are confirmed on the next failed check.
                </p>
              </details>
            </>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              name="public"
              defaultChecked={existing?.public ?? false}
            />{" "}
            Allow this monitor on your public status page
          </label>
          <ErrorLine error={error} />
          <div className="button-row">
            <button className="button primary" disabled={busy || !admin}>
              {busy
                ? "Saving..."
                : existing
                  ? "Save changes"
                  : "Create monitor"}{" "}
              <ArrowRight size={15} />
            </button>
            {existing && (
              <button type="button" className="button ghost" onClick={onSaved}>
                Cancel
              </button>
            )}
          </div>
        </fieldset>
        {!admin && (
          <p className="form-hint">A workspace admin can manage monitors.</p>
        )}
      </form>
    </>
  );
}

export function LiveMonitorDetail() {
  const { id } = useParams();
  const deployments = useDeployments(false, id);
  const navigate = useNavigate();
  const admin = useAdmin();
  const location = useLocation();
  const monitor = useLive<LiveMonitor | null>(
    `/api/monitors/${id}`,
    null,
    true,
  );
  const checks = useLive<Evidence[]>(
    `/api/monitors/${id}/checks?limit=100`,
    [],
    true,
  );
  const stats = useLive<{
    checks: number;
    uptime: number | null;
    avgLatencyMs: number;
  }>(
    `/api/monitors/${id}/stats`,
    { checks: 0, uptime: null, avgLatencyMs: 0 },
    true,
  );
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(path: string, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, { method });
      monitor.reload();
      checks.reload();
      stats.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const m = monitor.data;
  if (monitor.loading || monitor.error) return <State {...monitor} />;
  if (!m)
    return (
      <Empty
        title="Monitor not found"
        text="This monitor is not part of your workspace."
      />
    );
  if (edit)
    return (
      <MonitorEditor
        existing={m}
        onSaved={() => {
          setEdit(false);
          monitor.reload();
        }}
      />
    );
  return (
    <>
      <Link className="back-link" to="/dashboard/monitors">
        <ArrowLeft size={14} /> All monitors
      </Link>
      <Header
        title={m.name}
        text={
          m.type === "heartbeat" ? "A signal from your background job." : m.url
        }
      >
        <div className="button-row">
          <Badge state={m.lastState} />
          {admin && (
            <>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() =>
                  action(`/api/monitors/${id}/${m.active ? "pause" : "resume"}`)
                }
              >
                {m.active ? "Pause" : "Resume"}
              </button>
              <button
                className="button secondary small"
                onClick={() => setEdit(true)}
              >
                Edit
              </button>
            </>
          )}
        </div>
      </Header>
      <ErrorLine error={error} />
      <div className="monitor-detail-metrics">
        <div>
          <small>
            {m.type === "heartbeat"
              ? "Expected interval"
              : "Availability, last 24h"}
          </small>
          <strong>
            {m.type === "heartbeat"
              ? `${(m.heartbeatExpectedS ?? 0) / 60} min`
              : stats.data.checks
                ? `${stats.data.uptime?.toFixed(2)}%`
                : "Awaiting checks"}
          </strong>
        </div>
        <div>
          <small>
            {m.type === "heartbeat" ? "Grace period" : "Average response"}
          </small>
          <strong>
            {m.type === "heartbeat"
              ? `${(m.heartbeatGraceS ?? 0) / 60} min`
              : stats.data.checks
                ? `${stats.data.avgLatencyMs} ms`
                : "No data yet"}
          </strong>
        </div>
        <div>
          <small>
            {m.type === "heartbeat" ? "Last heartbeat" : "Last check"}
          </small>
          <strong className="small-metric">
            {(m.type === "heartbeat" ? m.heartbeatLastAt : m.lastCheckedAt)
              ? new Date(
                  (m.type === "heartbeat"
                    ? m.heartbeatLastAt
                    : m.lastCheckedAt)!,
                ).toLocaleString()
              : "Waiting"}
          </strong>
        </div>
      </div>
      {m.type === "heartbeat" ? (
        <section className="data-panel status-builder">
          <HeartPulse size={30} className="text-good" />
          <h2>
            {!m.active
              ? "Monitoring is paused."
              : m.lastState === "down"
                ? "An expected run is missing."
                : "Listening for your next run."}
          </h2>
          <p>
            {m.active && m.heartbeatDeadlineAt
              ? `Next deadline: ${new Date(m.heartbeatDeadlineAt).toLocaleString()}.`
              : "Resume to start a fresh expected window."}
          </p>
          <p>
            Call your secret URL after a successful run. Pings reset the
            deadline and resolve missed-run incidents.
          </p>
          {secret ? (
            <>
              <code className="secret-code">{secret}</code>
              <CopyButton
                text={`curl -fsS '${secret}'`}
                label="Copy curl command"
              />
            </>
          ) : (
            <p className="form-hint">
              The secret URL is shown only at creation or rotation.
            </p>
          )}
          {admin && (
            <button
              className="button secondary small"
              onClick={() => setRotating(true)}
            >
              Rotate heartbeat URL
            </button>
          )}
          {rotating && (
            <div className="confirm-box">
              <p>
                The previous URL will stop working immediately. Update your job
                with the new URL.
              </p>
              <div className="button-row">
                <button
                  disabled={busy}
                  className="button primary small"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await api<{ heartbeatUrl: string }>(
                        `/api/monitors/${id}/rotate-secret`,
                        { method: "POST" },
                      );
                      setSecret(r.heartbeatUrl);
                      setRotating(false);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Rotate URL
                </button>
                <button
                  className="button ghost small"
                  onClick={() => setRotating(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="data-panel">
          <div className="panel-heading">
            <h2>Response time</h2>
            {admin && (
              <button
                className="button secondary small"
                disabled={busy || !m.active}
                onClick={() => action(`/api/monitors/${id}/test`)}
              >
                <RefreshCw size={14} /> Run check
              </button>
            )}
          </div>
          {checks.data.length ? (
            <div className="panel-chart">
              <LatencyChart
                deployments={deployments.data.items}
                data={checks.data
                  .slice()
                  .reverse()
                  .map((c) => ({
                    time: new Date(c.checked_at).toLocaleTimeString(),
                    timestamp: Date.parse(c.checked_at),
                    latency: c.latency_ms,
                  }))}
              />
            </div>
          ) : (
            <Empty
              title="Your first check is on its way"
              text="Checks start automatically. Run a check now to verify this endpoint."
            />
          )}
        </section>
      )}
      <section className="data-panel">
        <div className="panel-heading">
          <h2>Deployment annotations</h2>
          <Link className="text-link" to="/dashboard/deployments">
            Record a change
          </Link>
        </div>
        {deployments.error ? (
          <p className="product-state form-error" role="alert">
            {deployments.error}
          </p>
        ) : deployments.data.items.length ? (
          <DeploymentRows items={deployments.data.items} />
        ) : (
          <p className="product-state form-hint">
            No deployments recorded for this monitor.
          </p>
        )}
      </section>
      <section className="data-panel">
        <div className="panel-heading">
          <h2>
            {m.type === "heartbeat" ? "Recent heartbeats" : "Recent checks"}
          </h2>
          <button
            className="button ghost small"
            onClick={() => {
              checks.reload();
              monitor.reload();
            }}
          >
            Refresh
          </button>
        </div>
        <ErrorLine error={checks.error} />
        {checks.data.slice(0, 20).map((c) => (
          <div className="evidence-row" key={c.id}>
            <time>{new Date(c.checked_at).toLocaleString()}</time>
            <Badge state={c.state} />
            <span>
              {c.error_code ||
                (m.type === "heartbeat" ? "Ping received" : `HTTP ${c.status}`)}
            </span>
            {m.type === "http" && (
              <span className="mono">{c.latency_ms} ms</span>
            )}
            {c.error_msg && <small>{c.error_msg}</small>}
          </div>
        ))}
        {!checks.data.length && (
          <p className="muted">No evidence recorded yet.</p>
        )}
      </section>
      {admin && (
        <section className="danger-panel">
          <button
            className="button ghost small"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} /> Delete monitor
          </button>
          {deleting && (
            <div className="confirm-box">
              <p>
                Delete {m.name} and its check history? This cannot be undone.
              </p>
              <div className="button-row">
                <button
                  disabled={busy}
                  className="button secondary small"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/api/monitors/${id}`, { method: "DELETE" });
                      navigate("/dashboard/monitors");
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  Delete permanently
                </button>
                <button
                  className="button ghost small"
                  onClick={() => setDeleting(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

type Integration = { id: string; kind: string; name: string; enabled: boolean };
type Delivery = {
  event_id: string;
  status: string;
  response_code: number | null;
  error_message: string | null;
  attempts: number;
  attempted_at: string;
  created_at: string;
};
function DeliveryHistory({ id }: { id: string }) {
  const deliveries = useLive<Delivery[]>(
    `/api/integrations/${id}/deliveries`,
    [],
    true,
  );
  return (
    <>
      <State {...deliveries} />
      {!deliveries.loading &&
        !deliveries.error &&
        (deliveries.data.length ? (
          deliveries.data.map((d) => (
            <div className="evidence-row" key={d.event_id}>
              <time>
                {new Date(d.attempted_at || d.created_at).toLocaleString()}
              </time>
              <Badge state={d.status} />
              <span>
                {d.response_code
                  ? `HTTP ${d.response_code}`
                  : "Awaiting provider"}
              </span>
              <small>Attempt {d.attempts}</small>
              {d.error_message && <small>{d.error_message}</small>}
            </div>
          ))
        ) : (
          <Empty
            title="No deliveries yet"
            text="Send a test or wait for an incident to verify your integration."
          />
        ))}
    </>
  );
}
export function LiveIntegrations() {
  const admin = useAdmin();
  const integrations = useLive<Integration[]>("/api/integrations", []);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState("slack");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/api/integrations", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          kind,
          config:
            kind === "telegram"
              ? { botToken: f.get("botToken"), chatId: f.get("chatId") }
              : {
                  webhookUrl: f.get("webhookUrl"),
                  ...(kind === "webhook" && f.get("signingSecret")
                    ? { signingSecret: f.get("signingSecret") }
                    : {}),
                },
        }),
      });
      setCreating(false);
      integrations.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(i: Integration, remove = false) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/integrations/${i.id}`, {
        method: remove ? "DELETE" : "PATCH",
        ...(remove ? {} : { body: JSON.stringify({ enabled: !i.enabled }) }),
      });
      if (remove) setSelected(null);
      integrations.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="Integrations"
        text="Get incident and recovery notifications where your team works."
      >
        {admin && (
          <button
            className="button primary small"
            onClick={() => setCreating(!creating)}
          >
            <Plus size={15} /> Add integration
          </button>
        )}
      </Header>
      <ErrorLine error={error} />
      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}
      {creating && (
        <form className="data-panel monitor-form" onSubmit={create}>
          <h2>Connect a notification channel</h2>
          <label>
            Provider
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label>
            Name
            <input
              name="name"
              placeholder="Engineering alerts"
              required
              maxLength={80}
            />
          </label>
          {kind === "telegram" ? (
            <>
              <label>
                Bot token
                <input
                  name="botToken"
                  type="password"
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                Chat ID
                <input name="chatId" required placeholder="-100123456789" />
              </label>
              <p className="form-hint">
                Create a bot with BotFather, add it to your chat, and supply
                that chat's numeric ID.
              </p>
            </>
          ) : (
            <>
              <label>
                {kind === "webhook" ? "HTTPS endpoint" : "Incoming webhook URL"}
                <input
                  name="webhookUrl"
                  type="url"
                  required
                  autoComplete="off"
                  placeholder={
                    kind === "slack"
                      ? "https://hooks.slack.com/services/..."
                      : kind === "discord"
                        ? "https://discord.com/api/webhooks/..."
                        : "https://example.com/pulseflare"
                  }
                />
              </label>
              {kind === "webhook" && (
                <label>
                  Signing secret (optional)
                  <input
                    name="signingSecret"
                    type="password"
                    autoComplete="off"
                    maxLength={5000}
                  />
                </label>
              )}
            </>
          )}
          <p className="form-hint">
            Credentials are encrypted. All monitors send opened and resolved
            events by default.
          </p>
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              Connect
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <State {...integrations} />
      <div className="integration-cards">
        {integrations.data.map((i) => (
          <button
            className={`integration-card ${selected === i.id ? "selected" : ""}`}
            key={i.id}
            onClick={() => setSelected(selected === i.id ? null : i.id)}
          >
            <span className="integration-card-icon">
              {["slack", "discord", "telegram"].includes(i.kind) ? (
                <img
                  src={`/images/${i.kind}.svg`}
                  width={26}
                  height={26}
                  alt=""
                />
              ) : (
                <Webhook size={26} />
              )}
            </span>
            <Badge state={i.enabled ? "connected" : "paused"} />
            <h3>{i.name}</h3>
            <p>{i.kind}</p>
            <span className="text-link">
              View deliveries <ArrowRight size={14} />
            </span>
          </button>
        ))}
      </div>
      {!integrations.loading &&
        !integrations.error &&
        !integrations.data.length && (
          <Empty
            title="Your first alert channel"
            text="Connect Slack, Discord, Telegram, or a webhook to receive notifications."
          />
        )}
      {selected && (
        <section className="data-panel">
          <div className="panel-heading">
            <h2>Delivery history</h2>
            {admin && (
              <div className="button-row">
                <button
                  className="button secondary small"
                  disabled={
                    busy ||
                    !integrations.data.find((i) => i.id === selected)?.enabled
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/api/integrations/${selected}/test`, {
                        method: "POST",
                      });
                      setMessage(
                        "Test queued. Delivery results will appear here after the queue processes it.",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Bell size={14} /> Send test
                </button>
                <button
                  className="button ghost small"
                  disabled={busy}
                  onClick={() =>
                    change(integrations.data.find((i) => i.id === selected)!)
                  }
                >
                  {integrations.data.find((i) => i.id === selected)?.enabled
                    ? "Disable"
                    : "Enable"}
                </button>
                <button
                  className="button ghost small"
                  disabled={busy}
                  onClick={() =>
                    change(
                      integrations.data.find((i) => i.id === selected)!,
                      true,
                    )
                  }
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
          <DeliveryHistory key={selected} id={selected} />
        </section>
      )}
    </>
  );
}

type Page = {
  id: string;
  title: string;
  slug: string;
  description: string;
  brand_color: string;
  published: number;
  monitorIds: string[];
};
export function LiveStatusBuilder() {
  const admin = useAdmin();
  const pages = useLive<Page[]>("/api/status-pages", []);
  const monitors = useLive<LiveMonitor[]>("/api/monitors", []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const page = pages.data[0];
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    const f = new FormData(e.currentTarget);
    try {
      const input = {
        title: f.get("title"),
        slug: f.get("slug"),
        description: f.get("description"),
        brandColor: f.get("color"),
        published: f.get("published") === "on",
      };
      const result = await api<{ id: string }>(
        page ? `/api/status-pages/${page.id}` : "/api/status-pages",
        { method: page ? "PATCH" : "POST", body: JSON.stringify(input) },
      );
      await api(`/api/status-pages/${page?.id ?? result.id}/monitors`, {
        method: "PUT",
        body: JSON.stringify({ monitorIds: f.getAll("monitor") }),
      });
      pages.reload();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="Status page"
        text="Give customers a clear view of your services."
      >
        {page?.published === 1 && (
          <Link
            className="button secondary small"
            to={`/status/${page.slug}`}
            target="_blank"
          >
            View page <ExternalLink size={14} />
          </Link>
        )}
      </Header>
      <State {...pages} />
      {page?.published === 1 && <StatusDistribution slug={page.slug} />}
      {!pages.loading && !pages.error && (
        <form
          className="data-panel monitor-form"
          onSubmit={save}
          key={page?.id ?? "new"}
        >
          <h2>{page ? "Page settings" : "Publish your first status page"}</h2>
          <fieldset className="plain-fieldset" disabled={!admin || busy}>
            <label>
              Page title
              <input
                name="title"
                defaultValue={page?.title ?? ""}
                placeholder="Your service status"
                maxLength={120}
                required
              />
            </label>
            <label>
              Public URL slug
              <input
                name="slug"
                defaultValue={page?.slug ?? ""}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                maxLength={50}
                placeholder="your-company"
                required
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                defaultValue={
                  page?.description ??
                  "Current service health and incident updates."
                }
                maxLength={500}
                rows={3}
              />
            </label>
            <label>
              Brand color
              <input
                name="color"
                type="color"
                defaultValue={page?.brand_color ?? "#ed7626"}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                name="published"
                defaultChecked={page ? !!page.published : true}
              />{" "}
              Publish this page
            </label>
            <h3>Visible services</h3>
            <p className="form-hint">
              Only monitors marked public can be selected. Enable this in
              monitor settings first.
            </p>
            <ErrorLine error={monitors.error} />
            {monitors.data
              .filter((m) => m.public)
              .map((m) => (
                <label className="check-label component-choice" key={m.id}>
                  <input
                    type="checkbox"
                    name="monitor"
                    value={m.id}
                    defaultChecked={page?.monitorIds?.includes(m.id)}
                  />
                  {m.name}
                  <Badge state={m.lastState} />
                </label>
              ))}
            <ErrorLine error={error} />
            <button className="button primary" disabled={busy || !admin}>
              {busy ? "Saving..." : "Save status page"}
            </button>
          </fieldset>
          {saved && (
            <p className="text-good" role="status">
              Saved. Public changes appear within two minutes.
            </p>
          )}
          {!admin && (
            <p className="form-hint">A workspace admin can edit this page.</p>
          )}
          {page && (
            <div className="button-row">
              <CopyButton
                text={`${location.origin}/status/${page.slug}`}
                label="Copy public link"
              />
            </div>
          )}
        </form>
      )}
    </>
  );
}
