import Link from "next/link";
import { requireSession, can } from "@/lib/auth";
import { boardLeads, listStages, listProfiles } from "@/lib/data/leads";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Board } from "./board";
import { Plus } from "lucide-react";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ assigned?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [stages, rows, team] = await Promise.all([listStages(session.orgId), boardLeads(session.orgId, sp.assigned), listProfiles(session.orgId)]);
  return (
    <>
      <PageHeader title="Pipeline" description={`${rows.length} open leads. Click a card for a quick view. Drag a card to change its stage.`} actions={
        <>
          <form className="flex items-center gap-2" method="get">
            <select name="assigned" defaultValue={sp.assigned ?? ""} className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {team.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
            <Button type="submit" variant="outline">Filter</Button>
          </form>
          <Link href="/leads/new"><Button variant="primary"><Plus className="h-4 w-4" />New lead</Button></Link>
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
