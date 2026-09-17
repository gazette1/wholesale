import type { propertyReports } from "@dealcalc/db";
import { Card, CardHeader, CardBody, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyValue } from "@/components/ui/misc";
import { money, num, percent, shortDate } from "@/lib/utils";

type Report = typeof propertyReports.$inferSelect;

export function ReportSummary({ report }: { report: Report }) {
  const n = report.normalized;
  const mortgageBalance = n.mortgages.reduce((a, m) => a + (m.estimatedBalance ?? 0), 0);
  const equity = n.valuation.avm != null ? n.valuation.avm - mortgageBalance : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {report.status !== "ok" ? <div className="lg:col-span-2 rounded-md border border-[#f3d9b0] bg-warn-soft px-3 py-2 text-[13px] text-warn">Report {report.status}{report.error ? `: ${report.error}` : ""}</div> : null}
      <Card>
        <CardHeader title="Value and equity" />
        <CardBody>
          <Stat label="Estimated value (AVM)" value={money(n.valuation.avm) || "n/a"} hint={n.valuation.confidence != null ? `Confidence ${Math.round(n.valuation.confidence * 100)}%` : undefined} />
          <Stat label="Value range" value={n.valuation.avmLow != null ? `${money(n.valuation.avmLow)} to ${money(n.valuation.avmHigh)}` : "n/a"} />
          <Stat label="ARV estimate" value={money(n.arv.estimate) || "n/a"} hint={n.arv.method} />
          <Stat label="Rent estimate" value={n.valuation.rentEstimate ? `${money(n.valuation.rentEstimate)} / mo` : "n/a"} />
          <Stat label="Mortgage balance (est.)" value={money(mortgageBalance)} />
          <Stat label="Equity (est.)" value={equity != null ? money(equity) : "n/a"} tone={equity != null && equity > 0 ? "good" : undefined} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Ownership" />
        <CardBody>
          <Stat label="Owner" value={n.owner.names.join(", ") || "Unknown"} />
          <Stat label="Owner type" value={n.owner.ownerType ?? "unknown"} />
          <Stat label="Mailing address" value={n.owner.mailingAddress ?? "n/a"} />
          <Stat label="Owner occupied" value={n.owner.ownerOccupied == null ? "n/a" : n.owner.ownerOccupied ? "Yes" : "No"} />
          <Stat label="Absentee" value={n.owner.absentee == null ? "n/a" : n.owner.absentee ? "Yes" : "No"} tone={n.owner.absentee ? "warn" : undefined} />
          <Stat label="Years owned" value={n.owner.yearsOwned ?? "n/a"} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Distress signals" />
        <CardBody>
          {n.distress.flags.length === 0 ? <p className="text-[13px] text-fg-3">None reported.</p> : <div className="flex flex-wrap gap-1.5">{n.distress.flags.map((f) => <Badge key={f} tone="warn">{f.replace(/_/g, " ")}</Badge>)}</div>}
          {n.distress.foreclosureStage ? <p className="text-xs text-fg-3 mt-2">Foreclosure stage: {n.distress.foreclosureStage}</p> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Tax and assessment" />
        <CardBody>
          <Stat label="Assessed value" value={money(n.tax.assessedValue) || "n/a"} />
          <Stat label="Land / improvement" value={n.tax.assessedLand != null ? `${money(n.tax.assessedLand)} / ${money(n.tax.assessedImprovement)}` : "n/a"} />
          <Stat label="Annual tax" value={n.tax.taxAmount != null ? `${money(n.tax.taxAmount)} (${n.tax.taxYear ?? ""})` : "n/a"} />
          <Stat label="Delinquent" value={n.tax.delinquent == null ? "n/a" : n.tax.delinquent ? "Yes" : "No"} tone={n.tax.delinquent ? "bad" : undefined} />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Mortgages and liens" />
        <CardBody>
          {n.mortgages.length === 0 && n.liens.length === 0 ? <p className="text-[13px] text-fg-3">No recorded mortgages or liens.</p> : null}
          {n.mortgages.map((m, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[13px] py-1.5 border-b border-border/60 last:border-0">
              <span className="text-fg-3">Mortgage {m.position ?? i + 1}</span><span>{m.lender ?? "Unknown lender"}</span><span className="num">{money(m.amount)}</span><span className="num">{m.rate != null ? `${m.rate}%` : ""}</span><span>{m.originatedAt ? shortDate(m.originatedAt) : ""}</span><span className="num">{m.estimatedBalance != null ? `bal. ${money(m.estimatedBalance)}` : ""}</span>
            </div>
          ))}
          {n.liens.map((l, i) => (
            <div key={`l${i}`} className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[13px] py-1.5 border-b border-border/60 last:border-0">
              <span className="text-bad">Lien</span><span>{l.kind}</span><span className="num">{money(l.amount)}</span><span>{l.holder ?? ""}</span><span>{l.recordedAt ? shortDate(l.recordedAt) : ""}</span><span></span>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Property and transactions" />
        <CardBody>
          <KeyValue cols={4} items={[
            { label: "Type", value: n.characteristics.propertyType }, { label: "Beds / baths", value: n.characteristics.beds != null ? `${n.characteristics.beds} / ${n.characteristics.baths ?? "?"}` : null },
            { label: "Sq ft", value: n.characteristics.sqft ? num(n.characteristics.sqft) : null }, { label: "Lot sq ft", value: n.characteristics.lotSqft ? num(n.characteristics.lotSqft) : null },
            { label: "Year built", value: n.characteristics.yearBuilt }, { label: "Stories", value: n.characteristics.stories }, { label: "County", value: n.location.county }, { label: "Flood zone", value: n.location.floodZone },
          ]} />
          {n.transactions.length ? (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wide text-fg-3 mb-1">Sale history</div>
              {n.transactions.map((t, i) => <div key={i} className="flex justify-between text-[13px] py-1 border-b border-border/60 last:border-0"><span>{t.date ? shortDate(t.date) : "Unknown date"} {t.type ? `· ${t.type}` : ""}{t.buyer ? ` · ${t.buyer}` : ""}</span><span className="num">{money(t.price)}</span></div>)}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
