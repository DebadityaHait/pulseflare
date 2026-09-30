// An explicit, deterministic showcase dataset. Never mixed with live API data.
export type MonitorView = {
  id: string;
  name: string;
  url: string;
  type: "http" | "heartbeat";
  state: string;
  latency: number;
  uptime: number;
  tag: string;
  intervalS: number;
  active: boolean;
};
export const demoMonitors: MonitorView[] = [
  {
    id: "website",
    name: "Marketing website",
    url: "https://orbit.example.com",
    type: "http",
    state: "up",
    latency: 124,
    uptime: 99.98,
    tag: "production",
    intervalS: 300,
    active: true,
  },
  {
    id: "api",
    name: "Public API",
    url: "https://api.orbit.example.com/health",
    type: "http",
    state: "up",
    latency: 86,
    uptime: 99.96,
    tag: "production",
    intervalS: 300,
    active: true,
  },
  {
    id: "search",
    name: "Search service",
    url: "https://api.orbit.example.com/search",
    type: "http",
    state: "degraded",
    latency: 1842,
    uptime: 99.84,
    tag: "production",
    intervalS: 300,
    active: true,
  },
  {
    id: "backup",
    name: "Nightly backup",
    url: "Heartbeat · every 24 hours",
    type: "heartbeat",
    state: "up",
    latency: 0,
    uptime: 100,
    tag: "background",
    intervalS: 86400,
    active: true,
  },
];
export type IncidentView = {
  id: string;
  name: string;
  monitorId: string;
  status: string;
  summary: string;
  severity: number;
  started: string;
  duration: string;
};
export const demoIncidents: IncidentView[] = [
  {
    id: "inc-search",
    name: "Elevated latency on Search",
    monitorId: "search",
    status: "investigating",
    summary:
      "Response times exceeded the 1,500 ms threshold on two consecutive checks. Availability is unaffected. Check the search index and recent deployment.",
    severity: 3,
    started: "14:32 UTC",
    duration: "12 min",
  },
  {
    id: "inc-api",
    name: "Public API returned HTTP 503",
    monitorId: "api",
    status: "resolved",
    summary:
      "The API recovered after a connection pool restart. Four checks failed during a 20-minute incident.",
    severity: 4,
    started: "Yesterday, 09:10 UTC",
    duration: "20 min",
  },
];
export const demoTimeline = [
  {
    time: "14:32:00",
    title: "Latency threshold exceeded",
    text: "Search responded in 1,723 ms. Threshold: 1,500 ms.",
    kind: "check",
  },
  {
    time: "14:37:00",
    title: "Performance incident opened",
    text: "Second consecutive slow response: 1,842 ms.",
    kind: "incident",
  },
  {
    time: "14:37:02",
    title: "Engineering notified",
    text: "Slack and signed webhook delivered successfully.",
    kind: "notification",
  },
  {
    time: "14:40:00",
    title: "Investigation started",
    text: "Reviewing the latest search index deployment.",
    kind: "update",
  },
];
export const demoDeliveries = [
  {
    channel: "Slack",
    destination: "#engineering",
    status: "Delivered",
    code: 200,
    duration: "238 ms",
    time: "14:37:02",
  },
  {
    channel: "Webhook",
    destination: "Incident handler",
    status: "Delivered",
    code: 200,
    duration: "182 ms",
    time: "14:37:02",
  },
  {
    channel: "Discord",
    destination: "Operations",
    status: "Failed",
    code: 410,
    duration: "96 ms",
    time: "Yesterday",
  },
];
export function timelineFor(incidentId: string) {
  return incidentId === "inc-api"
    ? [
        {
          time: "09:10:00",
          title: "API returned HTTP 503",
          text: "The health endpoint failed its availability check.",
          kind: "check",
        },
        {
          time: "09:15:00",
          title: "Outage confirmed",
          text: "A second check returned HTTP 503. Engineering was notified.",
          kind: "incident",
        },
        {
          time: "09:24:00",
          title: "Connection pool restarted",
          text: "The team restarted the API connection pool.",
          kind: "update",
        },
        {
          time: "09:30:00",
          title: "Service recovered",
          text: "The health endpoint returned HTTP 200. Incident resolved.",
          kind: "check",
        },
      ]
    : demoTimeline;
}
export function latencySeries(seed = 0, count = 48, hours = 24) {
  return Array.from({ length: count }, (_, i) => ({
    time:
      hours > 24
        ? `Day ${Math.floor((i * hours) / count / 24) + 1}`
        : `${String(Math.floor((i * hours) / count)).padStart(2, "0")}:${String(Math.floor((i * hours * 60) / count) % 60).padStart(2, "0")}`,
    latency: Math.round(
      104 +
        Math.sin(i * 1.3 + seed) * 19 +
        Math.cos(i * 0.6) * 9 +
        (i > count * 0.65 && i < count * 0.74 ? 98 : 0),
    ),
  }));
}
export function postmortemMarkdown(incident: IncidentView) {
  return `# ${incident.name}\n\n> Sample incident report from the Pulseflare demo.\n\n## Summary\n${incident.summary}\n\n## Impact\nAffected monitor: ${incident.monitorId}\nSeverity: ${incident.severity}\nStatus: ${incident.status}\nDuration: ${incident.duration}\n\n## Timeline\n${timelineFor(
    incident.id,
  )
    .map((item) => `- ${item.time} UTC: ${item.title}. ${item.text}`)
    .join(
      "\n",
    )}\n\n## Root cause\nNot yet confirmed. Correlation alone does not establish the cause.\n\n## Follow-up\n- Review deployment changes and origin logs.\n- Validate recovery with subsequent checks.\n- Record confirmed cause and preventive actions.\n`;
}
