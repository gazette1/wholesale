import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { boardLeads, listStages, listProfiles } from "@/lib/data/leads";
import { PageHeader } from "@/components/ui/misc";
import { Button, LinkButton } from "@/components/ui/button";
import { Board } from "./board";
import { Plus } from "lucide-react";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ assigned?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [stages, rows, team] = await Promise.all([listStages(session.orgId), boardLeads(session.orgId, sp.assigned), listProfiles(session.orgId)]);
  const openCount = rows.filter((r) => r.status === "open").length;
  return (
    <>
      <PageHeader title="Pipeline" description={`${openCount} open ${openCount === 1 ? "lead" : "leads"}${rows.length > openCount ? `, plus ${rows.length - openCount} closed or dead in the last 60 days` : ""}. Click a card for a quick view. Drag a card to change its stage.`} actions={
        <>
          <form className="flex items-center gap-2" method="get">
            <select name="assigned" aria-label="Show leads assigned to" key={sp.assigned ?? "everyone"} defaultValue={sp.assigned ?? ""} className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
            <Button type="submit" variant="outline">Filter</Button>
          </form>
          <LinkButton href="/leads/new" variant="primary"><Plus className="h-4 w-4" />New lead</LinkButton>
        </>
      } />
      <Board stages={stages.map((s) => ({ id: s.id, key: s.key, name: s.name, color: s.color, isTerminal: s.isTerminal }))} leads={rows.map(serialize)} canMove={can(session, "lead:write")} canAnalyze={can(session, "analysis:write")} />
    </>
  );
}

function serialize(r: Awaited<ReturnType<typeof boardLeads>>[number]) {
  return {
    id: r.id, propertyId: r.propertyId, stageId: r.stageId, address: r.address, city: r.city, contact: [r.contactFirst, r.contactLast].filter(Boolean).join(" "),
    assigned: r.assignedName, attempts: r.contactAttempts, nextFollowUpAt: r.nextFollowUpAt ? r.nextFollowUpAt.toISOString() : null,
    askingPrice: r.askingPrice ? Number(r.askingPrice) : null, urgency: r.sellerUrgency, messy: Number((r.dealIssues as any)?.messyScore ?? 0), source: r.source,
    tags: r.tags.map((t) => ({ name: t.name, color: t.color, kind: t.kind })),
    analysisId: r.analysisId, analysisMao: r.analysisMao, analysisSpread: r.analysisSpread,
  };
}
