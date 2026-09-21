"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Kanban, Users, Calculator, Building2, Send, FileText, CheckSquare, Settings, Menu, X, Contact } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/badge";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/tasks", label: "Follow ups", icon: CheckSquare },
  { href: "/analyzer", label: "Deal Analyzer", icon: Calculator },
  { href: "/buyers", label: "Buyers", icon: Building2 },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ orgName, userName, role, authMode, providerBadge }: { orgName: string; userName: string; role: string; authMode: string; providerBadge?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Escape closes the mobile menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", active ? "bg-black/[0.06] text-fg font-medium" : "text-fg-2 hover:bg-black/[0.04] hover:text-fg")}>
            <item.icon className={cn("h-4 w-4", active ? "text-fg" : "text-fg-3")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-3 h-12">
        <button onClick={() => setOpen((o) => !o)} className="p-1.5 rounded-md hover:bg-black/5" aria-label="Menu" aria-expanded={open} aria-controls="app-sidebar">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        <span className="text-sm font-semibold">{orgName}</span>
        <Avatar name={userName} />
      </div>
      {open ? <div className="lg:hidden fixed inset-0 z-20 bg-black/20" onClick={() => setOpen(false)} /> : null}
      <aside id="app-sidebar" className={cn("fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-border bg-surface flex flex-col transition-transform lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:z-auto", open ? "translate-x-0 top-12 lg:top-0" : "-translate-x-full")}>
        <div className="px-4 py-4 border-b border-border hidden lg:block">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-accent text-accent-fg flex items-center justify-center font-bold text-xs">{orgName.slice(0, 1)}</div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">{orgName}</div>
              <div className="text-[11px] text-fg-3">Acquisitions CRM</div>
            </div>
          </div>
        </div>
        <div className="py-3 flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-2">
            <Avatar name={userName} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{userName}</div>
              <div className="text-[11px] text-fg-3 capitalize">{role}{authMode === "dev" ? " · dev login" : ""}</div>
            </div>
          </div>
          {providerBadge ? <div className="mt-2 text-[11px] text-fg-3 truncate" title={providerBadge}>{providerBadge}</div> : null}
          <form action="/login/signout" method="post" className="mt-2">
            <button className="text-[11px] text-fg-3 hover:text-fg" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
