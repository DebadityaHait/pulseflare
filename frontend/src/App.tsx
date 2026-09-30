import { lazy, Suspense, useEffect } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { MotionConfig } from "motion/react";
import { NoticeProvider } from "./components/ui";
const Marketing = lazy(() => import("./Marketing"));
const Features = lazy(() =>
  import("./Marketing").then((m) => ({ default: m.FeaturesPage })),
);
const Pricing = lazy(() =>
  import("./Marketing").then((m) => ({ default: m.PricingPage })),
);
const Architecture = lazy(() =>
  import("./Marketing").then((m) => ({ default: m.ArchitecturePage })),
);
const Docs = lazy(() =>
  import("./Marketing").then((m) => ({ default: m.DocsPage })),
);
const Workspace = lazy(() => import("./Workspace"));
const Auth = lazy(() => import("./auth"));
const Status = lazy(() => import("./Status"));
function RouteEffects() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const title = pathname.startsWith("/demo")
      ? "Interactive demo"
      : pathname.startsWith("/dashboard")
        ? "Workspace"
        : pathname.startsWith("/status")
          ? "System status"
          : pathname === "/"
            ? "Uptime, in full view"
            : pathname
                .slice(1)
                .split("/")[0]
                .replace(/^./, (c) => c.toUpperCase());
    document.title = `${title} | Pulseflare`;
    if (!hash) window.scrollTo({ top: 0, behavior: "instant" });
    // Remove the retired prototype credential. Live authentication uses Clerk memory-only tokens.
    try {
      localStorage.removeItem("pulseflare_admin_token");
    } catch {
      /* Optional cleanup only. */
    }
  }, [pathname, hash]);
  return null;
}
function LegacyMonitor() {
  const { id } = useParams();
  return <Navigate replace to={`/dashboard/monitors/${id || ""}`} />;
}
function LegacyIncident() {
  const { id } = useParams();
  return <Navigate replace to={`/dashboard/incidents/${id || ""}`} />;
}
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <NoticeProvider>
        <RouteEffects />
        <a className="skip-link" href="#app-main">
          Skip to content
        </a>
        <div id="app-main">
          <Suspense
            fallback={
              <div className="page-loading" role="status">
                Loading Pulseflare…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Marketing />} />
              <Route path="/features" element={<Features />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/architecture" element={<Architecture />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/demo/*" element={<Workspace />} />
              <Route path="/dashboard/*" element={<Auth mode="workspace" />} />
              <Route path="/login/*" element={<Auth mode="login" />} />
              <Route path="/signup/*" element={<Auth mode="signup" />} />
              <Route path="/status" element={<Status />} />
              <Route path="/status/:slug" element={<Status />} />
              <Route
                path="/monitors/new"
                element={<Navigate replace to="/dashboard/monitors/new" />}
              />
              <Route path="/monitors/:id" element={<LegacyMonitor />} />
              <Route path="/incidents/:id" element={<LegacyIncident />} />
              <Route
                path="/settings"
                element={<Navigate replace to="/dashboard/settings" />}
              />
              <Route
                path="*"
                element={
                  <div className="not-found">
                    <h1>Nothing to monitor here.</h1>
                    <p>This page doesn’t exist.</p>
                    <Link to="/" className="button primary">
                      Back to Pulseflare
                    </Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </div>
      </NoticeProvider>
    </MotionConfig>
  );
}
