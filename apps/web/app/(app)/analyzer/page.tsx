import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { listAnalyses, analysisScopeCounts, leadsForAnalysis, ANALYSIS_SORTS, type AnalysisScope } from "@/lib/data/analyses";
import { cloneAnalysis, setAnalysisLibraryState, purgeAnalysis } from "@/lib/actions/analyzer";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ActionButton } from "@/components/ui/action-form";
import { NewAnalysis } from "./new-analysis";
import { money, percent, relative, cn } from "@/lib/utils";
import { Calculator, Download } from "lucide-react";
import { SubmitOnce } from "@/components/ui/action-form";

export const metadata = { title: "Deal Analyzer" };
const TONE: Record<string, "neutral" | "info" | "good" | "bad"> = { draft: "neutral", reviewing: "info", approved_for_offer: "good", rejected: "bad" };
const SCOPES: { key: AnalysisScope; label: string }[] = [{ key: "active", label: "Active" }, { key: "archived", label: "Archived" }, { key: "trash", label: "Trash" }];
const STATUSES = ["all", "draft", "reviewing", "approved_for_offer", "rejected"];
const EMPTY: Record<AnalysisScope, { title: string; description: string }> = {
  active: { title: "No analyses match", description: "Start one with New analysis, or clear the filters." },
  archived: { title: "Nothing archived", description: "Archive a version to keep it out of the main list without deleting it." },
  trash: { title: "Trash is empty", description: "Versions moved to trash wait here until they are restored or deleted for good." },
};

type Search = { status?: string; scope?: string; q?: string; strategy?: string; sort?: string };

