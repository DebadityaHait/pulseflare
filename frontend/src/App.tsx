import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, Database, Gauge, Moon, Plus, Settings, Shield, Sparkles, Sun, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getAdminToken, setAdminToken } from "./api/client";

type PublicStatus = {
  page: { title: string; description: string; updatedAt: string };
  overallState: string;
  monitors: Array<{ id: string; name: string; state: string; status: number; latencyMs: number; uptime24h: number; checkedAt: string | null }>;
  activeIncidents: Array<{ id: string; monitor_id: string; monitor_name: string; started_at: string; ai_summary?: string; ai_severity?: number }>;
};
type Monitor = { id: string; name: string; url: string; method: string; active: boolean; public: boolean; timeoutMs: number; latest?: { state: string; latencyMs: number; status: number; checkedAt: string } };
type Incident = { id: string; monitor_id: string; monitor_name?: string; status: string; started_at: string; resolved_at?: string; ai_summary?: string; ai_severity?: number };
type Check = { id: number; status: number; ok: number; latency_ms: number; checked_at: string };

function useQuery<T>(path: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api<T>(path);
        if (active) {
          setData(result);
          setError("");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const timer = refreshMs ? window.setInterval(load, refreshMs) : undefined;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [path, refreshMs]);
  return { data, error, loading };
}

