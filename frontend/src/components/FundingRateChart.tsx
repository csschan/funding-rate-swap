"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { date: string; rate: number }[];
  impliedFixedRate: number;
}

export function FundingRateChart({ data, impliedFixedRate }: Props) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6b7280", fontSize: 11 }}
          tickLine={false}
          interval={5}
        />
        <YAxis
          tick={{ fill: "#6b7280", fontSize: 11 }}
          tickLine={false}
          tickFormatter={(v) => `${v.toFixed(0)}bps`}
        />
        <Tooltip
          contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 6 }}
          labelStyle={{ color: "#9ca3af" }}
          formatter={(v) => [`${Number(v).toFixed(2)} bps`, "Funding Rate"]}
        />
        <ReferenceLine
          y={impliedFixedRate}
          stroke="#6366f1"
          strokeDasharray="4 2"
          label={{ value: "Fixed", fill: "#6366f1", fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey="rate"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
