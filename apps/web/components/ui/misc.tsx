import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Inbox } from "lucide-react";

export function PageHeader({ title, description, actions, crumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        {crumbs?.length ? (
          <nav className="text-xs text-fg-3 mb-1 flex items-center gap-1 flex-wrap">
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <span>/</span> : null}
                {c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span>{c.label}</span>}
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-fg truncate">{title}</h1>
        {description ? <p className="text-[13px] text-fg-3 mt-0.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-lg border border-dashed border-border bg-surface-2/60">
      <div className="h-10 w-10 rounded-full bg-surface border border-border flex items-center justify-center mb-3"><Icon className="h-5 w-5 text-fg-3" /></div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {description ? <div className="text-xs text-fg-3 mt-1 max-w-sm">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-black/5", className)} />;
}

export function TabNav({ tabs, current }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-border overflow-x-auto scrollbar-thin -mx-1 px-1">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("relative px-3 py-2 text-[13px] whitespace-nowrap transition-colors", t.key === current ? "text-fg font-medium" : "text-fg-3 hover:text-fg")}>
          {t.label}
          {typeof t.count === "number" ? <span className="ml-1.5 rounded-full bg-black/5 px-1.5 text-[11px] text-fg-3">{t.count}</span> : null}
          {t.key === current ? <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg rounded-full" /> : null}
        </Link>
      ))}
    </div>
  );
}

export function Alert({ tone = "info", children, className }: { tone?: "info" | "warn" | "bad" | "good"; children: React.ReactNode; className?: string }) {
  const map = { info: "bg-info-soft text-[#1d4f8a] border-[#c6dbf3]", warn: "bg-warn-soft text-warn border-[#f3d9b0]", bad: "bg-bad-soft text-bad border-[#f3c0c0]", good: "bg-good-soft text-good border-[#bfe3c9]" };
  return <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-[13px]", map[tone], className)}>{children}</div>;
}

export function KeyValue({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 1 | 2 | 3 | 4 }) {
  const grid = cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 sm:grid-cols-2" : cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  return (
    <dl className={cn("grid gap-x-6 gap-y-2", grid)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-fg-3">{it.label}</dt>
          <dd className="text-[13px] text-fg num truncate">{it.value ?? <span className="text-fg-3">n/a</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
