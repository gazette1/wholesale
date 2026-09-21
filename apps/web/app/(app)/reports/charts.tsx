"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function SourceFunnelChart({ data }: { data: { source: string; leads: number; contracts: number }[] }) {
  if (!data.length) return <p className="text-xs text-fg-3">No leads in this range.</p>;
  const rows = data.slice(0, 10);
  return (
    <div style={{ height: Math.max(140, rows.length * 34 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="source" width={120} interval={0} tick={{ fontSize: 11, fill: "#55534d" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="leads" name="Leads" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={10} />
          <Bar dataKey="contracts" name="Contracts" fill="#14b8a6" radius={[0, 4, 4, 0]} barSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
