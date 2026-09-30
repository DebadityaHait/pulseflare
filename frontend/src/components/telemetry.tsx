import { ArrowUpRight, Check, Clock, Globe, HeartPulse } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { demoMonitors, latencySeries, type MonitorView } from "../data/demo";
import { Badge } from "./ui";

export function UptimeBar({
  seed = 0,
  degraded = false,
}: {
  seed?: number;
  degraded?: boolean;
}) {
  return (
    <div
      className="uptime-bar"
      aria-label={
        degraded
          ? "Sample uptime history with a period of degradation"
          : "Sample uptime history, mostly operational"
      }
    >
      {Array.from({ length: 45 }, (_, i) => (
        <span
          key={i}
          title={`Sample day ${i + 1}: ${degraded && i > 39 ? "degraded" : "operational"}`}
          className={
            degraded && i > 39
              ? "warning"
              : (i + seed) % 19 === 0
                ? "muted-bar"
                : ""
          }
        />
      ))}
    </div>
  );
}
export function MonitorTable({
  monitors = demoMonitors,
  base = "/demo",
  preview = false,
  sample = true,
}: {
  monitors?: Array<
    MonitorView & { uptimeKnown?: boolean; latencyKnown?: boolean }
  >;
  base?: string;
  preview?: boolean;
  sample?: boolean;
}) {
  return (
    <div className={`monitor-table ${preview ? "is-preview" : ""}`}>
      <div className="table-labels">
        <span>Monitor</span>
        <span>{sample ? "Last 45 days · sample" : "Current state"}</span>
        <span>Uptime</span>
        <span>Response</span>
        <span />
      </div>
      {monitors.map((m, i) => (
        <Link
          className="monitor-row"
          to={`${base}/monitors/${m.id}`}
          key={m.id}
        >
          <div className="monitor-name">
            <span className={`monitor-icon ${m.state}`}>
              {m.type === "heartbeat" ? (
                <HeartPulse size={17} />
              ) : (
                <Globe size={17} />
              )}
            </span>
            <span>
              <strong>{m.name}</strong>
              <small>
                {m.type === "heartbeat"
                  ? "HEARTBEAT"
                  : m.url.replace("https://", "")}
              </small>
            </span>
          </div>
          {sample ? (
            <UptimeBar seed={i} degraded={m.state === "degraded"} />
          ) : (
            <Badge state={m.state} />
          )}
          <span className="mono">
            {sample || m.uptimeKnown ? `${m.uptime.toFixed(2)}%` : "—"}
          </span>
          <span
            className={`mono ${m.state === "degraded" ? "text-warning" : ""}`}
          >
            {m.type === "heartbeat"
              ? m.state === "up"
                ? "On time"
                : "Awaiting"
              : m.latencyKnown || m.latency
                ? `${m.latency} ms`
                : "—"}
          </span>
          <ArrowUpRight size={14} className="row-arrow" />
        </Link>
      ))}
    </div>
  );
}
const DeferredChart = lazy(() => import("./LatencyChart"));
export function LatencyChart({
  data = latencySeries(),
  compact = false,
  deployments = [],
}: {
  data?: Array<{ time: string; latency: number; timestamp?: number }>;
  compact?: boolean;
  deployments?: Array<{ id: string; version: string; createdAt: string }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`chart-mount ${compact ? "compact-chart-mount" : ""}`}
    >
      {visible && (
        <Suspense
          fallback={
            <div className="chart-loading" role="status">
              Loading chart…
            </div>
          }
        >
          <DeferredChart
            data={data}
            compact={compact}
            deployments={deployments}
          />
        </Suspense>
      )}
    </div>
  );
}
export function ProductPreview() {
  const [view, setView] = useState("Monitors");
  return (
    <div className="product-preview">
      <div className="preview-chrome">
        <span className="preview-workspace">
          <span className="workspace-avatar">o</span> Orbit workspace{" "}
          <span className="preview-sample">Sample data</span>
        </span>
        <span className="preview-address">app.pulseflare / overview</span>
        <Link to="/demo" aria-label="Open full demo">
          <ArrowUpRight size={17} />
        </Link>
      </div>
      <div className="preview-body">
        <aside className="preview-nav">
          <span className="preview-nav-title">WORKSPACE</span>
          {["Monitors", "Incidents", "Status page"].map((item) => (
            <button
              className={view === item ? "selected" : ""}
              onClick={() => setView(item)}
              key={item}
            >
              {item}
            </button>
          ))}
          <span className="preview-side-bottom">
            <Check size={13} /> All checks running
          </span>
        </aside>
        <div className="preview-content">
          <div className="preview-heading">
            <div>
              <h2>
                {view === "Monitors"
                  ? "A little peace of mind."
                  : view === "Incidents"
                    ? "The full story, in one place."
                    : "Keep everyone in the loop."}
              </h2>
              <p>
                {view === "Monitors"
                  ? "Your services, at a glance."
                  : "Explore a sample workspace. No sign-up needed."}
              </p>
            </div>
            <Badge
              state={
                view === "Incidents"
                  ? "investigating"
                  : view === "Monitors"
                    ? "degraded"
                    : "operational"
              }
            />
          </div>
          {view === "Monitors" ? (
            <>
              <div className="preview-metrics">
                <div>
                  <small>Overall uptime</small>
                  <strong>
                    99.91<span>%</span>
                  </strong>
                </div>
                <div>
                  <small>Avg. response time</small>
                  <strong>
                    128<span>ms</span>
                  </strong>
                </div>
                <div>
                  <small>Active monitors</small>
                  <strong>
                    4<span>/ 5</span>
                  </strong>
                </div>
              </div>
              <MonitorTable preview />
            </>
          ) : view === "Incidents" ? (
            <div className="preview-incident">
              <Badge state="investigating" />
              <h3>Elevated latency on Search</h3>
              <p>
                Two consecutive responses exceeded the 1,500 ms threshold. Your
                team has the context to investigate.
              </p>
              <div className="mini-timeline">
                <span>
                  <Clock size={14} /> 14:32 · Threshold exceeded
                </span>
                <span>
                  <Check size={14} /> 14:37 · Engineering notified
                </span>
              </div>
              <Link to="/demo/incidents/inc-search" className="text-link">
                Open incident timeline <ArrowUpRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="preview-status">
              <span className="status-orb">
                <Check size={26} />
              </span>
              <h3>Orbit system status</h3>
              <p>Clear updates. Fewer “is it just me?” messages.</p>
              <UptimeBar />
              <Link className="text-link" to="/status/demo">
                Explore the status page <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
