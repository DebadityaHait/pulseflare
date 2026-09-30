import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { latencySeries } from "../data/demo";
export default function LatencyChart({
  data = latencySeries(),
  compact = false,
}: {
  data?: ReturnType<typeof latencySeries>;
  compact?: boolean;
}) {
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
            dataKey="time"
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
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number) => [`${value} ms`, "Response"]}
          />
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
