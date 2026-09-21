import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getAnalysis, matchBuyers, submissionsForAnalysis } from "@/lib/data/analyses";
import { isUuid } from "@/lib/safe";
import { recordSubmission } from "@/lib/actions/buyers";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, Input } from "@/components/ui/input";
import { money, fullName, percent, cn, shortDate } from "@/lib/utils";
import type { DealOutputs } from "@/lib/deal-run";

export const metadata = { title: "Match buyers" };

export default async function MatchPage({ params, searchParams }: { params: Promise<{ analysisId: string }>; searchParams: Promise<{ package?: string }> }) {
  const session = await requireSession();
  const { analysisId } = await params;
  const sp = await searchParams;
  const detail = await getAnalysis(session.orgId, analysisId);
  if (!detail) notFound();
  const out = detail.analysis.outputs as unknown as DealOutputs;
  const a = out.acquisitions;
  const investorBuyPrice = out.wholesale?.investorBuyPrice ?? 0;
  const arv = Number(out.effectiveArv ?? detail.analysis.arv ?? 0);
  const repairCosts = a?.repairCosts ?? 0;
  // Same formula as the deal package: what the end buyer keeps after buying at the investor price and running the flip.
  const buyerProfit = a ? arv - investorBuyPrice - repairCosts - a.financing.total - a.holding.total - a.buying.total - a.selling.total : 0;
  const deal = { state: detail.property.state, county: detail.property.county, postalCode: detail.property.postalCode, propertyType: detail.property.propertyType, condition: detail.property.condition, occupancy: detail.property.occupancy, investorBuyPrice, arv, repairCosts, buyerProfit };
  const packageId = isUuid(sp.package) ? sp.package : "";
  const [matches, sent] = await Promise.all([matchBuyers(session.orgId, deal), submissionsForAnalysis(session.orgId, analysisId)]);
  const writable = can(session, "buyer:write");
  return (
    <>
      <PageHeader crumbs={[{ label: "Deal Analyzer", href: "/analyzer" }, { label: `v${detail.analysis.version}`, href: `/analyzer/${analysisId}` }, { label: "Match buyers" }]} title={`Buyers for ${detail.property.addressLine1}`} description={`Investor price ${money(deal.investorBuyPrice)} · all in ${percent(deal.arv ? (deal.investorBuyPrice + deal.repairCosts) / deal.arv : 0)} of ARV · projected buyer profit ${money(deal.buyerProfit)} · ${detail.property.propertyType ?? "type unknown"} in ${detail.property.county ?? detail.property.city}`} />
      <div className="space-y-3">
        {matches.map((m) => (
          <Card key={m.buyer.id} className={cn(m.score < 50 && "opacity-70")}>
            <CardBody className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="w-14 shrink-0 text-center"><div className={cn("text-xl font-semibold num", m.score >= 80 ? "text-good" : m.score >= 50 ? "text-warn" : "text-fg-3")}>{m.score}</div><div className="text-[10px] text-fg-3 uppercase">fit</div></div>
              <div className="min-w-0 flex-1">
                <Link href={`/buyers/${m.buyer.id}`} className="font-medium hover:underline">{m.buyer.company ?? fullName(m.buyer)}</Link>
                <span className="text-xs text-fg-3 ml-2">{fullName(m.buyer)}{m.buyer.phones[0] ? ` · ${m.buyer.phones[0].number}` : ""}</span>
                <div className="flex flex-wrap gap-1 mt-1">{m.reasons.map((r) => <Badge key={r} tone="good">{r}</Badge>)}{m.misses.map((r) => <Badge key={r} tone="bad">{r}</Badge>)}</div>
                {m.criteria.buyingFormula ? <div className="text-xs text-fg-3 mt-1">Formula: {m.criteria.buyingFormula}</div> : null}
              </div>
              {sent.has(m.buyer.id) ? (
                <div className="shrink-0 text-xs text-fg-3 text-right"><Badge tone="info">Sent {sent.get(m.buyer.id)!.sentAt ? shortDate(sent.get(m.buyer.id)!.sentAt!) : ""}</Badge><div className="mt-1"><Link href={`/buyers/${m.buyer.id}`} className="text-brand hover:underline">Update response</Link></div></div>
              ) : writable ? (
                <ActionForm action={recordSubmission.bind(null, analysisId, m.buyer.id)} submitLabel="Mark sent" size="sm" variant="outline" inline className="flex items-center gap-1 shrink-0">
                  <input type="hidden" name="packageId" value={packageId} />
                  <Select name="sentVia" defaultValue="email" aria-label="Sent by" className="w-24 h-7 text-xs"><option value="email">Email</option><option value="text">Text</option><option value="phone">Phone</option></Select>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        ))}
        {matches.length === 0 ? <Card><CardBody className="text-[13px] text-fg-3">No buyers with criteria yet.</CardBody></Card> : null}
      </div>
    </>
  );
}
