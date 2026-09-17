import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({ className, title, description, actions }: { className?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 py-3 border-b border-border", className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-fg leading-5">{title}</h3>
        {description ? <p className="text-xs text-fg-3 mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn" | "brand" }) {
  const toneClass = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "brand" ? "text-brand" : "text-fg";
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-fg-3 font-medium">{label}</div>
      <div className={cn("text-2xl font-semibold tracking-tight num mt-1", toneClass)}>{value}</div>
      {sub ? <div className="text-xs text-fg-3 mt-1">{sub}</div> : null}
    </Card>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn" | "muted"; hint?: string }) {
  const toneClass = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "muted" ? "text-fg-3" : "text-fg";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/60 last:border-0" title={hint}>
      <span className="text-[13px] text-fg-2">{label}</span>
      <span className={cn("text-[13px] font-medium num", toneClass)}>{value}</span>
    </div>
  );
}
