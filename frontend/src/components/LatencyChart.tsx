import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { latencySeries } from "../data/demo";
export default function LatencyChart({
  data = latencySeries(),
  compact = false,
  deployments = [],
}: {
  data?: Array<{ time: string; latency: number; timestamp?: number }>;
  compact?: boolean;
  deployments?: Array<{ id: string; version: string; createdAt: string }>;
}) {
  const timed = data.length > 0 && data.every((p) => p.timestamp !== undefined);
  const times = data.map((p) => p.timestamp || 0);
  const markers = timed
    ? deployments
        .filter(
          (d) =>
            Date.parse(d.createdAt) >= Math.min(...times) &&
            Date.parse(d.createdAt) <= Math.max(...times),
        )
        .slice(0, 4)
    : [];
  return (
    <div
      className={`latency-chart ${compact ? "compact-chart" : ""}`}
      role="img"
      aria-label="Response time chart in milliseconds"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -24, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id={compact ? "chartFillSmall" : "chartFill"}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#e88548" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#e88548" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--line)"
            vertical={false}
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey={timed ? "timestamp" : "time"}
            type={timed ? "number" : "category"}
            domain={timed ? ["dataMin", "dataMax"] : undefined}
            tickFormatter={
              timed
                ? (v) =>
                    new Date(v).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                : undefined
            }
            minTickGap={70}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={
              timed ? (v) => new Date(Number(v)).toLocaleString() : undefined
            }
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number) => [`${value} ms`, "Response"]}
          />
          {markers.map((d) => (
            <ReferenceLine
              key={d.id}
              x={Date.parse(d.createdAt)}
              stroke="var(--accent)"
              strokeDasharray="4 4"
              label={{
                value: d.version.slice(0, 12),
                fill: "var(--accent-text)",
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          ))}
          <Area
            dataKey="latency"
            type="monotone"
            stroke="#e88548"
            strokeWidth={2}
            fill={`url(#${compact ? "chartFillSmall" : "chartFill"})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
