"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#2563eb", "#0ea5e9", "#6366f1", "#8b5cf6", "#14b8a6", "#f59e0b", "#9ca3af"];

export function SourceChart({ data }: { data: { source: string; n: number }[] }) {
  if (!data.length) return <p className="text-xs text-fg-3">No leads yet.</p>;
  // Show the ten largest sources and fold the rest into one bar, with a row of height per bar so every label fits.
  const top = data.slice(0, 10);
  const rest = data.slice(10).reduce((a, d) => a + d.n, 0);
  const rows = rest > 0 ? [...top, { source: data.length - 10 === 1 ? "1 more source" : `${data.length - 10} more sources`, n: rest }] : top;
  return (
    <div style={{ height: Math.max(120, rows.length * 26 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="source" width={120} interval={0} tick={{ fontSize: 11, fill: "#55534d" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => [`${v} ${v === 1 ? "lead" : "leads"}`, "Count"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e6e4df" }} />
          <Bar dataKey="n" radius={[0, 4, 4, 0]} barSize={14}>
            {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