export default async function AnalyzerListPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const scope: AnalysisScope = sp.scope === "archived" || sp.scope === "trash" ? sp.scope : "active";
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "all";
  const strategy = ["wholesale", "flip", "rental"].includes(sp.strategy ?? "") ? sp.strategy! : "";
  const sort = ANALYSIS_SORTS.some((s) => s.key === sp.sort) ? sp.sort! : "updated";
  const q = (sp.q ?? "").slice(0, 80);
  const writable = can(session, "analysis:write");
  const [rows, counts, pickerLeads] = await Promise.all([listAnalyses(session.orgId, { status, scope, q, strategy, sort }), analysisScopeCounts(session.orgId), writable ? leadsForAnalysis(session.orgId) : Promise.resolve([])]);

  const href = (patch: Partial<Search>) => {
    const next: Record<string, string> = { scope, status, strategy, sort, q, ...patch } as Record<string, string>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === "scope" && v === "active") && !(k === "status" && v === "all") && !(k === "sort" && v === "updated")) params.set(k, v);
    const s = params.toString();
    return s ? `/analyzer?${s}` : "/analyzer";
  };
  const filtered = Boolean(q || strategy || status !== "all");

  return (
    <>
      <PageHeader title="Deal Analyzer" description="Every analysis belongs to a property, so its numbers show on the pipeline card and the lead." actions={
        <>
          <LinkButton external href="/api/export/analyses.csv" variant="outline"><Download className="h-4 w-4" />Export CSV</LinkButton>
          {writable ? <NewAnalysis leads={pickerLeads.map((l) => ({ ...l, analyses: Number(l.analyses) }))} /> : null}
        </>
      } />

      <div className="flex items-center gap-1 border-b border-border mb-3" role="tablist" aria-label="Library scope">
        {SCOPES.map((s) => (
          <Link key={s.key} href={href({ scope: s.key })} role="tab" aria-selected={scope === s.key} className={cn("relative px-3 py-2 text-[13px]", scope === s.key ? "font-medium text-fg" : "text-fg-3 hover:text-fg")}>
            {s.label} <span className="text-xs text-fg-3 num">{counts[s.key]}</span>{scope === s.key ? <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg rounded-full" /> : null}
          </Link>
        ))}
      </div>

      <form method="get" action="/analyzer" className="flex flex-wrap items-center gap-2 mb-3">
        {scope !== "active" ? <input type="hidden" name="scope" value={scope} /> : null}
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <Input name="q" defaultValue={q} placeholder="Search address, city, ZIP, or version name" aria-label="Search analyses" className="w-72" />
        <Select name="strategy" defaultValue={strategy} aria-label="Strategy" className="w-36"><option value="">All strategies</option><option value="wholesale">Wholesale</option><option value="flip">Flip</option><option value="rental">Rental</option></Select>
        <Select name="sort" defaultValue={sort} aria-label="Sort" className="w-48">{ANALYSIS_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>
        <Button type="submit" variant="outline">Apply</Button>
        {filtered ? <Link href={href({ q: "", strategy: "", status: "all" })} className="text-xs text-brand hover:underline">Clear filters</Link> : null}
      </form>

      <div className="flex gap-1.5 mb-3 text-xs flex-wrap">
        {STATUSES.map((s) => (
          <Link key={s} href={href({ status: s })} className={cn("rounded-full border px-2.5 py-1", status === s ? "bg-accent text-accent-fg border-accent" : "border-border bg-surface hover:bg-surface-2")}>{s === "all" ? "All statuses" : s.replace(/_/g, " ")}</Link>
        ))}
      </div>

      {rows.length === 0 ? <EmptyState icon={Calculator} title={filtered ? "No analyses match" : EMPTY[scope].title} description={filtered ? "Try a different search or clear the filters." : EMPTY[scope].description} /> : (
        <div className="rounded-lg border border-border bg-surface overflow-x-auto">
          <Table>
            <THead><tr><TH>Property</TH><TH>Version</TH><TH>Strategy</TH><TH>Status</TH><TH right>ARV</TH><TH right>Offer</TH><TH right>MAO</TH><TH right>Spread</TH><TH right>Flip net</TH><TH right>% ARV</TH><TH>Updated</TH>{writable ? <TH right>Actions</TH> : null}</tr></THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD><Link href={`/analyzer/${a.id}`} className="font-medium hover:underline">{a.address}</Link><div className="text-xs text-fg-3">{a.city}, {a.state}{a.leadId ? <> · <Link href={`/leads/${a.leadId}?tab=analyzer`} className="hover:underline">lead</Link></> : null}</div></TD>
                  <TD>v{a.version} {a.name}{a.isPrimary ? <Badge tone="brand" className="ml-1">Primary</Badge> : null}<div className="text-xs text-fg-3">{a.createdBy ?? ""}</div></TD>
                  <TD className="capitalize">{a.strategy}</TD>
                  <TD><Badge tone={TONE[a.status] ?? "neutral"}>{a.status.replace(/_/g, " ")}</Badge></TD>
                  <TD right>{money(a.arv)}</TD><TD right>{money(a.purchasePrice)}</TD><TD right>{money(a.maxAllowableOffer)}</TD>
                  <TD right className={Number(a.spread) > 0 ? "text-good" : "text-bad"}>{money(a.spread)}</TD>
                  <TD right className={Number(a.netProfit) > 0 ? "text-good" : "text-bad"}>{money(a.netProfit)}</TD>
                  <TD right>{Number(a.arv) > 0 && a.purchasePrice ? percent(Number(a.purchasePrice) / Number(a.arv)) : ""}</TD>
                  <TD className="text-fg-3 whitespace-nowrap">{relative(a.updatedAt)}</TD>
                  {writable ? (
                    <TD right>
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {scope === "trash" ? (
                          <>
                            <ActionButton action={setAnalysisLibraryState.bind(null, a.id, "restore")} variant="outline">Restore</ActionButton>
                            <ActionButton action={purgeAnalysis.bind(null, a.id)} variant="ghost" className="text-bad" confirm="Delete this version for good? This cannot be undone.">Delete for good</ActionButton>
                          </>
                        ) : (
                          <>
                            <form action={cloneAnalysis.bind(null, a.id)}><SubmitOnce variant="ghost" size="sm">Duplicate</SubmitOnce></form>
                            {scope === "archived"
                              ? <ActionButton action={setAnalysisLibraryState.bind(null, a.id, "unarchive")} variant="ghost">Unarchive</ActionButton>
                              : <ActionButton action={setAnalysisLibraryState.bind(null, a.id, "archive")} variant="ghost">Archive</ActionButton>}
                            <ActionButton action={setAnalysisLibraryState.bind(null, a.id, "trash")} variant="ghost" className="text-bad">Trash</ActionButton>
                          </>
                        )}
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
