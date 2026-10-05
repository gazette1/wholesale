import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { reportsData, marketAnalytics, reportRange, parseRangeKey, RANGE_KEYS, RANGE_LABELS, type RangeKey, type ReportRange } from "@/lib/data/reports";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LinkButton } from "@/components/ui/button";
import { MarketTable } from "./market-table";
import { money, percent, num, shortDate, dayKey, cn } from "@/lib/utils";
import { SourceFunnelChart } from "./charts";
import { BarChart3, Download } from "lucide-react";

export const metadata = { title: "Reports" };

const TABS = [{ key: "overview", label: "Overview" }, { key: "market", label: "Market analytics" }] as const;
type TabKey = (typeof TABS)[number]["key"];

function minutes(v: number | null): React.ReactNode {
  if (v === null) return <Missing reason="No lead in this range has a recorded first response." />;
  return v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`;
}

/** A figure that cannot be computed yet. The reason shows on hover and to screen readers. */
function Missing({ reason, label = "Not available yet" }: { reason: string; label?: string }) {
  return <span className="text-fg-3" title={reason}>{label}<span className="sr-only">. {reason}</span></span>;
}

/** A CSV download for one report section, through the shared export route. */
function ExportButton({ href }: { href: string }) {
  return <LinkButton external href={href} variant="outline" size="sm"><Download className="h-3.5 w-3.5" />Export CSV</LinkButton>;
}

/** Leads list behind a number, bounded to the same range so the two pages' counts agree. */
function leadsHref(rangeKey: RangeKey, range: ReportRange, params: Record<string, string>): string {
  const bounds: Record<string, string> = rangeKey === "all" ? {} : { createdFrom: dayKey(range.from), createdTo: dayKey(range.to) };
  return `/leads?${new URLSearchParams({ status: "all", ...bounds, ...params }).toString()}`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; tab?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const rangeKey = parseRangeKey(typeof sp.range === "string" ? sp.range : undefined);
  const range = reportRange(rangeKey);
  const tab: TabKey = sp.tab === "market" ? "market" : "overview";
  const tabHref = (t: TabKey) => `/reports?range=${rangeKey}&tab=${t}`;
  const exportHref = (entity: string) => `/api/export/${entity}.csv?range=${rangeKey}`;

  return (
    <>
      <PageHeader title="Reports" description={`${RANGE_LABELS[rangeKey]}${rangeKey === "all" ? "" : `, leads created since ${shortDate(range.from)}`}.`} />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex gap-1.5 text-xs">
          {TABS.map((t) => <Link key={t.key} href={tabHref(t.key)} aria-current={t.key === tab ? "page" : undefined} className={cn("rounded-full border border-border px-2.5 py-1 hover:bg-surface-2", t.key === tab ? "bg-surface-2 text-fg font-medium" : "bg-surface text-fg-2")}>{t.label}</Link>)}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-fg-3 mr-1 self-center">Range:</span>
          {RANGE_KEYS.map((k) => <Link key={k} href={`/reports?range=${k}&tab=${tab}`} aria-current={k === rangeKey ? "page" : undefined} className={cn("rounded-full border border-border px-2.5 py-1 hover:bg-surface-2", k === rangeKey ? "bg-surface-2 text-fg font-medium" : "bg-surface text-fg-2")}>{RANGE_LABELS[k]}</Link>)}
        </div>
      </div>

      {tab === "market" ? <MarketTab orgId={session.orgId} range={range} exportHref={exportHref} /> : <OverviewTab orgId={session.orgId} range={range} rangeKey={rangeKey} exportHref={exportHref} />}
    </>
  );
}

async function OverviewTab({ orgId, range, rangeKey, exportHref }: { orgId: string; range: ReportRange; rangeKey: RangeKey; exportHref: (entity: string) => string }) {
  const data = await reportsData(orgId, range);
  const cost = data.costPerContract;
  const o = data.offersToContracts;
  const numLink = (href: string | null, n: number) => (href && n > 0 ? <Link href={href} className="text-brand hover:underline">{num(n)}</Link> : num(n));

  if (data.totalLeads === 0) return <EmptyState icon={BarChart3} title="No leads in this range" description="Reports are built from leads created in the selected range. Pick a longer range or add a lead." action={<LinkButton href="/reports?range=all" variant="outline">Show all time</LinkButton>} />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-3">{num(data.totalLeads)} {data.totalLeads === 1 ? "lead" : "leads"} in this range. Linked numbers open the leads list filtered the same way, and to the same date range.</p>

      <Card className="min-w-0">
        <CardHeader title="Speed to contact by user" description="Minutes from lead creation to the first conversation. Shares are out of all leads in range, reached or not." actions={<ExportButton href={exportHref("reports-speed-to-contact")} />} />
        <CardBody className="p-0">
          <Table>
            <THead><tr><TH>Owner</TH><TH right>Leads</TH><TH right>Not yet contacted</TH><TH right>Median</TH><TH right>Average</TH><TH right>Within 5 min</TH><TH right>Within 60 min</TH></tr></THead>
            <TBody>
              {data.speedToContact.map((r) => (
                <TR key={r.userId ?? "unassigned"}>
                  <TD>{r.name}</TD>
                  <TD right>{numLink(leadsHref(rangeKey, range, { assigned: r.userId ?? "unassigned" }), r.leads)}</TD>
                  <TD right>{num(r.notContacted)}</TD>
                  <TD right>{minutes(r.medianMinutes)}</TD>
                  <TD right>{minutes(r.averageMinutes)}</TD>
                  <TD right>{percent(r.within5)}</TD>
                  <TD right>{percent(r.within60)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <Card className="lg:col-span-2 min-w-0">
          <CardHeader title="Conversion by source" description="A contract is a lead whose stage history ever reached under contract, due diligence, or closed. Fell out counts those that reached one of those stages and later left it." actions={<ExportButton href={exportHref("reports-conversion-by-source")} />} />
          <CardBody className="p-0">
            <Table>
              <THead><tr><TH>Source</TH><TH right>Leads</TH><TH right>Contacted</TH><TH right>Offers made</TH><TH right>Contracts</TH><TH right>Fell out</TH><TH right>Closed</TH><TH right>Lead to contract</TH></tr></THead>
              <TBody>
                {data.conversionBySource.map((r) => {
                  const href = (params: Record<string, string> = {}) => (r.sourceId ? leadsHref(rangeKey, range, { source: r.source, ...params }) : null);
                  return (
                    <TR key={r.sourceId ?? "none"}>
                      <TD>{r.source}</TD>
                      <TD right>{numLink(href(), r.leads)}</TD>
                      <TD right>{num(r.contacted)}</TD>
                      <TD right>{num(r.offersMade)}</TD>
                      <TD right>{numLink(href({ stage: "under_contract,due_diligence,closed" }), r.contracts)}</TD>
                      <TD right>{num(r.fellOut)}</TD>
                      <TD right>{numLink(href({ status: "won" }), r.closed)}</TD>
                      <TD right>{percent(r.leadToContract)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Leads and contracts" description="Ten largest sources" />
          <CardBody><SourceFunnelChart data={data.conversionBySource.map((r) => ({ source: r.source, leads: r.leads, contracts: r.contracts }))} /></CardBody>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader title="Cost per contract" description="Lead spend is leads times the cost per lead set on the source. Property report spend is shown on its own line and is not spread across sources." actions={<ExportButton href={exportHref("reports-cost-per-contract")} />} />
        <CardBody className="p-0">
          <Table>
            <THead><tr><TH>Source</TH><TH right>Leads</TH><TH right>Cost per lead</TH><TH right>Spend</TH><TH right>Contracts</TH><TH right>Cost per contract</TH></tr></THead>
            <TBody>
              {cost.rows.map((r) => (
                <TR key={r.sourceId ?? "none"}>
                  <TD>{r.source}</TD>
                  <TD right>{num(r.leads)}</TD>
                  <TD right>{r.costPerLead === null ? (r.sourceId ? <Link href="/settings?tab=pipeline" className="text-brand hover:underline">No cost set</Link> : <span className="text-fg-3">No cost set</span>) : money(r.costPerLead, { cents: true })}</TD>
                  <TD right>{r.spend === null ? <span className="text-fg-3">No cost set</span> : money(r.spend)}</TD>
                  <TD right>{num(r.contracts)}</TD>
                  <TD right>{r.spend === null ? <span className="text-fg-3">No cost set</span> : r.costPerContract === null ? <span className="text-fg-3">No contracts yet</span> : money(r.costPerContract)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="px-4 py-3 border-t border-border grid gap-x-8 sm:grid-cols-2">
            <Stat label="Lead spend, sources with a cost" value={money(cost.totalSpend)} hint={cost.sourcesWithoutCost ? `${cost.sourcesWithoutCost} of ${cost.rows.length} sources have no cost per lead and are left out.` : undefined} />
            <Stat label="Blended cost per contract" value={cost.blendedCostPerContract === null ? <Missing label="No contracts yet" reason="No source with a cost per lead has a contract in this range." /> : money(cost.blendedCostPerContract)} />
            <Stat label="Property report spend" value={money(cost.enrichmentSpendCents / 100, { cents: true })} hint="Sum of the recorded cost of every property report fetched in this range." />
            <Stat label="Property reports fetched" value={num(cost.enrichmentReports)} />
          </div>
        </CardBody>
      </Card>

      <Card className="min-w-0 max-w-2xl">
        <CardHeader title="Offers to contracts" description="Offers other than drafts, dated by when they were sent. Counts are by current status." actions={<div className="flex items-center gap-2"><Link href={leadsHref(rangeKey, range, { offer: "sent" })} className="text-xs text-brand hover:underline">Leads with an offer out</Link><ExportButton href={exportHref("reports-offers-to-contracts")} /></div>} />
        <CardBody>
          {o.made === 0 ? <p className="text-xs text-fg-3">No offers were sent in this range.</p> : (
            <>
              <Stat label="Offers made" value={num(o.made)} />
              <Stat label="Awaiting seller response" value={num(o.awaiting)} />
              <Stat label="Accepted" value={num(o.accepted)} tone={o.accepted > 0 ? "good" : undefined} />
              <Stat label="Countered" value={num(o.countered)} />
              <Stat label="Rejected" value={num(o.rejected)} />
              <Stat label="Expired" value={num(o.expired)} />
              <Stat label="Acceptance rate" value={percent(o.acceptanceRate)} hint="Accepted offers over all offers made, including those still awaiting a response." />
              <Stat label="Average days, first sent offer to accepted" value={o.avgDaysToAccept === null ? <Missing reason={o.accepted === 0 ? "No accepted offers in this range." : "The accepted offers in this range have no recorded acceptance time."} /> : `${o.avgDaysToAccept.toFixed(1)} days`} hint={o.avgDaysToAccept === null ? undefined : `Based on ${o.acceptedMeasured} of ${o.accepted} accepted offers that have a sent date and a recorded acceptance.`} />
              {o.avgDaysToAccept === null ? <p className="text-xs text-fg-3 mt-2">{o.accepted === 0 ? "Average days to accepted needs at least one accepted offer." : "Average days to accepted needs the acceptance to be recorded in the app. Offers imported or seeded as accepted have no acceptance time."}</p> : null}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

async function MarketTab({ orgId, range, exportHref }: { orgId: string; range: ReportRange; exportHref: (entity: string) => string }) {
  const data = await marketAnalytics(orgId, range);
  if (data.byCounty.length === 0 && data.byZip.length === 0) return <EmptyState icon={BarChart3} title="No leads in this range" description="Market analytics is built from leads created in the selected range. Pick a longer range or add a lead." action={<LinkButton href="/reports?range=all&tab=market" variant="outline">Show all time</LinkButton>} />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-3">Rows with fewer than 5 leads are marked "small sample": a rate computed from a handful of leads is not a reliable read on that area.</p>
      <Card className="min-w-0">
        <CardHeader title="By county" description="Average spread and average assignment fee use the primary analysis on each property, where one exists." actions={<ExportButton href={exportHref("reports-market-by-county")} />} />
        <CardBody className="p-0"><MarketTable rows={data.byCounty} emptyLabel="No leads in this range." /></CardBody>
      </Card>
      <Card className="min-w-0">
        <CardHeader title="By zip" description="Same figures, one row per zip code." actions={<ExportButton href={exportHref("reports-market-by-zip")} />} />
        <CardBody className="p-0"><MarketTable rows={data.byZip} emptyLabel="No leads in this range." /></CardBody>
      </Card>
    </div>
  );
}
