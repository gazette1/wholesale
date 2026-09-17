"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#2563eb", "#0ea5e9", "#6366f1", "#8b5cf6", "#14b8a6", "#f59e0b", "#9ca3af"];

export function SourceChart({ data }: { data: { source: string; n: number }[] }) {
  if (!data.length) return <p className="text-xs text-fg-3">No leads yet.</p>;
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="source" width={120} tick={{ fontSize: 11, fill: "#55534d" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
          <Bar dataKey="n" radius={[0, 4, 4, 0]} barSize={14}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