function Badge({ state }: { state: string }) {
  return <span className={`badge ${state}`}>{state.replace("_", " ")}</span>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty"><Sparkles size={18} /><b>{title}</b><span>{text}</span></div>;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem("pulseflare_theme") || "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pulseflare_theme", theme);
  }, [theme]);
  const dark = theme === "dark";
  return (
    <button className="iconButton" title={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="topbar">
          <Link to="/dashboard" className="brand"><span className="brandMark"><Shield size={20} /></span><span>Pulseflare</span></Link>
          <ThemeToggle />
        </div>
        <nav>
          <NavLink to="/status"><Activity size={18} /> Status</NavLink>
          <NavLink to="/dashboard"><Gauge size={18} /> Dashboard</NavLink>
          <NavLink to="/monitors/new"><Plus size={18} /> New Monitor</NavLink>
          <NavLink to="/settings"><Settings size={18} /> Settings</NavLink>
        </nav>
      </aside>
      <main><Routes>
        <Route path="/" element={<StatusPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/monitors/new" element={<NewMonitor />} />
        <Route path="/monitors/:id" element={<MonitorDetail />} />
        <Route path="/incidents/:id" element={<IncidentDetail />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes></main>
    </div>
  );
}

function StatusPage() {
  const { data, loading, error } = useQuery<PublicStatus>("/api/status", 30000);
  if (loading) return <Panel title="Status">Loading status...</Panel>;
  if (error) return <Panel title="Status" tone="bad">{error}</Panel>;
  return (
    <section>
      <header className="hero">
        <div>
          <span className="eyebrow"><Activity size={15} /> Public status</span>
          <h1>{data?.page.title}</h1>
          <p>{data?.page.description}</p>
        </div>
        <div className="heroStatus">
          <Badge state={data?.overallState ?? "unknown"} />
          <small>Updated {data?.page.updatedAt ? new Date(data.page.updatedAt).toLocaleString() : "just now"}</small>
        </div>
      </header>
      <div className="grid cards">
        {data?.monitors.map((monitor) => (
          <article className="card" key={monitor.id}>
            <div className="cardSignal" />
            <div className="row"><h3>{monitor.name}</h3><Badge state={monitor.state} /></div>
            <div className="metrics">
              <span>Status <b>{monitor.status || "n/a"}</b></span>
              <span>Latency <b>{monitor.latencyMs}ms</b></span>
              <span>24h uptime <b>{monitor.uptime24h}%</b></span>
            </div>
            <small className="muted"><Clock3 size={14} /> {monitor.checkedAt ? `Last checked ${new Date(monitor.checkedAt).toLocaleString()}` : "Waiting for first check"}</small>
          </article>
        ))}
      </div>
      {data?.monitors.length === 0 && <EmptyState title="No public monitors" text="Public monitors will appear here after they are created." />}
      {(data?.activeIncidents.length ?? 0) > 0 && (
        <>
          <div className="sectionTitle"><h2>AI Incident Intelligence</h2><span>Generated by Workers AI</span></div>
          <div className="aiStack">
            {data?.activeIncidents.map((incident) => (
              <article className="aiInsight" key={incident.id}>
                <div className="row">
                  <span className="eyebrow"><Sparkles size={15} /> AI summary</span>
                  <Badge state={incident.ai_severity ? `severity ${incident.ai_severity}` : "pending"} />
                </div>
                <h3>{incident.monitor_name}</h3>
                <p>{incident.ai_summary ?? "AI summary is pending for this incident."}</p>
                <small className="muted"><Clock3 size={14} /> Started {new Date(incident.started_at).toLocaleString()}</small>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TokenBox() {
  const [token, setToken] = useState(getAdminToken());
  return <div className="token"><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Admin token" /><button onClick={() => setAdminToken(token)}>Save token</button></div>;
}

function Dashboard() {
  const monitors = useQuery<Monitor[]>("/api/monitors", 30000);
  const incidents = useQuery<Incident[]>("/api/incidents", 30000);
  const stats = useQuery<{ activeMonitors: number; openIncidents: number; uptime24h: number; avgLatency24h: number; lastCheckerRun: string | null }>("/api/stats", 30000);
  return (
    <section>
      <header className="hero compact">
        <div>
          <span className="eyebrow"><Gauge size={15} /> Command center</span>
          <h1>Operations Dashboard</h1>
          <p>Monitor health, incident intelligence, severity, and alert routing from one focused workspace.</p>
        </div>
        <TokenBox />
      </header>
      <div className="stats">
        <Stat icon={<Database />} label="Active monitors" value={stats.data?.activeMonitors ?? "-"} />
        <Stat icon={<AlertTriangle />} label="Open incidents" value={stats.data?.openIncidents ?? "-"} />
        <Stat icon={<CheckCircle2 />} label="24h uptime" value={`${stats.data?.uptime24h ?? "-"}%`} />
        <Stat icon={<Activity />} label="Avg latency" value={`${stats.data?.avgLatency24h ?? "-"}ms`} />
      </div>
      {monitors.error && <Panel title="Admin API" tone="bad">{monitors.error}</Panel>}
      <div className="grid cards">
        {monitors.data?.map((monitor) => <Link className="card linkCard" to={`/monitors/${monitor.id}`} key={monitor.id}>
          <div className="cardSignal" />
          <div className="row"><h3>{monitor.name}</h3><Badge state={monitor.latest?.state ?? (monitor.active ? "unknown" : "disabled")} /></div>
          <p className="urlText">{monitor.url}</p>
          <div className="metrics"><span>Method <b>{monitor.method}</b></span><span>Timeout <b>{monitor.timeoutMs}ms</b></span></div>
        </Link>)}
      </div>
      {monitors.data?.length === 0 && <EmptyState title="No monitors yet" text="Create a monitor to start collecting uptime checks." />}
      <div className="sectionTitle"><h2>Recent Incidents</h2><Link to="/monitors/new">Add monitor</Link></div>
      <div className="list">
        {incidents.data?.map((incident) => <Link to={`/incidents/${incident.id}`} className="listItem" key={incident.id}>
          <AlertTriangle size={18} /><span><b>{incident.monitor_name ?? incident.monitor_id}</b><small>{incident.ai_summary ?? "AI summary pending"}</small></span><Badge state={incident.status} /><b>{incident.ai_severity ? `S${incident.ai_severity}` : "pending"}</b>
        </Link>)}
      </div>
      {incidents.data?.length === 0 && <EmptyState title="No incidents" text="Incidents and AI summaries will appear here after a failure is detected." />}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="stat"><span className="statIcon">{icon}</span><span>{label}</span><b>{value}</b></div>;
}

function NewMonitor() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const monitor = await api<Monitor>("/api/monitors", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          url: form.get("url"),
          method: form.get("method"),
          timeoutMs: Number(form.get("timeoutMs")),
          public: form.get("public") === "on",
          notifyDiscordWebhook: String(form.get("discord") || "") || undefined,
          notifyTelegramChatId: String(form.get("telegram") || "") || undefined,
          notifyGenericWebhook: String(form.get("webhook") || "") || undefined
        })
      });
      navigate(`/monitors/${monitor.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create monitor");
    }
  }
  return <Panel title="Create Monitor"><form className="form" onSubmit={submit}>
    {error && <p className="error">{error}</p>}
    <label>Name<input name="name" required maxLength={120} /></label>
    <label>URL<input name="url" required placeholder="https://example.com/health" /></label>
    <label>Method<select name="method" defaultValue="GET"><option>GET</option><option>HEAD</option><option>POST</option></select></label>
    <label>Timeout<input name="timeoutMs" type="number" defaultValue={10000} min={500} max={30000} /></label>
    <label className="check"><input name="public" type="checkbox" defaultChecked /> Public status page</label>
    <label>Discord webhook<input name="discord" /></label>
    <label>Telegram chat ID<input name="telegram" /></label>
    <label>Generic webhook<input name="webhook" /></label>
    <button>Create monitor</button>
  </form></Panel>;
}

function MonitorDetail() {
  const { id } = useParams();
  const monitor = useQuery<Monitor>(`/api/monitors/${id}`, 30000);
  const checks = useQuery<Check[]>(`/api/monitors/${id}/checks?limit=60`, 30000);
  const chartData = useMemo(() => [...(checks.data ?? [])].reverse().map((check) => ({ time: new Date(check.checked_at).toLocaleTimeString(), latency: check.latency_ms, status: check.status })), [checks.data]);
  return <section>
    <header className="hero compact"><div><span className="eyebrow"><Activity size={15} /> Monitor detail</span><h1>{monitor.data?.name ?? "Monitor"}</h1><p>{monitor.data?.url}</p></div><Badge state={monitor.data?.latest?.state ?? "unknown"} /></header>
    <Panel title="Latency"><div className="chart"><ResponsiveContainer><LineChart data={chartData}><XAxis dataKey="time" hide /><YAxis /><Tooltip /><Line type="monotone" dataKey="latency" stroke="#1677ff" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></Panel>
    <Panel title="Recent Checks"><div className="list">{checks.data?.slice(0, 20).map((check) => <div className="listItem" key={check.id}>{check.ok ? <CheckCircle2 /> : <WifiOff />}<span>{new Date(check.checked_at).toLocaleString()}</span><b>{check.status}</b><b>{check.latency_ms}ms</b></div>)}</div></Panel>
  </section>;
}

function IncidentDetail() {
  const { id } = useParams();
  const detail = useQuery<{ incident: Incident & { url: string }; alerts: unknown[]; checks: Check[] }>(`/api/incidents/${id}`, 30000);
  return <section>
    <header className="hero compact"><div><span className="eyebrow"><AlertTriangle size={15} /> Incident intelligence</span><h1>{detail.data?.incident.monitor_name}</h1><p>{detail.data?.incident.url}</p></div><Badge state={detail.data?.incident.status ?? "unknown"} /></header>
    <Panel title="AI Summary"><p>{detail.data?.incident.ai_summary ?? "Summary pending."}</p><b>{detail.data?.incident.ai_severity ? `Severity ${detail.data.incident.ai_severity}` : "Severity pending"}</b></Panel>
    <Panel title="Alert Log"><pre>{JSON.stringify(detail.data?.alerts ?? [], null, 2)}</pre></Panel>
  </section>;
}

function SettingsPage() {
  const [message, setMessage] = useState("");
  async function archive() {
    const result = await api<{ key: string; rows: number }>("/api/archive", { method: "POST", body: "{}" });
    setMessage(`Archived ${result.rows} rows to ${result.key}`);
  }
  async function testAlert() {
    await api("/api/test-alert", { method: "POST", body: "{}" });
    setMessage("Test alert queued.");
  }
  return <Panel title="Settings"><TokenBox /><div className="actions"><button onClick={testAlert}><Bell size={16} /> Send test alert</button><button onClick={archive}><Database size={16} /> Archive old checks</button></div>{message && <p className="success">{message}</p>}</Panel>;
}

function Panel({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "bad" }) {
  return <section className={`panel ${tone ?? ""}`}><h2>{title}</h2>{children}</section>;
}

export default function App() {
  return <Layout />;
}
