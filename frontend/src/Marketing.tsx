import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Cloud,
  Code2,
  ExternalLink,
  GitBranch,
  Globe,
  HeartPulse,
  Layers,
  LockKeyhole,
  Menu,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Brand, CopyButton, ThemeToggle, useNotice } from "./components/ui";
import {
  LatencyChart,
  ProductPreview,
  UptimeBar,
} from "./components/telemetry";

const reveal: Variants = {
  hidden: { opacity: 0, y: 26 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};
function Reveal({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, amount: 0.12 }}
      variants={reveal}
    >
      {children}
    </motion.div>
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location]);
  return (
    <header className="marketing-nav">
      <div className="nav-inner">
        <Brand />
        <nav
          className={open ? "marketing-links open" : "marketing-links"}
          aria-label="Main navigation"
        >
          <Link to="/features">Product</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/architecture">Architecture</Link>
          <Link to="/docs">
            Docs <ArrowUpRight size={12} />
          </Link>
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <Link className="login-link" to="/login">
            Log in
          </Link>
          <Link className="button primary small" to="/demo">
            Explore demo <ArrowUpRight size={14} />
          </Link>
          <button
            className="icon-btn mobile-menu"
            aria-expanded={open}
            aria-label="Toggle navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="hero-section">
      <div className="hero-art" aria-hidden="true">
        <motion.img
          src="/images/pulse-sculpture.webp"
          srcSet="/images/pulse-sculpture-small.webp 700w, /images/pulse-sculpture.webp 1400w"
          sizes="(max-width: 767px) 100vw, 78vw"
          alt=""
          width="1536"
          height="1024"
          fetchPriority="high"
          initial={reduce ? false : { opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.8, ease: "easeOut" }}
        />
        <div className="hero-art-fade" />
      </div>
      <div className="container hero-content">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75 }}
        >
          <span className="hero-eyebrow">
            <Radio size={14} /> Uptime monitoring, at the edge
          </span>
          <h1>
            Your uptime.
            <br />
            <span>In full view.</span>
          </h1>
          <p>
            Monitor websites, APIs, and background jobs.
            <br className="desktop-only" /> Know what broke. Keep everyone in
            the loop.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/demo">
              Explore the live demo <ArrowUpRight size={17} />
            </Link>
            <Link className="button ghost" to="/signup">
              Start monitoring <ArrowRight size={16} />
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  const [signal, setSignal] = useState<"healthy" | "incident" | "recovered">(
    "healthy",
  );
  return (
    <section id="features" className="container section features-section">
      <Reveal>
        <h2>
          Less checking tabs.
          <br />
          <span className="muted">More shipping things.</span>
        </h2>
        <p className="section-description">
          A clear view of your services, from the first missed heartbeat to the
          final incident update.
        </p>
      </Reveal>
      <div className="feature-grid">
        <Reveal className="feature-card feature-monitor">
          <div className="feature-copy">
            <Globe className="feature-icon" />
            <h3>
              The important things.
              <br />
              Always in sight.
            </h3>
            <p>
              HTTP checks, response times, and assertions. Bring your websites
              and APIs into one focused workspace.
            </p>
            <Link to="/demo/monitors" className="text-link">
              Meet your monitors <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="feature-chart">
            <div className="mini-chart-header">
              <span>Public API</span>
              <span className="mono">
                128 ms <span className="text-good">↓ 12%</span>
              </span>
            </div>
            <LatencyChart compact />
            <span className="sample-caption">Sample response-time data</span>
          </div>
        </Reveal>
        <Reveal className="feature-card feature-heartbeat">
          <HeartPulse className="feature-icon" />
          <h3>Silence is a signal.</h3>
          <p>
            Give backups and scheduled jobs a heartbeat. See when an expected
            run goes missing.
          </p>
          <div className="heartbeat-visual" aria-hidden="true">
            <div className="heartbeat-track">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <HeartPulse size={44} strokeWidth={1.1} />
          </div>
          <code className="heartbeat-command">
            curl -fsS "$PULSEFLARE_HEARTBEAT"
          </code>
          <span className="feature-footnote">
            Heartbeat monitoring · v2 preview
          </span>
        </Reveal>
        <Reveal className="feature-card feature-signal">
          <div>
            <Bell className="feature-icon" />
            <h3>A signal. Not a siren.</h3>
            <p>
              Follow the lifecycle of an incident. Try a sample event below.
            </p>
          </div>
          <div className={`signal-card signal-${signal}`}>
            <span className="signal-indicator">
              <Activity size={18} />
            </span>
            <div>
              <strong>
                {signal === "healthy"
                  ? "All systems operational"
                  : signal === "incident"
                    ? "Search latency elevated"
                    : "Search service recovered"}
              </strong>
              <small>
                {signal === "healthy"
                  ? "Your services are looking good."
                  : signal === "incident"
                    ? "Engineering has been notified."
                    : "Incident resolved. Back to building."}
              </small>
            </div>
          </div>
          <div className="segmented" aria-label="Sample incident state">
            {(["healthy", "incident", "recovered"] as const).map((s) => (
              <button
                aria-pressed={signal === s}
                className={signal === s ? "active" : ""}
                onClick={() => setSignal(s)}
                key={s}
              >
                {s}
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal className="feature-card feature-ai">
          <Sparkles className="feature-icon" />
          <h3>Context when it counts.</h3>
          <p>
            Turn check history into a useful starting point. AI-assisted
            summaries help you investigate; the evidence stays in view.
          </p>
          <div className="ai-excerpt">
            <span>
              <Sparkles size={13} /> Sample incident insight
            </span>
            <p>
              “Latency increased after the latest deployment. Review the search
              index and connection pool before rolling back.”
            </p>
            <Link to="/demo/incidents/inc-search" className="text-link">
              Follow the evidence <ArrowRight size={14} />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function StatusSection() {
  return (
    <section className="container section status-feature">
      <Reveal className="status-feature-copy">
        <span className="section-kicker">
          A little transparency goes a long way
        </span>
        <h2>
          Keep your users
          <br />
          in the know.
        </h2>
        <p>
          A status page that’s as thoughtful as your product. Share current
          health and incident updates in one place.
        </p>
        <Link className="button secondary" to="/status/demo">
          Visit a sample status page <ArrowUpRight size={16} />
        </Link>
      </Reveal>
      <Reveal className="status-page-art">
        <div className="status-browser">
          <div className="status-browser-address">
            <LockKeyhole size={12} /> status.orbit.example.com{" "}
            <ExternalLink size={12} />
          </div>
          <div className="status-browser-body">
            <span className="orbit-wordmark">◉ orbit</span>
            <div className="status-summary">
              <span className="status-check">
                <Check size={20} />
              </span>
              <div>
                <strong>All systems operational</strong>
                <small>Sample status page</small>
              </div>
            </div>
            {["Website", "Public API", "Background jobs"].map((item, i) => (
              <div className="status-mini-service" key={item}>
                <div>
                  <strong>{item}</strong>
                  <small>Operational</small>
                </div>
                <UptimeBar seed={i} />
              </div>
            ))}
            <div className="status-mini-footer">
              <span>45 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function DeveloperSection() {
  return (
    <section className="container section developer-section">
      <Reveal>
        <div className="developer-top">
          <span className="developer-symbol">
            <Terminal size={30} strokeWidth={1.3} />
          </span>
          <h2>
            Your stack.
            <br />
            Your way of working.
          </h2>
          <p>
            Bring the context to your team. Explore notification channels,
            incident timelines, and workspace API keys.
          </p>
        </div>
        <div className="integration-rail">
          {[
            { name: "Slack", icon: "slack" },
            { name: "Discord", icon: "discord" },
            { name: "Telegram", icon: "telegram" },
          ].map((i) => (
            <Link
              to="/demo/integrations"
              key={i.name}
              className="integration-logo"
            >
              <img
                src={`/images/${i.icon}.svg`}
                alt=""
                width="26"
                height="26"
                loading="lazy"
              />
              <span>{i.name}</span>
            </Link>
          ))}
          <Link to="/demo/integrations" className="integration-logo">
            <Webhook size={27} />
            <span>Webhooks</span>
          </Link>
          <Link to="/demo/api-keys" className="integration-logo">
            <Code2 size={27} />
            <span>REST API</span>
          </Link>
        </div>
        <div className="architecture-teaser">
          <span>
            <Cloud size={20} /> Built on Cloudflare
          </span>
          <p>
            Workers. D1. Queues. R2.
            <br />A small footprint, with a lot going on underneath.
          </p>
          <Link className="text-link" to="/architecture">
            Explore the architecture <ArrowUpRight size={16} />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function PricingSection({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const notice = useNotice();
  const Heading = standalone ? "h1" : "h2";
  return (
    <section
      id="pricing"
      className={`container section pricing-section ${standalone ? "standalone-section" : ""}`}
    >
      <Reveal>
        <Heading>
          Start small.
          <br />
          <span className="muted">Leave room to grow.</span>
        </Heading>
        <p className="section-description">
          Simple plans for side projects and the teams they become. Public
          enrollment is coming soon.
        </p>
      </Reveal>
      <div className="pricing-grid">
        <Reveal className="pricing-card featured-plan">
          <div className="plan-title">
            <h3>Beta</h3>
            <span>For your next launch</span>
          </div>
          <p className="price">
            $0<span>/ month</span>
          </p>
          <p>Keep an eye on what you’re building.</p>
          <button
            className="button primary"
            onClick={() =>
              notice(
                "Beta enrollment is coming soon",
                "The public demo is ready to explore. New workspace enrollment opens after the monitoring engine and production authentication finish validation.",
              )
            }
          >
            Start with Beta <ArrowRight size={16} />
          </button>
          <ul>
            {[
              "5 active monitors",
              "5-minute check intervals",
              "7-day raw check history",
              "1 public status page",
              "AI-assisted incident summaries",
            ].map((t) => (
              <li key={t}>
                <Check size={15} />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal className="pricing-card">
          <div className="plan-title">
            <h3>Pro</h3>
            <span>For growing products</span>
          </div>
          <p className="price future-price">Coming soon</p>
          <p>More room for your services and history.</p>
          <button
            className="button secondary"
            onClick={() =>
              notice(
                "Pro is coming soon",
                "Expanded monitor limits and longer history are on the roadmap. Pricing will be announced when Pro is ready.",
              )
            }
          >
            Explore Pro <ArrowUpRight size={16} />
          </button>
          <ul>
            {[
              "Higher monitor limits",
              "Longer check retention",
              "More status pages",
              "Expanded integration limits",
              "Advanced reliability reporting",
            ].map((t) => (
              <li key={t}>
                <Check size={15} />
                {t}
              </li>
            ))}
          </ul>
          <small>Planned features. No paid subscriptions yet.</small>
        </Reveal>
        <Reveal className="pricing-card">
          <div className="plan-title">
            <h3>Team</h3>
            <span>For building together</span>
          </div>
          <p className="price future-price">Coming soon</p>
          <p>A shared home for your reliability work.</p>
          <button
            className="button secondary"
            onClick={() =>
              notice(
                "Team is coming soon",
                "Team plans will add capacity for larger workspaces. Explore the demo to see how a shared monitoring workspace feels.",
              )
            }
          >
            Explore Team <ArrowUpRight size={16} />
          </button>
          <ul>
            {[
              "Everything planned for Pro",
              "Larger workspace capacity",
              "Additional API keys",
              "Team reporting",
              "Priority support",
            ].map((t) => (
              <li key={t}>
                <Check size={15} />
                {t}
              </li>
            ))}
          </ul>
          <small>Planned features. No paid subscriptions yet.</small>
        </Reveal>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section className="container section faq-section">
      <h2>A few good questions.</h2>
      <div className="faq-list">
        {[
          [
            "Can I try Pulseflare without signing up?",
            "Yes. The interactive demo is open to everyone. It uses labeled sample data, so you can explore monitors, incidents, status pages, and delivery records without creating an account.",
          ],
          [
            "Is Pulseflare accepting new workspaces?",
            "Public enrollment is coming soon. The current site showcases the product, while the multi-tenant monitoring engine is being completed and validated.",
          ],
          [
            "Does monitoring depend on AI?",
            "No. HTTP checks and incident detection run independently. AI is an optional layer that summarizes evidence and suggests where to investigate.",
          ],
          [
            "Where does Pulseflare run?",
            "The application uses Cloudflare Pages and Workers, with D1, Queues, Workers AI, and R2. The v2 architecture introduces per-monitor Durable Objects and Clerk workspaces.",
          ],
        ].map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <ChevronDown size={17} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="container site-footer">
      <div className="footer-top">
        <div>
          <Brand />
          <p>
            Keep building.
            <br />
            We’ll keep watch.
          </p>
        </div>
        <div>
          <strong>Product</strong>
          <Link to="/features">Features</Link>
          <Link to="/demo">Interactive demo</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/status/demo">Sample status page</Link>
        </div>
        <div>
          <strong>Developers</strong>
          <Link to="/docs">Documentation</Link>
          <Link to="/architecture">Architecture</Link>
          <Link to="/docs#api">API reference</Link>
        </div>
        <div>
          <strong>Pulseflare</strong>
          <Link to="/docs#security">Security</Link>
          <Link to="/docs#privacy">Privacy</Link>
          <Link to="/login">Workspace login</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Pulseflare</span>
        <span>
          Built for the things you build. <Activity size={13} />
        </span>
      </div>
    </footer>
  );
}
export default function Marketing() {
  return (
    <>
      <MarketingNav />
      <main className="marketing-main">
        <Hero />
        <section className="container preview-section">
          <Reveal>
            <div className="preview-caption">
              <span>
                <Activity size={14} /> A clear picture. At every moment.
              </span>
              <span>
                Interactive product preview <ArrowDownRight size={14} />
              </span>
            </div>
            <ProductPreview />
          </Reveal>
        </section>
        <FeaturesSection />
        <StatusSection />
        <DeveloperSection />
        <PricingSection />
        <FAQ />
        <section className="container final-cta">
          <Reveal>
            <span className="cta-mark">
              <Activity size={35} />
            </span>
            <h2>
              Your next launch
              <br />
              deserves a lookout.
            </h2>
            <Link className="button primary" to="/demo">
              Take Pulseflare for a spin <ArrowUpRight size={17} />
            </Link>
          </Reveal>
        </section>
      </main>
      <Footer />
    </>
  );
}

export function FeaturesPage() {
  return (
    <>
      <MarketingNav />
      <main>
        <div className="container page-intro">
          <span className="section-kicker">The product</span>
          <h1>
            A calmer way
            <br />
            to keep watch.
          </h1>
          <p>
            Explore the Pulseflare monitoring experience. Product previews use
            sample data; public enrollment is coming soon.
          </p>
        </div>
        <FeaturesSection />
        <StatusSection />
      </main>
      <Footer />
    </>
  );
}
export function PricingPage() {
  return (
    <>
      <MarketingNav />
      <main>
        <PricingSection standalone />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

export function ArchitecturePage() {
  const nodes = [
    {
      icon: Globe,
      title: "Pages + React",
      text: "The dashboard, marketing site, and public status pages.",
    },
    {
      icon: ShieldCheck,
      title: "API Worker + Clerk",
      text: "Workspace identity, scoped requests, and resource management.",
    },
    {
      icon: Activity,
      title: "Monitor coordinator",
      text: "Planned v2 Durable Objects serialize each monitor’s alarms and state.",
    },
    {
      icon: Layers,
      title: "D1 + R2",
      text: "Relational monitoring evidence and long-term object storage.",
    },
    {
      icon: GitBranch,
      title: "Cloudflare Queues",
      text: "Incident events connect checking, enrichment, and alert delivery.",
    },
    {
      icon: Sparkles,
      title: "Workers AI",
      text: "Optional incident context with deterministic fallbacks.",
    },
  ];
  return (
    <>
      <MarketingNav />
      <main className="container architecture-page">
        <div className="page-intro">
          <span className="section-kicker">Under the hood</span>
          <h1>
            Small pieces.
            <br />A considered system.
          </h1>
          <p>
            An edge-native architecture that keeps monitoring, intelligence, and
            notifications independently understandable.
          </p>
        </div>
        <div className="architecture-flow">
          <span>
            <Globe /> Frontend
          </span>
          <ArrowRight />
          <span>
            <Cloud /> API Worker
          </span>
          <ArrowRight />
          <span>
            <Activity /> Monitoring
          </span>
          <ArrowRight />
          <span>
            <Bell /> Notifications
          </span>
        </div>
        <div className="architecture-nodes">
          {nodes.map(({ icon: Icon, title, text }) => (
            <Reveal className="architecture-node" key={title}>
              <Icon size={23} />
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </div>
        <div className="architecture-note">
          <ShieldCheck />
          <div>
            <h3>Built with visible boundaries.</h3>
            <p>
              The current implementation includes a working v1 pipeline and an
              in-progress v2 workspace API. The demo is isolated from
              production. Durable Object scheduling, browser push, automated
              retention, and production onboarding remain launch gates.
            </p>
          </div>
        </div>
        <Link className="button secondary" to="/docs">
          Read the documentation <BookOpen size={16} />
        </Link>
      </main>
      <Footer />
    </>
  );
}

export function DocsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <>
      <MarketingNav />
      <main className="container docs-page">
        <aside className="docs-nav">
          <strong>Documentation</strong>
          {[
            ["quickstart", "Quickstart"],
            ["monitoring", "Monitoring"],
            ["incidents", "Incidents"],
            ["integrations", "Integrations"],
            ["api", "API authentication"],
            ["security", "Security"],
            ["privacy", "Privacy & retention"],
          ].map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </aside>
        <article>
          <span className="section-kicker">Pulseflare docs</span>
          <h1>Make yourself at home.</h1>
          <p className="lead">
            A guide to the demo, the monitoring model, and the upcoming beta.
          </p>
          <section id="quickstart">
            <h2>Try the demo</h2>
            <p>
              Open the sample Orbit workspace. Select a monitor to inspect its
              history, follow an incident timeline, or visit its public status
              page. The demo is read-only and makes no monitoring requests.
            </p>
            <Link className="button primary" to="/demo">
              Open the workspace <ArrowRight size={16} />
            </Link>
          </section>
          <section id="monitoring">
            <h2>HTTP and heartbeat monitoring</h2>
            <p>
              HTTP monitors check a public URL against an expected status range.
              The v2 configuration supports response text, JSON-path assertions,
              and latency thresholds. Heartbeats are designed for jobs that call
              a secret URL after completing a run.
            </p>
            <p>
              Beta limits are five active monitors per workspace and a minimum
              five-minute HTTP interval. Heartbeat scheduling and failure
              confirmation are part of the v2 rollout, not a claim about the
              currently deployed v1 checker.
            </p>
          </section>
          <section id="incidents">
            <h2>From evidence to resolution</h2>
            <p>
              Inspect trigger checks, response times, notification deliveries,
              and a timeline of updates. AI summaries offer investigation hints,
              not a verified root cause. The demo includes a Markdown report
              export with explicitly labeled sample evidence.
            </p>
          </section>
          <section id="integrations">
            <h2>Bring alerts to your team</h2>
            <p>
              The existing alert pipeline supports Discord, Telegram, and
              generic webhooks. The v2 integration model adds encrypted
              configuration, Slack, notification filters, and signed delivery
              metadata. Browser push is planned.
            </p>
          </section>
          <section id="api">
            <h2>Workspace API keys</h2>
            <p>
              Workspace admins can create scoped API keys in the v2 API. Full
              keys are shown once and stored as SHA-256 hashes. Keep them in
              your secret manager and never commit them to Git.
            </p>
            <div className="code-block">
              <div>
                <span>Example request</span>
                <CopyButton
                  text={
                    'curl https://YOUR_API_HOST/api/monitors -H "Authorization: Bearer $PULSEFLARE_API_KEY"'
                  }
                />
              </div>
              <pre>
                {
                  'curl https://YOUR_API_HOST/api/monitors \\\n  -H "Authorization: Bearer $PULSEFLARE_API_KEY"'
                }
              </pre>
            </div>
            <p>
              The API uses JSON envelopes:{" "}
              <code>{'{ "ok": true, "data": ... }'}</code>. Authenticated
              workspace routes require Clerk organization context or a scoped
              API key. Production API enrollment is coming soon.
            </p>
          </section>
          <section id="security">
            <h2>Security boundaries</h2>
            <p>
              The v2 API scopes customer resources to a workspace. Integration
              secrets use AES-GCM encryption. Public monitor targets must use
              HTTP or HTTPS. Further SSRF hardening, durable rate limiting, and
              end-to-end authentication validation remain required before public
              beta enrollment.
            </p>
          </section>
          <section id="privacy">
            <h2>Privacy and data retention</h2>
            <p>
              The public demo contains fictional sample services and does not
              require an account. Theme preferences are saved in your browser.
              Demo exports contain only the sample incident shown on screen.
            </p>
            <p>
              Live monitoring stores endpoint configuration, response timing,
              and incident evidence. The beta retention policy targets seven
              days of raw checks and 90 days of hourly history; automated
              archival is still under development. Do not send credentials in
              URLs. Production terms and privacy disclosures will be published
              before enrollment opens.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}
