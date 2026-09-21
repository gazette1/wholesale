import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getAnalysis } from "@/lib/data/analyses";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { cloneAnalysis, deleteAnalysis, setAnalysisStatus, setAnalysisLibraryState } from "@/lib/actions/analyzer";
import { Alert } from "@/components/ui/misc";
import { ActionButton } from "@/components/ui/action-form";
import { Editor } from "./editor";
import { money } from "@/lib/utils";
import { SubmitOnce } from "@/components/ui/action-form";

export const metadata = { title: "Analysis" };
const TONE: Record<string, "neutral" | "info" | "good" | "bad"> = { draft: "neutral", reviewing: "info", approved_for_offer: "good", rejected: "bad" };

export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = await getAnalysis(session.orgId, id);
  if (!detail) notFound();
  const { analysis, property, lead, siblings } = detail;
  const writable = can(session, "analysis:write");
  const trashed = analysis.trashedAt != null;
  const locked = trashed || analysis.status === "approved_for_offer" || analysis.status === "rejected";
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Deal Analyzer", href: "/analyzer" }, ...(lead ? [{ label: "Lead", href: `/leads/${lead.id}?tab=analyzer` }] : []), { label: `v${analysis.version}` }]}
        title={<span className="flex items-center gap-3 flex-wrap">{property.addressLine1}<Badge tone={TONE[analysis.status] ?? "neutral"}>{analysis.status.replace(/_/g, " ")}</Badge>{analysis.isPrimary ? <Badge tone="brand">Primary</Badge> : null}</span>}
        description={`${property.city}, ${property.state} ${property.postalCode} · v${analysis.version} ${analysis.name} · engine ${analysis.engineVersion}`}
        actions={writable && !trashed ? (
          <>
            {siblings.length > 1 ? <LinkButton href={`/analyzer/${id}?tab=compare`} variant="outline">Compare {siblings.length} versions</LinkButton> : null}
            <form action={cloneAnalysis.bind(null, id)}><SubmitOnce variant="outline">Clone</SubmitOnce></form>
            {analysis.status === "draft" ? <ActionButton action={setAnalysisStatus.bind(null, id, "reviewing")} size="md">Send to review</ActionButton> : null}
            {analysis.status !== "approved_for_offer" ? <ActionButton action={setAnalysisStatus.bind(null, id, "approved_for_offer")} variant="primary" size="md">Approve for offer</ActionButton> : null}
            {analysis.status !== "rejected" ? <ActionButton action={setAnalysisStatus.bind(null, id, "rejected")} variant="ghost" size="md">Reject</ActionButton> : null}
            {locked ? <ActionButton action={setAnalysisStatus.bind(null, id, "draft")} variant="ghost" size="md">Reopen</ActionButton> : null}
            <LinkButton href={`/buyers/match/${id}`} variant="outline">Match buyers</LinkButton>
            <LinkButton href={`/packages/new?analysis=${id}`} variant="default">Deal package</LinkButton>
          </>
        ) : undefined}
      />
      {trashed ? <Alert tone="warn" className="mb-3 flex items-center justify-between gap-3"><span>This version is in the trash. It is read only until it is restored.</span>{writable ? <ActionButton action={setAnalysisLibraryState.bind(null, id, "restore")} variant="outline">Restore</ActionButton> : null}</Alert> : null}
      {!trashed && analysis.archivedAt ? <Alert tone="info" className="mb-3 flex items-center justify-between gap-3"><span>This version is archived. It stays out of the main analyzer list.</span>{writable ? <ActionButton action={setAnalysisLibraryState.bind(null, id, "unarchive")} variant="outline">Move back to active</ActionButton> : null}</Alert> : null}
      {lead ? <div className="mb-3 text-xs text-fg-3">Linked to a lead in the pipeline. <Link href={`/leads/${lead.id}`} className="text-brand hover:underline">Open the lead</Link> · <Link href={`/leads/${lead.id}?tab=offers`} className="text-brand hover:underline">Offers</Link> · <Link href={`/properties/${property.id}/report`} className="text-brand hover:underline">Property report</Link> · <Link href="/pipeline" className="text-brand hover:underline">Pipeline</Link></div> : null}
      <div className="flex gap-1.5 mb-4 text-xs overflow-x-auto">
        {siblings.map((s) => (
          <Link key={s.id} href={`/analyzer/${s.id}`} className={`rounded-md border px-2.5 py-1.5 whitespace-nowrap ${s.id === id ? "bg-accent text-accent-fg border-accent" : "border-border bg-surface hover:bg-surface-2"}`}>
            v{s.version} {s.name} <span className={s.id === id ? "text-white/70" : "text-fg-3"}>· spread {money(s.spread)}</span>
          </Link>
        ))}
      </div>
      <Editor
        analysisId={id}
        initialInputs={analysis.inputs}
        name={analysis.name}
        notes={analysis.notes ?? ""}
        locked={locked || !writable}
        property={{ id: property.id, sqft: property.sqft, condition: property.condition, occupancy: property.occupancy, propertyType: property.propertyType, state: property.state, county: property.county, postalCode: property.postalCode }}
        report={detail.report ? { avm: detail.report.normalized.valuation.avm ?? null, arv: detail.report.normalized.arv.estimate ?? null, rent: detail.report.normalized.valuation.rentEstimate ?? null, payoff: detail.report.normalized.mortgages.reduce((a, m) => a + (m.estimatedBalance ?? 0), 0), taxAmount: detail.report.normalized.tax.taxAmount ?? null } : null}
        comps={detail.comps.map((c) => ({ address: c.address, soldPrice: c.soldPrice ? Number(c.soldPrice) : null, sqft: c.sqft, distanceMi: c.distanceMi ? Number(c.distanceMi) : null }))}
        siblings={siblings.map((s) => ({ id: s.id, version: s.version, name: s.name, status: s.status, outputs: s.outputs as any, inputs: s.inputs as any }))}
        initialTab={tab}
        canDelete={writable && !trashed && analysis.status !== "approved_for_offer"}
        deleteAction={deleteAnalysis.bind(null, id)}
      />
    </>
  );
}
