import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Code2,
  Download,
  ExternalLink,
  Globe,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
  X,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api } from "./api/client";
import { IncidentChat } from "./components/IncidentChat";
import {
  LiveIntegrations,
  LiveStatusBuilder,
  LiveMonitorDetail,
  MonitorEditor,
} from "./live";
import {
  Badge,
  Brand,
  CopyButton,
  Empty,
  ThemeToggle,
  useNotice,
} from "./components/ui";
import { LatencyChart, MonitorTable, UptimeBar } from "./components/telemetry";
import {
  demoDeliveries,
  demoIncidents,
  demoMonitors,
  demoTimeline,
  timelineFor,
  latencySeries,
  postmortemMarkdown,
} from "./data/demo";

const WorkspaceContext = createContext({ demo: true, base: "/demo" });
function Integrations() {
  const { demo } = useWorkspace();
  const notice = useNotice();
  const result = useResource<
    Array<{ id: string; kind: string; name: string; enabled: boolean }>
  >("/api/integrations", [
    { id: "slack", kind: "slack", name: "Engineering", enabled: true },
    { id: "webhook", kind: "webhook", name: "Incident handler", enabled: true },
    { id: "discord", kind: "discord", name: "Operations", enabled: false },
  ]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!demo) return <LiveIntegrations />;
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Send the right signal to the places your team already works."
        action={
          <button
            className="button primary small"
            onClick={() =>
              notice(
                "Integration setup",
                demo
                  ? "This is a read-only preview. Sign up to connect integrations in your own workspace."
                  : "Use the workspace API to configure encrypted integrations. The setup wizard is coming soon.",
              )
            }
          >
            <Plus size={15} /> Add integration
          </button>
        }
      />
      <ResourceState {...result} retry={result.reload}>
        <div className="integration-cards">
          {result.data.map((i) => (
            <button
              className={`integration-card ${selected === i.id ? "selected" : ""}`}
              key={i.id}
              onClick={() => setSelected(selected === i.id ? null : i.id)}
            >
              <span className="integration-card-icon">
                {["slack", "discord", "telegram"].includes(i.kind) ? (
                  <img
                    src={`/images/${i.kind}.svg`}
                    alt=""
                    width="26"
                    height="26"
                  />
                ) : (
                  <Webhook size={26} />
                )}
              </span>
              <Badge state={i.enabled ? "connected" : "attention"} />
              <h3>{i.name}</h3>
              <p>{i.kind}</p>
              <span className="text-link">
                View details <ArrowUpRight size={13} />
              </span>
            </button>
          ))}
        </div>
        {!result.data.length && (
          <Empty
            title="No integrations yet"
            text="Connect a notification channel to get alerts."
          />
        )}
        {selected && (
          <section className="data-panel">
            <div className="panel-heading">
              <h2>
                {result.data.find((i) => i.id === selected)?.name} delivery
                history
              </h2>
              <button
                className="button secondary small"
                onClick={() =>
                  notice(
                    "Test notifications",
                    demo
                      ? "No notification was sent. Sending is disabled in the public demo."
                      : "Test delivery is not enabled in this UI yet.",
                  )
                }
              >
                <Bell size={14} /> Test notification
              </button>
            </div>
            {demo ? (
              demoDeliveries
                .filter((d) => d.channel.toLowerCase() === selected)
                .map((d) => (
                  <div className="delivery-row" key={d.channel}>
                    <Clock size={15} />
                    <div>
                      <strong>Incident opened</strong>
                      <small>{d.time} · sample</small>
                    </div>
                    <Badge state={d.status.toLowerCase()} />
                    <span>HTTP {d.code}</span>
                    <span>{d.duration}</span>
                  </div>
                ))
            ) : (
              <Empty
                title="Delivery inspector coming soon"
                text="Per-integration delivery history will appear here."
              />
            )}
          </section>
        )}
        <p className="form-hint">
          <LockKeyhole size={14} /> The v2 API encrypts integration secrets.
          Clear credentials are never shown in this view.
        </p>
      </ResourceState>
    </>
  );
}
function Usage() {
  const notice = useNotice();
  const result = useResource("/api/usage", {
    entitlements: {
      maxActiveMonitors: 5,
      maxIntegrations: 5,
      maxApiKeys: 3,
      rawRetentionDays: 7,
      hourlyRetentionDays: 90,
    },
    current: {
      activeMonitors: 4,
      integrations: 3,
      apiKeys: 1,
      aiEnrichments: 4,
    },
  });
  const { current: c, entitlements: e } = result.data;
  return (
    <>
      <PageHeader
        title="Usage & plans"
        description="Room to build, with clear limits along the way."
      />
      <ResourceState {...result} retry={result.reload}>
        <div className="plan-banner">
          <span className="plan-icon">
            <Activity size={25} />
          </span>
          <div>
            <h2>Pulseflare Beta</h2>
            <p>Your starting point for better uptime.</p>
          </div>
          <strong>
            $0 <small>/ month</small>
          </strong>
          <button
            className="button secondary small"
            onClick={() =>
              notice(
                "More room, coming soon",
                "Pro and Team plans are in development. No billing or subscription changes have been made.",
              )
            }
          >
            Explore plans <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="usage-grid">
          {[
            {
              label: "Active monitors",
              used: c.activeMonitors,
              total: e.maxActiveMonitors,
            },
            {
              label: "Integrations",
              used: c.integrations,
              total: e.maxIntegrations,
            },
            { label: "API keys", used: c.apiKeys, total: e.maxApiKeys },
            { label: "AI analyses today", used: c.aiEnrichments, total: 10 },
          ].map((u) => (
            <div className="data-panel usage-card" key={u.label}>
              <h3>{u.label}</h3>
              <strong>
                {u.used}
                <small> / {u.total}</small>
              </strong>
              <meter
                min={0}
                max={u.total}
                value={u.used}
                aria-label={u.label}
              />
              <p>{u.total - u.used} remaining</p>
            </div>
          ))}
        </div>
        <div className="data-panel retention-row">
          <Clock size={20} />
          <div>
            <strong>History retention policy</strong>
            <p>
              {e.rawRetentionDays} days of raw checks · {e.hourlyRetentionDays}{" "}
              days of hourly analytics
            </p>
          </div>
          <span className="panel-meta">v2 target policy</span>
        </div>
      </ResourceState>
    </>
  );
}
function Keys() {
  const { demo } = useWorkspace();
  const notice = useNotice();
  const result = useResource<
    Array<{
      id: string;
      name: string;
      prefix: string;
      scopes: string[];
      revoked_at: string | null;
    }>
  >("/api/api-keys", [
    {
      id: "demo-key",
      name: "GitHub Actions",
      prefix: "pf_live_demo",
      scopes: ["monitors:read"],
      revoked_at: null,
    },
  ]);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo)
      return notice(
        "Keys stay private",
        "The demo does not issue credentials. In your workspace, a new API key is displayed only once.",
      );
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const created = await api<{ key: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          scopes: ["monitors:read", "incidents:read"],
        }),
      });
      setKey(created.key);
      result.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (demo)
      return notice(
        "Read-only sample key",
        "No real API key exists in this demo.",
      );
    try {
      await api(`/api/api-keys/${id}`, { method: "DELETE" });
      result.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <>
      <PageHeader
        title="API keys"
        description="Your workspace, accessible from your tools."
      />
      <div className="data-panel key-form">
        <form onSubmit={create}>
          <label>
            Key name
            <input
              name="name"
              required
              maxLength={80}
              placeholder="e.g. GitHub Actions"
            />
          </label>
          <button className="button primary small" disabled={busy}>
            <Plus size={15} /> {busy ? "Creating…" : "Create read-only key"}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
        {key && (
          <div className="key-reveal">
            <strong>Copy this key now. It won’t be shown again.</strong>
            <code>{key}</code>
            <CopyButton text={key} />
          </div>
        )}
      </div>
      <ResourceState {...result} retry={result.reload}>
        <section className="data-panel">
          {result.data.length ? (
            result.data.map((k) => (
              <div className="api-key-row" key={k.id}>
                <LockKeyhole size={18} />
                <div>
                  <strong>{k.name}</strong>
                  <code>{k.prefix}••••••••</code>
                  <small>{k.scopes.join(", ")}</small>
                </div>
                <Badge state={k.revoked_at ? "revoked" : "active"} />
                {!k.revoked_at && (
                  <button
                    className="button secondary small"
                    onClick={() => revoke(k.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty
              title="No API keys"
              text="Create a scoped key for scripts and integrations."
            />
          )}
        </section>
      </ResourceState>
      <p className="form-hint">
        <ShieldCheck size={14} /> Keys are stored as hashes. Never put them in
        your frontend code.
      </p>
    </>
  );
}
function StatusBuilder() {
  const { demo } = useWorkspace();
  const result = useResource<
    Array<{
      id: string;
      title: string;
      slug: string;
      description: string;
      published: number;
    }>
  >("/api/status-pages", [
    {
      id: "demo",
      title: "Orbit system status",
      slug: "demo",
      description: "Current health of Orbit services.",
      published: 1,
    },
  ]);
  const notice = useNotice();
  const page = result.data[0];
  if (!demo) return <LiveStatusBuilder />;
  return (
    <>
      <PageHeader
        title="Status page"
        description="A clear, public home for your service health."
        action={
          page && (
            <Link
              className="button secondary small"
              to={`/status/${page.slug}`}
            >
              View page <ExternalLink size={14} />
            </Link>
          )
        }
      />
      <ResourceState {...result} retry={result.reload}>
        {page ? (
          <>
            <section className="data-panel status-builder">
              <div className="status-builder-title">
                <Globe size={26} />
                <Badge state={page.published ? "published" : "draft"} />
              </div>
              <h2>{page.title}</h2>
              <p>{page.description}</p>
              <code>
                {location.origin}/status/{page.slug}
              </code>
              <div className="button-row">
                <CopyButton
                  text={`${location.origin}/status/${page.slug}`}
                  label="Copy public link"
                />
                <button
                  className="button secondary small"
                  onClick={() =>
                    notice(
                      "Status page editing",
                      demo
                        ? "Branding and component selection are previewed in this sample. Demo changes are not saved."
                        : "The status-page editor is coming soon. Use the workspace API to update branding.",
                    )
                  }
                >
                  Edit page
                </button>
              </div>
            </section>
            <section className="data-panel">
              <div className="panel-heading">
                <h2>Components</h2>
                <span className="panel-meta">
                  {demo ? "Sample selection" : "Configured monitors"}
                </span>
              </div>
              {demo ? (
                demoMonitors.map((m) => (
                  <div className="component-row" key={m.id}>
                    <Globe size={16} />
                    <span>{m.name}</span>
                    <Badge state={m.state} />
                  </div>
                ))
              ) : (
                <Empty
                  title="Manage components through the API"
                  text="The component editor is coming soon."
                />
              )}
            </section>
          </>
        ) : (
          <Empty
            title="Publish your first status page"
            text="Status-page creation is available through the v2 workspace API."
          />
        )}
      </ResourceState>
    </>
  );
}
function Maintenance() {
  const result = useResource<
    Array<{
      id: string;
      title: string;
      description: string;
      starts_at: string;
      ends_at: string;
    }>
  >("/api/maintenance", [
    {
      id: "maintenance-demo",
      title: "Database maintenance",
      description: "Routine connection pool and index maintenance.",
      starts_at: "2026-10-03T02:00:00Z",
      ends_at: "2026-10-03T02:30:00Z",
    },
  ]);
  const notice = useNotice();
  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Make planned downtime part of the plan."
        action={
          <button
            className="button primary small"
            onClick={() =>
              notice(
                "Maintenance scheduling",
                "The scheduling UI is coming soon. The sample shows how a planned maintenance window appears.",
              )
            }
          >
            <Plus size={15} /> Schedule window
          </button>
        }
      />
      <ResourceState {...result} retry={result.reload}>
        {result.data.length ? (
          result.data.map((w) => (
            <section className="data-panel maintenance-card" key={w.id}>
              <Clock size={23} />
              <div>
                <h2>{w.title}</h2>
                <p>{w.description}</p>
                <span className="mono">
                  {new Date(w.starts_at).toLocaleString()} -{" "}
                  {new Date(w.ends_at).toLocaleTimeString()}
                </span>
              </div>
              <Badge state="scheduled" />
            </section>
          ))
        ) : (
          <Empty
            title="No scheduled maintenance"
            text="Your upcoming maintenance windows will appear here."
          />
        )}
      </ResourceState>
    </>
  );
}
function Audit() {
  const result = useResource<
    Array<{
      id: string;
      action: string;
      resource_type: string;
      created_at: string;
    }>
  >("/api/audit", [
    {
      id: "1",
      action: "incident.acknowledged",
      resource_type: "incident",
      created_at: "14:40 UTC",
    },
    {
      id: "2",
      action: "monitor.created",
      resource_type: "monitor",
      created_at: "12:05 UTC",
    },
    {
      id: "3",
      action: "integration.created",
      resource_type: "integration",
      created_at: "Yesterday",
    },
    {
      id: "4",
      action: "api_key.created",
      resource_type: "api_key",
      created_at: "Yesterday",
    },
  ]);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A record of the changes made in your workspace."
      />
      <ResourceState {...result} retry={result.reload}>
        <section className="data-panel">
          {result.data.length ? (
            result.data.map((e) => (
              <div className="audit-row" key={e.id}>
                <ShieldCheck size={16} />
                <strong>{e.action}</strong>
                <span>{e.resource_type}</span>
                <time>{e.created_at}</time>
              </div>
            ))
          ) : (
            <Empty
              title="No changes recorded yet"
              text="Workspace changes will appear here."
            />
          )}
        </section>
      </ResourceState>
    </>
  );
}
function WorkspaceSettings() {
  const { demo } = useWorkspace();
  const notice = useNotice();
  const result = useResource("/api/workspace", {
    workspace: { name: "Orbit workspace" },
    role: "admin",
    entitlements: {},
  });
  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="A space for your team and your services."
      />
      <ResourceState {...result} retry={result.reload}>
        <section className="data-panel settings-card">
          <h2>General</h2>
          <div>
            <span>Workspace</span>
            <strong>{result.data.workspace?.name}</strong>
          </div>
          <div>
            <span>Role</span>
            <Badge state={result.data.role} />
          </div>
          <div>
            <span>Authentication</span>
            <strong>{demo ? "Demo (no account required)" : "Clerk"}</strong>
          </div>
        </section>
        <section className="data-panel settings-card">
          <h2>Team</h2>
          <p>Workspace membership is managed through Clerk organizations.</p>
          <button
            className="button secondary small"
            onClick={() =>
              notice(
                "Workspace membership",
                demo
                  ? "This fictional workspace is a read-only preview. No invitations are sent from the demo."
                  : "Use the organization control in the sidebar to manage your Clerk organization.",
              )
            }
          >
            <Users size={15} /> Manage members
          </button>
        </section>
      </ResourceState>
    </>
  );
}
function useWorkspace() {
  return useContext(WorkspaceContext);
}
function useResource<T>(path: string, sample: T) {
  const { demo } = useWorkspace();
  const [data, setData] = useState<T>(sample);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (demo) {
      setData(sample);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, demo, version]);
  return { data, loading, error, reload: () => setVersion((v) => v + 1) };
}
function ResourceState({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: string;
  retry?: () => void;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div
        className="skeleton-group"
        role="status"
        aria-label="Loading workspace"
      >
        <div />
        <div />
        <div />
      </div>
    );
  if (error)
    return (
      <div className="error-state" role="alert">
        <AlertCircle />
        <h3>We couldn’t load this view.</h3>
        <p>{error}</p>
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
type ApiMonitor = {
  id: string;
  name: string;
  url: string;
  type?: "http" | "heartbeat";
  lastState?: string;
  active: boolean;
  intervalS: number;
  tags?: string[];
  timeoutMs: number;
  uptime24h?: number | null;
  latestLatencyMs?: number | null;
};
const apiDemoMonitors: ApiMonitor[] = demoMonitors.map((m) => ({
  ...m,
  lastState: m.state,
  tags: [m.tag],
  timeoutMs: 10000,
}));
function useMonitors() {
  const { demo } = useWorkspace();
  const result = useResource<ApiMonitor[]>("/api/monitors", apiDemoMonitors);
  return {
    ...result,
    monitors: demo
      ? demoMonitors
      : result.data.map((m) => ({
          id: m.id,
          name: m.name,
          url: m.url,
          type: m.type || ("http" as const),
          state: m.lastState || (m.active ? "unknown" : "paused"),
          active: m.active,
          intervalS: m.intervalS,
          tag: m.tags?.[0] || "default",
          uptime: m.uptime24h ?? 0,
          latency: m.latestLatencyMs ?? 0,
          uptimeKnown: m.uptime24h !== null && m.uptime24h !== undefined,
          latencyKnown:
            m.latestLatencyMs !== null && m.latestLatencyMs !== undefined,
        })),
  };
}
function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="workspace-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
const navItems = [
  { to: "", label: "Overview", icon: LayoutDashboard },
  { to: "/monitors", label: "Monitors", icon: Activity },
  { to: "/incidents", label: "Incidents", icon: AlertCircle },
  { to: "/status-page", label: "Status page", icon: Globe },
  { to: "/integrations", label: "Integrations", icon: Webhook },
  { to: "/maintenance", label: "Maintenance", icon: Clock },
];
const manageItems = [
  { to: "/api-keys", label: "API keys", icon: Code2 },
  { to: "/usage", label: "Usage & plans", icon: Radio },
  { to: "/audit", label: "Audit log", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];
export default function Workspace({
  demo = true,
  userControl,
  organizationControl,
  workspaceName,
}: {
  demo?: boolean;
  userControl?: ReactNode;
  organizationControl?: ReactNode;
  workspaceName?: string;
}) {
  const base = demo ? "/demo" : "/dashboard";
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  useEffect(() => setMobile(false), [location.pathname]);
  return (
    <WorkspaceContext.Provider value={{ demo, base }}>
      <div className="workspace-shell">
        <aside className={`app-sidebar ${mobile ? "mobile-open" : ""}`}>
          <div className="sidebar-brand">
            <Brand />
            <button
              className="icon-btn sidebar-close"
              onClick={() => setMobile(false)}
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>
          {organizationControl ? (
            <div className="workspace-switcher">{organizationControl}</div>
          ) : (
            <div className="workspace-switcher">
              <span className="workspace-avatar">{demo ? "o" : "p"}</span>
              <div>
                <strong>
                  {demo ? "Orbit workspace" : workspaceName || "Your workspace"}
                </strong>
                <small>{demo ? "Demo workspace" : "Workspace"}</small>
              </div>
              <ChevronRight size={14} />
            </div>
          )}
          <nav aria-label="Workspace navigation">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink end to={`${base}${to}`} key={to}>
                <Icon size={17} />
                {label}
                {label === "Incidents" && demo && (
                  <span className="nav-count">1</span>
                )}
              </NavLink>
            ))}
            <span className="nav-section-label">MANAGE</span>
            {manageItems.map(({ to, label, icon: Icon }) => (
              <NavLink end to={`${base}${to}`} key={to}>
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Link to="/docs">
              <BookOpen size={16} /> Documentation <ArrowUpRight size={13} />
            </Link>
            <div className="sidebar-profile">
              <span className="profile-avatar">{demo ? "OB" : "PF"}</span>
              <div>
                <strong>{demo ? "Orbit Studio" : "Workspace account"}</strong>
                <small>
                  {demo ? "Read-only preview" : "Authenticated session"}
                </small>
              </div>
              {userControl || <ThemeToggle />}
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="app-topbar">
            <div>
              <button
                className="icon-btn mobile-menu"
                onClick={() => setMobile(!mobile)}
                aria-label="Open sidebar"
              >
                <Menu size={18} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {[...navItems, ...manageItems].find(
                  (n) => `${base}${n.to}` === location.pathname,
                )?.label || "Details"}
              </strong>
            </div>
            <div>
              {demo && <span className="demo-badge">DEMO</span>}
              <ThemeToggle />
              <Link to="/" className="icon-btn" aria-label="Back to website">
                <ExternalLink size={16} />
              </Link>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <span>
                You’re exploring a sample workspace. All data is fictional.
              </span>
              <Link to="/signup">
                Create your workspace <ArrowUpRight size={13} />
              </Link>
            </div>
          )}
          <main className="app-content">
            <Routes>
              <Route index element={<Overview />} />
              <Route path="monitors" element={<Monitors />} />
              <Route path="monitors/new" element={<NewMonitor />} />
              <Route path="monitors/:id" element={<MonitorDetail />} />
              <Route path="incidents" element={<Incidents />} />
              <Route path="incidents/:id" element={<IncidentDetail />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="status-page" element={<StatusBuilder />} />
              <Route path="usage" element={<Usage />} />
              <Route path="api-keys" element={<Keys />} />
              <Route path="maintenance" element={<Maintenance />} />
              <Route path="audit" element={<Audit />} />
              <Route path="settings" element={<WorkspaceSettings />} />
              <Route
                path="*"
                element={
                  <Empty
                    title="View not found"
                    text="Return to your workspace overview."
                  >
                    <Link className="button secondary" to={base}>
                      Overview
                    </Link>
                  </Empty>
                }
              />
            </Routes>
          </main>
          <footer className="app-footer">
            <span>Pulseflare workspace</span>
            <span>
              {demo
                ? "Sample data · no monitoring capacity used"
                : "Connected to your workspace API"}
            </span>
          </footer>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
function Overview() {
  const { demo, base } = useWorkspace();
  const monitors = useMonitors();
  const stats = useResource("/api/stats", {
    activeMonitors: 4,
    openIncidents: 1,
    uptime24h: 99.91 as number | null,
    avgLatency24h: 128,
  });
  return (
    <>
      <PageHeader
        title="Overview"
        description="A little peace of mind. Here’s how things are running."
        action={
          <Link className="button primary small" to={`${base}/monitors/new`}>
            <Plus size={16} /> New monitor
          </Link>
        }
      />
      <ResourceState
        loading={monitors.loading || stats.loading}
        error={monitors.error || stats.error}
        retry={() => {
          monitors.reload();
          stats.reload();
        }}
      >
        <div className="stats-grid">
          {[
            {
              label: "Overall uptime",
              number:
                stats.data.uptime24h === null
                  ? "Awaiting checks"
                  : stats.data.uptime24h.toFixed(2),
              unit: stats.data.uptime24h === null ? "" : "%",
              note: "Last 24 hours",
              icon: Activity,
            },
            {
              label: "Response time",
              number: stats.data.avgLatency24h,
              unit: "ms",
              note: "Average across monitors",
              icon: Clock,
            },
            {
              label: "Active monitors",
              number: stats.data.activeMonitors,
              unit: "/ 5",
              note: "Beta workspace limit",
              icon: Globe,
            },
            {
              label: "Open incidents",
              number: stats.data.openIncidents,
              unit: "",
              note: stats.data.openIncidents
                ? "Needs your attention"
                : "All clear",
              icon: AlertCircle,
            },
          ].map(({ label, number, unit, note, icon: Icon }) => (
            <div className="stat-card" key={label}>
              <div>
                <span>{label}</span>
                <Icon size={16} />
              </div>
              <strong>
                {number}
                <small>{unit}</small>
              </strong>
              <small>{note}</small>
            </div>
          ))}
        </div>
        {demo && (
          <Link className="incident-banner" to={`${base}/incidents/inc-search`}>
            <AlertCircle size={19} />
            <span>
              <strong>Search service is experiencing elevated latency</strong>
              <small>Investigating · response time above 1,500 ms</small>
            </span>
            <span className="text-link">
              View incident <ArrowRight size={14} />
            </span>
          </Link>
        )}
        <section className="data-panel">
          <div className="panel-heading">
            <h2>
              Monitors <span>{monitors.monitors.length}</span>
            </h2>
            <Link to={`${base}/monitors`} className="text-link">
              View all <ArrowUpRight size={13} />
            </Link>
          </div>
          {monitors.monitors.length ? (
            <MonitorTable
              monitors={monitors.monitors}
              base={base}
              sample={demo}
            />
          ) : (
            <Empty
              title="Your first monitor starts here"
              text="Add a public endpoint to begin collecting checks."
            >
              <Link className="button primary" to={`${base}/monitors/new`}>
                Create monitor
              </Link>
            </Empty>
          )}
        </section>
        {demo && (
          <div className="overview-bottom">
            <section className="data-panel">
              <div className="panel-heading">
                <h2>Response time</h2>
                <span className="panel-meta">Last 24 hours · sample</span>
              </div>
              <div className="panel-chart">
                <LatencyChart />
              </div>
            </section>
            <section className="data-panel activity-panel">
              <div className="panel-heading">
                <h2>Recent activity</h2>
                <Clock size={15} />
              </div>
              {demoTimeline
                .slice()
                .reverse()
                .slice(0, 3)
                .map((t) => (
                  <div className="activity-row" key={t.time}>
                    <span className="activity-icon">
                      {t.kind === "notification" ? (
                        <Bell size={14} />
                      ) : (
                        <Activity size={14} />
                      )}
                    </span>
                    <div>
                      <strong>{t.title}</strong>
                      <small>{t.text}</small>
                      <time>{t.time} UTC</time>
                    </div>
                  </div>
                ))}
            </section>
          </div>
        )}
      </ResourceState>
    </>
  );
}
function Monitors() {
  const { base, demo } = useWorkspace();
  const result = useMonitors();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = result.monitors.filter(
    (m) =>
      `${m.name} ${m.url} ${m.tag}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || m.type === filter || m.state === filter),
  );
  return (
    <>
      <PageHeader
        title="Monitors"
        description="Every endpoint and background job, in one place."
        action={
          <Link className="button primary small" to={`${base}/monitors/new`}>
            <Plus size={15} /> New monitor
          </Link>
        }
      />
      <div className="filter-bar">
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search monitors"
            placeholder="Search monitors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter monitors"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All monitors</option>
          <option value="http">HTTP endpoints</option>
          <option value="heartbeat">Heartbeats</option>
          <option value="degraded">Degraded</option>
        </select>
        <span>{filtered.length} monitors</span>
      </div>
      <ResourceState {...result} retry={result.reload}>
        <div className="data-panel">
          {filtered.length ? (
            <MonitorTable monitors={filtered} base={base} sample={demo} />
          ) : (
            <Empty
              title="No monitors match"
              text="Try another search or add your first monitor."
            />
          )}
        </div>
      </ResourceState>
    </>
  );
}
function MonitorDetail() {
  const { id } = useParams();
  const { base, demo } = useWorkspace();
  const sample = demoMonitors.find((m) => m.id === id);
  const result = useResource<ApiMonitor | null>(
    `/api/monitors/${id}`,
    apiDemoMonitors.find((m) => m.id === id) || null,
  );
  const checks = useResource<
    Array<{
      id: number;
      checked_at: string;
      status: number;
      latency_ms: number;
      ok: number;
    }>
  >(`/api/monitors/${id}/checks?limit=100`, []);
  const [window, setWindow] = useState("24h");
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (demo)
      return notice(
        "This workspace is read-only",
        "Pause and resume controls are available in a connected workspace. Demo monitoring does not consume capacity.",
      );
    setBusy(true);
    try {
      await api(
        `/api/monitors/${id}/${result.data?.active ? "pause" : "resume"}`,
        { method: "POST" },
      );
      result.reload();
    } catch (e) {
      notice("Could not update monitor", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const data = demo
    ? latencySeries(
        id === "search" ? 4 : 0,
        window === "1h"
          ? 12
          : window === "7d"
            ? 84
            : window === "30d"
              ? 120
              : 48,
        window === "1h"
          ? 1
          : window === "7d"
            ? 168
            : window === "30d"
              ? 720
              : 24,
      ).map((p) => ({
        ...p,
        latency: id === "search" ? p.latency * 10 : p.latency,
      }))
    : checks.data
        .slice()
        .reverse()
        .map((c) => ({
          time: new Date(c.checked_at).toLocaleTimeString(),
          latency: c.latency_ms,
        }));
  if (!demo) return <LiveMonitorDetail />;
  if (demo && sample?.type === "heartbeat")
    return (
      <>
        <Link className="back-link" to={`${base}/monitors`}>
          <ArrowLeft size={14} /> All monitors
        </Link>
        <PageHeader
          title={sample.name}
          description="A daily backup job. Sample heartbeat evidence, no live pings."
          action={<Badge state="up" />}
        />
        <div className="monitor-detail-metrics">
          <div>
            <small>Expected frequency</small>
            <strong>24 hours</strong>
          </div>
          <div>
            <small>Grace period</small>
            <strong>30 minutes</strong>
          </div>
          <div>
            <small>Last heartbeat</small>
            <strong>02:01 UTC</strong>
          </div>
        </div>
        <section className="data-panel status-builder">
          <HeartPulse size={28} className="text-good" />
          <h2>Right on time.</h2>
          <p>
            The backup job reported completion within its expected window.
            Heartbeat monitoring checks for missing pings, not HTTP response
            times.
          </p>
          <p className="form-hint">
            Sample heartbeat evidence. Create your own monitor in a signed-in
            workspace.
          </p>
          <button className="button secondary small" onClick={toggle}>
            Pause monitor
          </button>
        </section>
        <section className="data-panel">
          <div className="panel-heading">
            <h2>Recent heartbeats</h2>
            <span className="panel-meta">Sample runs</span>
          </div>
          {["Today", "Yesterday", "2 days ago", "3 days ago"].map((day, i) => (
            <div className="delivery-row" key={day}>
              <HeartPulse size={17} />
              <div>
                <strong>{day}</strong>
                <small>02:0{i + 1} UTC</small>
              </div>
              <Badge state="delivered" />
              <span>Within expected window</span>
            </div>
          ))}
        </section>
      </>
    );
  return (
    <>
      <Link className="back-link" to={`${base}/monitors`}>
        <ArrowLeft size={14} /> All monitors
      </Link>
      <ResourceState
        loading={result.loading}
        error={result.error}
        retry={result.reload}
      >
        {result.data ? (
          <>
            <PageHeader
              title={result.data.name}
              description={result.data.url}
              action={
                <div className="button-row">
                  <Badge state={result.data.lastState || "unknown"} />
                  <button
                    disabled={busy}
                    className="button secondary small"
                    onClick={toggle}
                  >
                    {busy
                      ? "Updating…"
                      : result.data.active
                        ? "Pause monitor"
                        : "Resume monitor"}
                  </button>
                </div>
              }
            />
            <div className="monitor-detail-metrics">
              <div>
                <small>Current state</small>
                <strong>{result.data.lastState || "Awaiting check"}</strong>
              </div>
              <div>
                <small>Check interval</small>
                <strong>
                  {result.data.type === "heartbeat"
                    ? "24 hours"
                    : `${result.data.intervalS / 60} minutes`}
                </strong>
              </div>
              <div>
                <small>Response time</small>
                <strong>
                  {demo
                    ? `${sample?.latency || 0} ms`
                    : checks.data[0]
                      ? `${checks.data[0].latency_ms} ms`
                      : "No checks yet"}
                </strong>
              </div>
            </div>
            <section className="data-panel">
              <div className="panel-heading">
                <h2>Response time</h2>
                {demo ? (
                  <div className="segmented">
                    {["1h", "24h", "7d", "30d"].map((t) => (
                      <button
                        key={t}
                        className={t === window ? "active" : ""}
                        onClick={() => setWindow(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="panel-meta">Latest 100 checks</span>
                )}
              </div>
              {data.length ? (
                <div className="panel-chart">
                  <LatencyChart data={data} />
                </div>
              ) : (
                <Empty
                  title="Waiting for check history"
                  text="Data will appear after the scheduler checks this endpoint."
                />
              )}
              {demo && (
                <p className="chart-caption">
                  Illustrative {window} data. This monitor is part of the sample
                  workspace.
                </p>
              )}
            </section>
            {demo && (
              <section className="data-panel uptime-detail">
                <div className="panel-heading">
                  <h2>Availability history</h2>
                  <strong className="text-good mono">{sample?.uptime}%</strong>
                </div>
                <UptimeBar degraded={id === "search"} />
                <div className="uptime-labels">
                  <small>45 days ago · sample</small>
                  <small>Today</small>
                </div>
              </section>
            )}
            <section className="data-panel">
              <div className="panel-heading">
                <h2>Recent checks</h2>
                <span className="panel-meta">
                  {demo ? "Sample checks" : "Live evidence"}
                </span>
              </div>
              <div className="simple-table">
                <div className="simple-row table-labels">
                  <span>Checked at</span>
                  <span>Result</span>
                  <span>Status</span>
                  <span>Response</span>
                </div>
                {(demo
                  ? Array.from({ length: 5 }, (_, i) => ({
                      id: i,
                      checked_at: `14:${String(40 - i * 5).padStart(2, "0")} UTC`,
                      status: 200,
                      ok: 1,
                      latency_ms: id === "search" ? 1842 - i * 37 : 124 + i * 9,
                    }))
                  : checks.data
                )
                  .slice(0, 15)
                  .map((c) => (
                    <div className="simple-row" key={c.id}>
                      <span className="mono">
                        {demo
                          ? c.checked_at
                          : new Date(c.checked_at).toLocaleString()}
                      </span>
                      <span className={c.ok ? "text-good" : "text-warning"}>
                        {c.ok ? "Successful" : "Failed"}
                      </span>
                      <span>{c.status || "No response"}</span>
                      <span className="mono">{c.latency_ms} ms</span>
                    </div>
                  ))}
              </div>
              {checks.error && <p className="form-error">{checks.error}</p>}
            </section>
          </>
        ) : (
          <Empty
            title="Monitor not found"
            text="This monitor is not part of the workspace."
          />
        )}
      </ResourceState>
    </>
  );
}
function NewMonitor() {
  const { demo, base } = useWorkspace();
  const notice = useNotice();
  const navigate = useNavigate();
  const [type, setType] = useState<"http" | "heartbeat">("http");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!demo) return <MonitorEditor />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo)
      return notice(
        "Ready for your own monitors?",
        "This demo is read-only. Sign up to create monitors in your own workspace. Your form has not been submitted.",
      );
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ monitor: { id: string } }>("/api/monitors", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          type,
          url: f.get("url"),
          intervalS: Number(f.get("intervalS")),
          method: "GET",
          timeoutMs: Number(f.get("timeoutMs")),
          public: f.get("public") === "on",
        }),
      });
      navigate(`${base}/monitors/${result.monitor.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to={`${base}/monitors`}>
        <ArrowLeft size={14} /> Monitors
      </Link>
      <PageHeader
        title="Let’s keep an eye on it."
        description="Start with a website, an API, or a background job."
      />
      <div className="monitor-templates">
        <button
          className={type === "http" ? "selected" : ""}
          onClick={() => setType("http")}
        >
          <Globe />
          <strong>Website or API</strong>
          <span>HTTP availability checks</span>
        </button>
        <button
          className={type === "heartbeat" ? "selected" : ""}
          onClick={() => setType("heartbeat")}
        >
          <HeartPulse />
          <strong>Background job</strong>
          <span>Heartbeat · v2 preview</span>
        </button>
      </div>
      <form className="data-panel monitor-form" onSubmit={submit}>
        <h2>{type === "http" ? "HTTP monitor" : "Heartbeat preview"}</h2>
        {type === "heartbeat" ? (
          <>
            <p>
              Heartbeats are available in your own workspace. This preview is
              read-only; explore the example backup monitor to see how they
              work.
            </p>
            <Link className="button secondary" to="/demo/monitors/backup">
              View sample heartbeat <ArrowRight size={15} />
            </Link>
          </>
        ) : (
          <>
            <label>
              Monitor name
              <input
                name="name"
                placeholder="Production API"
                required
                maxLength={120}
              />
            </label>
            <label>
              Endpoint URL
              <input
                name="url"
                type="url"
                placeholder="https://api.example.com/health"
                required
              />
            </label>
            <div className="form-columns">
              <label>
                Check interval
                <select name="intervalS">
                  <option value="300">Every 5 minutes</option>
                  <option value="600">Every 10 minutes</option>
                  <option value="1800">Every 30 minutes</option>
                </select>
              </label>
              <label>
                Timeout
                <select name="timeoutMs">
                  <option value="10000">10 seconds</option>
                  <option value="5000">5 seconds</option>
                  <option value="30000">30 seconds</option>
                </select>
              </label>
            </div>
            <p className="form-hint">
              <ShieldCheck size={14} /> Expected response: HTTP 200-299. Private
              by default.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Creating…"
                  : demo
                    ? "Preview creation"
                    : "Create monitor"}
                <ArrowRight size={15} />
              </button>
              <Link className="button ghost" to={`${base}/monitors`}>
                Cancel
              </Link>
            </div>
          </>
        )}
      </form>
    </>
  );
}
type ApiIncident = {
  id: string;
  monitor_id: string;
  monitor_name?: string;
  status: string;
  ai_summary?: string;
  ai_severity?: number;
  started_at: string;
  resolved_at?: string;
};
const apiDemoIncidents: ApiIncident[] = demoIncidents.map((i) => ({
  id: i.id,
  monitor_id: i.monitorId,
  monitor_name: i.name,
  status: i.status,
  ai_summary: i.summary,
  ai_severity: i.severity,
  started_at: i.started,
}));
function Incidents() {
  const { base } = useWorkspace();
  const result = useResource<ApiIncident[]>("/api/incidents", apiDemoIncidents);
  const [filter, setFilter] = useState("all");
  const items = result.data.filter(
    (i) =>
      filter === "all" ||
      (filter === "active" ? i.status !== "resolved" : i.status === "resolved"),
  );
  return (
    <>
      <PageHeader
        title="Incidents"
        description="The signal, the evidence, and the path back to healthy."
      />
      <div className="segmented filter-tabs">
        {["all", "active", "resolved"].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={filter === t ? "active" : ""}
          >
            {t}
          </button>
        ))}
      </div>
      <ResourceState {...result} retry={result.reload}>
        <div className="data-panel">
          {items.length ? (
            items.map((i) => (
              <Link
                className="incident-list-row"
                to={`${base}/incidents/${i.id}`}
                key={i.id}
              >
                <span
                  className={
                    i.status === "resolved" ? "text-good" : "text-warning"
                  }
                >
                  {i.status === "resolved" ? (
                    <Check size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                </span>
                <div>
                  <strong>{i.monitor_name || i.monitor_id}</strong>
                  <p>{i.ai_summary || "Awaiting incident summary."}</p>
                  <small>{i.started_at}</small>
                </div>
                <Badge state={i.status} />
                <ChevronRight size={16} />
              </Link>
            ))
          ) : (
            <Empty
              title="No incidents here"
              text="Incidents appear when monitoring detects a failure."
            />
          )}
        </div>
      </ResourceState>
    </>
  );
}
function IncidentDetail() {
  const { id } = useParams();
  const { base, demo } = useWorkspace();
  const sample = demoIncidents.find((i) => i.id === id);
  const result = useResource<{
    incident: ApiIncident | null;
    updates: Array<{
      id: string;
      message: string;
      created_at: string;
      status: string;
    }>;
    alerts: Array<{ id: number; channel: string; delivery_status: string }>;
  }>(`/api/incidents/${id}`, {
    incident: apiDemoIncidents.find((i) => i.id === id) || null,
    updates: [],
    alerts: [],
  });
  const notice = useNotice();
  const [tab, setTab] = useState("Timeline");
  function exportReport() {
    if (!sample) return;
    const url = URL.createObjectURL(
      new Blob([postmortemMarkdown(sample)], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `pulseflare-${sample.id}-sample.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo)
      return notice(
        "Sample timeline",
        "Updates in this workspace are read-only. Your message has not been sent or published.",
      );
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api(`/api/incidents/${id}/update`, {
        method: "POST",
        body: JSON.stringify({
          message: f.get("message"),
          status: f.get("status"),
          public: f.get("public") === "on",
        }),
      });
      form.reset();
      result.reload();
    } catch (err) {
      notice("Update failed", (err as Error).message);
    }
  }
  return (
    <>
      <Link className="back-link" to={`${base}/incidents`}>
        <ArrowLeft size={14} /> All incidents
      </Link>
      <ResourceState {...result} retry={result.reload}>
        {result.data.incident ? (
          <>
            <PageHeader
              title={
                sample?.name || result.data.incident.monitor_name || "Incident"
              }
              description={`Incident ${id} · ${sample?.started || result.data.incident.started_at}`}
              action={<Badge state={result.data.incident.status} />}
            />
            <div className="incident-summary-grid">
              <section className="data-panel incident-intelligence">
                <span className="insight-label">
                  <Sparkles size={16} />{" "}
                  {demo ? "Sample AI-assisted summary" : "Incident summary"}
                </span>
                <p>
                  {result.data.incident.ai_summary ||
                    "No summary is available yet."}
                </p>
                <div className="insight-foot">
                  <ShieldCheck size={13} /> Investigation hints, not a confirmed
                  root cause.
                </div>
              </section>
              <section className="data-panel incident-facts">
                <div>
                  <small>Severity</small>
                  <strong>S{result.data.incident.ai_severity || "-"}</strong>
                </div>
                <div>
                  <small>Duration</small>
                  <strong>
                    {sample?.duration ||
                      `${Math.max(0, Math.round((new Date(result.data.incident.resolved_at || Date.now()).getTime() - new Date(result.data.incident.started_at).getTime()) / 60000))} min`}
                  </strong>
                </div>
                <Link
                  to={`${base}/monitors/${result.data.incident.monitor_id}`}
                  className="text-link"
                >
                  Affected monitor <ArrowUpRight size={14} />
                </Link>
              </section>
            </div>
            <div className="detail-tabs">
              {["Timeline", "Ask AI", "Deliveries", "Postmortem"].map((t) => (
                <button
                  key={t}
                  className={t === tab ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "Ask AI" ? (
              <IncidentChat key={`${demo}:${id}`} incidentId={id || ""} demo={demo} />
            ) : tab === "Timeline" ? (
              <section className="data-panel timeline-panel">
                {demo
                  ? timelineFor(id || "").map((t, index) => (
                      <div className="timeline-event" key={t.time}>
                        <span className="timeline-node">
                          {index === 2 ? (
                            <Bell size={15} />
                          ) : (
                            <Activity size={15} />
                          )}
                        </span>
                        <time>{t.time} UTC</time>
                        <div>
                          <strong>{t.title}</strong>
                          <p>{t.text}</p>
                        </div>
                      </div>
                    ))
                  : [
                      {
                        id: "detected",
                        status: "Incident detected",
                        message:
                          "Confirmed monitoring evidence opened this incident.",
                        created_at: result.data.incident.started_at,
                      },
                      ...result.data.updates,
                      ...(result.data.incident.resolved_at
                        ? [
                            {
                              id: "recovered",
                              status: "Resolved",
                              message:
                                "The incident was resolved. See the recorded updates for details.",
                              created_at: result.data.incident.resolved_at,
                            },
                          ]
                        : []),
                    ].map((t) => (
                      <div className="timeline-event" key={t.id}>
                        <span className="timeline-node">
                          <Activity size={15} />
                        </span>
                        <time>{new Date(t.created_at).toLocaleString()}</time>
                        <div>
                          <strong>{t.status}</strong>
                          <p>{t.message}</p>
                        </div>
                      </div>
                    ))}
                <form className="incident-composer" onSubmit={update}>
                  <label>
                    Add an incident update
                    <textarea
                      name="message"
                      required
                      maxLength={4000}
                      placeholder="What have you found?"
                    />
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="public" /> Publish on the
                    public status page
                  </label>
                  <div className="button-row">
                    <select name="status" aria-label="Incident lifecycle">
                      {result.data.incident.status === "resolved" && (
                        <option value="resolved">Resolved</option>
                      )}
                      <option value="investigating">Investigating</option>
                      <option value="identified">Identified</option>
                      <option value="monitoring">Monitoring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <button className="button primary small">
                      Post update <ArrowRight size={14} />
                    </button>
                  </div>
                </form>
              </section>
            ) : tab === "Deliveries" ? (
              <section className="data-panel">
                <div className="panel-heading">
                  <h2>Notification deliveries</h2>
                </div>
                {demo
                  ? demoDeliveries.map((d) => (
                      <div className="delivery-row" key={d.channel}>
                        <Bell size={17} />
                        <div>
                          <strong>{d.channel}</strong>
                          <small>{d.destination}</small>
                        </div>
                        <Badge state={d.status.toLowerCase()} />
                        <span className="mono">HTTP {d.code}</span>
                        <span className="mono">{d.duration}</span>
                      </div>
                    ))
                  : result.data.alerts.map((d) => (
                      <div className="delivery-row" key={d.id}>
                        <Bell size={17} />
                        <strong>{d.channel}</strong>
                        <Badge state={d.delivery_status} />
                      </div>
                    ))}
              </section>
            ) : (
              <section className="data-panel report-panel">
                <div className="panel-heading">
                  <h2>Incident report</h2>
                  {demo && (
                    <button
                      className="button secondary small"
                      onClick={exportReport}
                    >
                      <Download size={14} /> Export Markdown
                    </button>
                  )}
                </div>
                <h3>What happened</h3>
                <p>{result.data.incident.ai_summary}</p>
                <h3>Root cause</h3>
                <p>
                  Not yet confirmed. Review the evidence and record the
                  confirmed cause before publishing.
                </p>
                <h3>Follow-up actions</h3>
                <ul>
                  <li>Review deployment changes and origin logs.</li>
                  <li>Validate recovery with subsequent checks.</li>
                  <li>Document preventive actions with the team.</li>
                </ul>
                {!demo && <p>Editable reports are coming soon.</p>}
              </section>
            )}
          </>
        ) : (
          <Empty
            title="Incident not found"
            text="Choose an incident from this workspace."
          />
        )}
      </ResourceState>
    </>
  );
}
