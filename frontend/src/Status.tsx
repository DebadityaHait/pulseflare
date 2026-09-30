import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  Globe,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "./api/client";
import { demoMonitors } from "./data/demo";
import { UptimeBar } from "./components/telemetry";
import { Brand, ThemeToggle, useNotice } from "./components/ui";
type Snapshot = {
  page: { title: string; description: string };
  overallState: string;
  monitors: Array<{
    id: string;
    name: string;
    state: string;
    uptime24h: number | null;
    latencyMs: number;
  }>;
  activeIncidents: Array<{
    id: string;
    monitor_name: string;
    ai_summary?: string;
  }>;
};
export default function Status() {
  const { slug = "legacy" } = useParams();
  const demo = slug === "demo";
  const notice = useNotice();
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setSnapshot(null);
    if (demo) {
      setSnapshot({
        page: {
          title: "Orbit system status",
          description: "Current health and recent updates for Orbit services.",
        },
        overallState: "degraded",
        monitors: demoMonitors.map((m) => ({
          id: m.id,
          name: m.name,
          state: m.state,
          uptime24h: m.uptime,
          latencyMs: m.latency,
        })),
        activeIncidents: [
          {
            id: "inc-search",
            monitor_name: "Search service",
            ai_summary:
              "We are investigating elevated response times. The service remains available.",
          },
        ],
      });
    } else {
      api<Snapshot>(`/api/status/${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      })
        .then(setSnapshot)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }
    return () => controller.abort();
  }, [slug, demo]);
  return (
    <div className="public-status">
      <header>
        <Brand />
        <ThemeToggle />
      </header>
      {demo && (
        <div className="status-demo-note">
          Sample public status page. Fictional services and history.{" "}
          <Link to="/demo">
            Back to demo <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      <main>
        {error ? (
          <div className="error-state">
            <AlertCircle />
            <h1>Status unavailable</h1>
            <p>{error}</p>
            <Link className="button secondary" to="/">
              Return home
            </Link>
          </div>
        ) : !snapshot ? (
          <div className="page-loading" role="status">
            Loading status…
          </div>
        ) : (
          <>
            <div className="public-status-heading">
              <div>
                <h1>{snapshot.page.title}</h1>
                <p>{snapshot.page.description}</p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  notice(
                    "Status subscriptions are coming soon",
                    "Browser push subscriptions are planned for the public beta. No subscription has been created.",
                  )
                }
              >
                <Bell size={14} /> Subscribe
              </button>
            </div>
            <div className={`public-overall ${snapshot.overallState}`}>
              {snapshot.overallState === "operational" ? (
                <Check size={23} />
              ) : (
                <AlertCircle size={23} />
              )}
              <div>
                <strong>
                  {snapshot.overallState === "operational"
                    ? "All systems operational"
                    : snapshot.overallState
                        .replaceAll("_", " ")
                        .replace(/^./, (c) => c.toUpperCase())}
                </strong>
                <small>
                  {demo ? "Sample status snapshot" : "Latest published status"}
                </small>
              </div>
            </div>
            <div className="status-services">
              {snapshot.monitors.map((m, i) => (
                <section className="status-service" key={m.id}>
                  <div>
                    <h3>
                      <Globe size={16} />
                      {m.name}
                    </h3>
                    <span
                      className={
                        m.state === "up" ? "text-good" : "text-warning"
                      }
                    >
                      {m.state === "up"
                        ? "Operational"
                        : m.state.replaceAll("_", " ")}
                    </span>
                  </div>
                  {demo && (
                    <UptimeBar seed={i} degraded={m.state === "degraded"} />
                  )}
                  <div className="uptime-labels">
                    <small>
                      {demo
                        ? "45-day illustrative history"
                        : "24-hour availability"}
                    </small>
                    <small>
                      {m.uptime24h === null
                        ? "Awaiting checks"
                        : `${m.uptime24h.toFixed(2)}% uptime`}
                    </small>
                  </div>
                </section>
              ))}
            </div>
            <section className="status-incidents">
              <h2>Incident updates</h2>
              {snapshot.activeIncidents.length ? (
                snapshot.activeIncidents.map((i) => (
                  <div key={i.id} className="data-panel">
                    <strong>{i.monitor_name}</strong>
                    <p>
                      {i.ai_summary || "An incident is being investigated."}
                    </p>
                    {demo && (
                      <Link
                        className="text-link"
                        to={`/demo/incidents/${i.id}`}
                      >
                        View sample timeline <ArrowRightIcon />
                      </Link>
                    )}
                  </div>
                ))
              ) : (
                <p>No active incidents.</p>
              )}
            </section>
          </>
        )}
      </main>
      <footer>
        Powered by <Link to="/">pulseflare.</Link>
      </footer>
    </div>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={14} />;
}
