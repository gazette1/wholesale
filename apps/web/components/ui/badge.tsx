import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-black/5 text-fg-2",
  brand: "bg-brand-soft text-brand",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-[#1d4f8a]",
};

export function Badge({ tone = "neutral", className, children, dot, color }: { tone?: BadgeTone; className?: string; children: React.ReactNode; dot?: boolean; color?: string | null }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", tones[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: color ?? "currentColor" }} /> : null}
      {children}
    </span>
  );
}

export function StageBadge({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-2 whitespace-nowrap">
      <span className="h-2 w-2 rounded-full" style={{ background: color ?? "#9ca3af" }} />
      {name}
    </span>
  );
}

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
  return (
    <span className={cn("inline-flex items-center justify-center rounded-full bg-accent text-accent-fg font-semibold shrink-0", size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs")} title={name}>
      {initials || "?"}
    </span>
  );
}
