import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listLeads, listStages, listProfiles, listSources, listTags, type LeadFilters } from "@/lib/data/leads";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StageBadge, Badge } from "@/components/ui/badge";
import { money, dueLabel, relative, fullName, cn } from "@/lib/utils";
import { Plus, ArrowUpDown } from "lucide-react";

export const metadata = { title: "Leads" };

const COLUMNS: { key: string; label: string; sort?: string; right?: boolean }[] = [
  { key: "address", label: "Property", sort: "address" }, { key: "contact", label: "Seller" }, { key: "stage", label: "Stage", sort: "stage" },
  { key: "followUp", label: "Follow up", sort: "followUp" }, { key: "attempts", label: "Attempts", sort: "attempts", right: true }, { key: "asking", label: "Asking", sort: "asking", right: true },
  { key: "motivation", label: "Motivation", sort: "motivation", right: true }, { key: "source", label: "Source" }, { key: "assigned", label: "Owner" }, { key: "created", label: "Created", sort: "created" },
];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const filters: LeadFilters = { q: sp.q, stage: sp.stage, assigned: sp.assigned, source: sp.source, status: sp.status ?? "open", tag: sp.tag, due: sp.due as any, sort: sp.sort, dir: sp.dir as any, page: Number(sp.page ?? 1), issue: sp.issue };
  const [data, stages, team, sources, tagList] = await Promise.all([listLeads(session.orgId, filters), listStages(session.orgId), listProfiles(session.orgId), listSources(session.orgId), listTags(session.orgId)]);
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/leads?${p.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <>
      <PageHeader title="Leads" description={`${data.total} ${filters.status === "all" ? "" : filters.status} leads`} actions={<Link href="/leads/new"><Button variant="primary"><Plus className="h-4 w-4" />New lead</Button></Link>} />
      <form method="get" className="flex flex-wrap items-end gap-2 mb-3">
        <Input name="q" defaultValue={sp.q} placeholder="Search address, name, phone" className="w-60" />
        <Select name="stage" defaultValue={sp.stage ?? ""} className="w-44"><option value="">All stages</option>{stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>
        <Select name="assigned" defaultValue={sp.assigned ?? ""} className="w-40"><option value="">Anyone</option><option value="unassigned">Unassigned</option>{team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</Select>
        <Select name="source" defaultValue={sp.source ?? ""} className="w-40"><option value="">Any source</option>{sources.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</Select>
        <Select name="due" defaultValue={sp.due ?? ""} className="w-36"><option value="">Any follow up</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">This week</option></Select>
        <Select name="tag" defaultValue={sp.tag ?? ""} className="w-40"><option value="">Any tag</option>{tagList.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? "open"} className="w-32"><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="nurture">Nurture</option><option value="all">All</option></Select>
        <Button type="submit" variant="outline">Apply</Button>
        {Object.keys(sp).length ? <Link href="/leads" className="text-xs text-fg-3 hover:text-fg ml-1">Clear</Link> : null}
      </form>
      <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
        <span className="text-fg-3 mr-1">Saved views:</span>
        {[{ label: "Call now", q: { due: "overdue", status: "open" } }, { label: "Untouched", q: { stage: "new_lead", status: "open" } }, { label: "Offers out", q: { stage: "offer_sent", status: "open" } }, { label: "Messy deals", q: { issue: "dirty_title", status: "open" } }, { label: "Mine", q: { assigned: session.profileId, status: "open" } }].map((v) => (
          <Link key={v.label} href={link({ q: undefined, stage: undefined, assigned: undefined, due: undefined, issue: undefined, ...v.q })} className="rounded-full border border-border bg-surface px-2.5 py-1 hover:bg-surface-2">{v.label}</Link>
        ))}
      </div>
      {data.rows.length === 0 ? <EmptyState title="No leads match" description="Try a different filter or add a lead." action={<Link href="/leads/new"><Button variant="primary">New lead</Button></Link>} /> : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <Table>
            <THead><tr>{COLUMNS.map((c) => (
              <TH key={c.key} right={c.right}>
                {c.sort ? <Link href={link({ sort: c.sort, dir: sp.sort === c.sort && sp.dir !== "desc" ? "desc" : "asc" })} className={cn("inline-flex items-center gap-1 hover:text-fg", sp.sort === c.sort && "text-fg")}>{c.label}<ArrowUpDown className="h-3 w-3" /></Link> : c.label}
              </TH>
            ))}</tr></THead>
            <TBody>
              {data.rows.map((r) => {
                const due = dueLabel(r.nextFollowUpAt);
                const messy = Number((r.dealIssues as any)?.messyScore ?? 0);
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/leads/${r.id}`} className="font-medium hover:underline">{r.address}</Link>
                      <div className="text-xs text-fg-3">{r.city}, {r.state} {r.postalCode}{messy ? ` · ${messy} issue${messy > 1 ? "s" : ""}` : ""}</div>
                    </TD>
                    <TD>
                      <div>{fullName({ firstName: r.contactFirst, lastName: r.contactLast }) || <span className="text-fg-3">No contact</span>}</div>
                      <div className="text-xs text-fg-3">{(r.contactPhones as any[])?.[0]?.number ?? ""}{r.smsConsent === "opted_out" ? " · opted out" : ""}</div>
                    </TD>
                    <TD><StageBadge name={r.stageName} color={r.stageColor} /></TD>
                    <TD><Badge tone={due.tone === "bad" ? "bad" : due.tone === "warn" ? "warn" : due.tone === "good" ? "good" : "neutral"}>{due.text}</Badge></TD>
                    <TD right>{r.contactAttempts}</TD>
                    <TD right>{money(r.askingPrice)}</TD>
                    <TD right>{r.motivationScore ?? ""}</TD>
                    <TD>{r.source ?? ""}</TD>
                    <TD>{r.assignedName ?? <span className="text-fg-3">Unassigned</span>}</TD>
                    <TD className="text-fg-3">{relative(r.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {pages > 1 ? (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-fg-3">
              <span>Page {data.page} of {pages}</span>
              <div className="flex gap-2">
                {data.page > 1 ? <Link href={link({ page: String(data.page - 1) })} className="hover:text-fg">Previous</Link> : null}
                {data.page < pages ? <Link href={link({ page: String(data.page + 1) })} className="hover:text-fg">Next</Link> : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
