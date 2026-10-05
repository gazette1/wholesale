import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { getAnalysis, matchBuyers } from "@/lib/data/analyses";
import { getActiveWeights, matchTracking, criteriaFromRow, dealFromOutputs } from "@/lib/data/match-model";
import { matchedCriteria, weightedScore, CRITERIA_KEYS, type CriterionKey } from "@dealcalc/engine";
import { isUuid } from "@/lib/safe";
import { recordSubmission, retrainMatchModel, sendToAllMatched } from "@/lib/actions/buyers";
import { ActionForm, ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, Input } from "@/components/ui/input";
import { money, fullName, percent, cn, shortDate } from "@/lib/utils";
import type { DealOutputs } from "@/lib/deal-run";

export const metadata = { title: "Match buyers" };

const CRITERION_TITLES: Record<CriterionKey, string> = {
  state: "State", county: "County", price: "Price range", propertyType: "Property type",
  arvPct: "All-in % of ARV", condition: "Condition", occupancy: "Occupancy", zip: "Target ZIP", margin: "Buyer's minimum margin",
};

export default async function MatchPage({ params, searchParams }: { params: Promise<{ analysisId: string }>; searchParams: Promise<{ package?: string }> }) {
  const session = await requireSession();
  const { analysisId } = await params;
  const sp = await searchParams;
  const detail = await getAnalysis(session.orgId, analysisId);
  if (!detail) notFound();
  // Same formula as match-model.ts's dealFromOutputs and the deal package: kept identical so the score
  // shown here and the score used when actually sending line up.
  const deal = dealFromOutputs(detail.analysis.outputs as unknown as DealOutputs, detail.analysis.arv, {
    state: detail.property.state, county: detail.property.county, postalCode: detail.property.postalCode,
    propertyType: detail.property.propertyType, condition: detail.property.condition, occupancy: detail.property.occupancy,
  });
  const packageId = isUuid(sp.package) ? sp.package : "";
  const [rawMatches, tracking, model] = await Promise.all([
    matchBuyers(session.orgId, deal),
    matchTracking(session.orgId, analysisId),
    getActiveWeights(session.orgId),
  ]);
  const writable = can(session, "buyer:write");

  const matches = rawMatches
    .map((m) => ({ ...m, weightedScore: weightedScore(matchedCriteria(deal, criteriaFromRow(m.criteria)), model.weights) }))
    .sort((a, b) => b.weightedScore - a.weightedScore || (a.buyer.company ?? a.buyer.firstName).localeCompare(b.buyer.company ?? b.buyer.firstName));

  return (
    <>
      <PageHeader crumbs={[{ label: "Deal Analyzer", href: "/analyzer" }, { label: `v${detail.analysis.version}`, href: `/analyzer/${analysisId}` }, { label: "Match buyers" }]} title={`Buyers for ${detail.property.addressLine1}`} description={`Investor price ${money(deal.investorBuyPrice)} · all in ${percent(deal.arv ? (deal.investorBuyPrice + deal.repairCosts) / deal.arv : 0)} of ARV · projected buyer profit ${money(deal.buyerProfit)} · ${detail.property.propertyType ?? "type unknown"} in ${detail.property.county ?? detail.property.city}`} />

      <Card className="mb-4">
        <CardHeader
          title={<span className="flex items-center gap-2">Match model <Badge tone={model.source === "learned" ? "brand" : "neutral"}>{model.source === "learned" ? "Learned weights in use" : "Default weights in use"}</Badge></span>}
          description={model.source === "learned" ? `Trained on ${model.sampleSize} submissions with a response.` : `${model.sampleSize} submission${model.sampleSize === 1 ? "" : "s"} on file so far. Scores below use the fixed default weights until there is enough history to learn from.`}
          actions={writable ? <ActionButton action={retrainMatchModel} variant="outline" size="sm">Retrain</ActionButton> : null}
        />
        <CardBody className="grid gap-1.5 sm:grid-cols-2">
          {CRITERIA_KEYS.map((k) => (
            <div key={k} className="flex items-start justify-between gap-3 text-[12px] border-b border-border/60 last:border-0 py-1">
              <div className="min-w-0">
                <span className="font-medium text-fg-2">{CRITERION_TITLES[k]}</span>
                <p className="text-fg-3 mt-0.5">{model.explanations[k]}</p>
              </div>
              <span className="num text-fg shrink-0">{model.weights[k]}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      {writable ? (
        <Card className="mb-4">
          <CardHeader title="Send to all matched" description="Emails the deal package to every buyer at or above the score you pick. Each buyer gets its own tracked link. A buyer already sent this deal, with no email on file, is skipped and counted." />
          <CardBody>
            {packageId ? (
              <ActionForm action={sendToAllMatched.bind(null, analysisId)} submitLabel="Send" size="sm" variant="primary" inline className="flex items-center gap-2 flex-wrap">
                <input type="hidden" name="packageId" value={packageId} />
                <label className="text-[13px] text-fg-2 flex items-center gap-2">Minimum score <Input name="threshold" type="number" min={0} max={100} step={1} defaultValue={70} className="w-20" aria-label="Score threshold" /></label>
              </ActionForm>
            ) : <p className="text-[13px] text-fg-3">Create a deal package for this analysis first, then come back here to send it.</p>}
          </CardBody>
        </Card>
      ) : null}

      <div className="space-y-3">
        {matches.map((m) => {
          const sent = tracking.get(m.buyer.id);
          return (
            <Card key={m.buyer.id} className={cn(m.weightedScore < 50 && "opacity-70")}>
              <CardBody className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="w-14 shrink-0 text-center"><div className={cn("text-xl font-semibold num", m.weightedScore >= 80 ? "text-good" : m.weightedScore >= 50 ? "text-warn" : "text-fg-3")}>{m.weightedScore}</div><div className="text-[10px] text-fg-3 uppercase">fit</div></div>
                <div className="min-w-0 flex-1">
                  <Link href={`/buyers/${m.buyer.id}`} className="font-medium hover:underline">{m.buyer.company ?? fullName(m.buyer)}</Link>
                  <span className="text-xs text-fg-3 ml-2">{fullName(m.buyer)}{m.buyer.phones[0] ? ` · ${m.buyer.phones[0].number}` : ""}</span>
                  <div className="flex flex-wrap gap-1 mt-1">{m.reasons.map((r) => <Badge key={r} tone="good">{r}</Badge>)}{m.misses.map((r) => <Badge key={r} tone="bad">{r}</Badge>)}</div>
                  {m.criteria.buyingFormula ? <div className="text-xs text-fg-3 mt-1">Formula: {m.criteria.buyingFormula}</div> : null}
                </div>
                {sent ? (
                  <div className="shrink-0 text-xs text-fg-3 text-right">
                    <Badge tone="info">Sent {sent.sentAt ? shortDate(sent.sentAt) : ""}</Badge>
                    <div className="mt-1">{sent.openCount > 0 ? `Opened ${sent.firstOpenedAt ? shortDate(sent.firstOpenedAt) : ""} · ${sent.openCount} view${sent.openCount === 1 ? "" : "s"}` : "Not opened yet"}</div>
                    <div className="mt-1"><Link href={`/buyers/${m.buyer.id}`} className="text-brand hover:underline">Update response</Link></div>
                  </div>
                ) : writable ? (
                  <ActionForm action={recordSubmission.bind(null, analysisId, m.buyer.id)} submitLabel="Mark sent" size="sm" variant="outline" inline className="flex items-center gap-1 shrink-0">
                    <input type="hidden" name="packageId" value={packageId} />
                    <Select name="sentVia" defaultValue="email" aria-label="Sent by" className="w-24 h-7 text-xs"><option value="email">Email</option><option value="text">Text</option><option value="phone">Phone</option></Select>
                  </ActionForm>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
        {matches.length === 0 ? <Card><CardBody className="text-[13px] text-fg-3">No buyers with criteria yet.</CardBody></Card> : null}
      </div>
    </>
  );
}
