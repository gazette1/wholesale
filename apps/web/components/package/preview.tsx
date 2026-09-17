import type { PackageData } from "@/lib/pdf/package-pdf";
import { money, percent, num } from "@/lib/utils";

/** HTML twin of the PDF so the preview and the public share page match the document. */
export function PackagePreview({ data }: { data: PackageData }) {
  const a = data.outputs.acquisitions;
  const w = data.outputs.wholesale;
  const color = data.branding.primaryColor ?? "#0f172a";
  const endBuyerProfit = data.inputs.arv - w.investorBuyPrice - a.repairCosts - a.financing.total - a.holding.total - a.buying.total - a.selling.total;
  return (
    <div className="rounded-lg border border-border bg-white shadow-[var(--shadow-card)] p-8 max-w-[820px] mx-auto text-[13px]">
      <div className="flex items-end justify-between border-b-2 pb-3 mb-5" style={{ borderColor: color }}>
        <div><div className="text-base font-bold" style={{ color }}>{data.branding.companyName ?? "Acquisitions Team"}</div><div className="text-xs text-fg-3">{[data.branding.phone, data.branding.email].filter(Boolean).join(" · ")}</div></div>
        <div className="text-xs text-fg-3">Investor deal package · {data.generatedAt}</div>
      </div>
      <h2 className="text-xl font-bold">{data.property.address}</h2>
      <div className="text-fg-3">{data.property.cityStateZip}{data.property.county ? ` · ${data.property.county} County` : ""}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {[["Investor price", money(w.investorBuyPrice), color], ["After repair value", money(data.inputs.arv)], ["Estimated repairs", money(a.repairCosts)], ["All in as % of ARV", percent(w.investorArvPct)]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-md border border-border p-2.5"><div className="text-[10px] text-fg-3">{l}</div><div className="text-lg font-bold num" style={c ? { color: c as string } : undefined}>{v}</div></div>
        ))}
      </div>
      {data.property.photos.length ? <div className="flex gap-2 mt-4 overflow-x-auto">{data.property.photos.slice(0, 3).map((p, i) => <img key={i} src={p.url} alt={p.caption ?? ""} className="h-28 w-40 object-cover rounded-md" />)}</div> : null}
      <Section title="Property summary">
        <div className="grid sm:grid-cols-2 gap-x-6">
          <Row l="Type" v={data.property.type ?? "n/a"} /><Row l="Year built" v={data.property.yearBuilt ?? "n/a"} />
          <Row l="Beds / baths" v={`${data.property.beds ?? "?"} / ${data.property.baths ?? "?"}`} /><Row l="Lot" v={data.property.lot ? `${num(data.property.lot)} sq ft` : "n/a"} />
          <Row l="Square feet" v={data.property.sqft ? num(data.property.sqft) : "n/a"} /><Row l="Hold estimate" v={`${data.inputs.holdMonths} months`} />
        </div>
        {data.summary ? <p className="mt-2 leading-relaxed">{data.summary}</p> : null}
      </Section>
      {data.sections.financials ? (
        <Section title="Flip projection for the end buyer">
          <div className="grid sm:grid-cols-2 gap-x-6">
            <div><Row l="Purchase from us" v={money(w.investorBuyPrice)} /><Row l="Repairs" v={money(a.repairCosts)} /><Row l="Financing and holding (est.)" v={money(a.financing.total + a.holding.total)} /><Row l="Buying and selling costs (est.)" v={money(a.buying.total + a.selling.total)} /></div>
            <div><Row l="Resale at ARV" v={money(data.inputs.arv)} /><Row l="Projected end buyer profit" v={<b>{money(endBuyerProfit)}</b>} /><Row l="Investor all in % of ARV" v={percent(w.investorArvPct)} /><Row l="Rent estimate (buy and hold)" v={data.outputs.buyAndHold ? `${money(data.outputs.buyAndHold.current.grossRents)} / mo` : "n/a"} /></div>
          </div>
        </Section>
      ) : null}
      {data.sections.rehab && data.rehab.length ? <Section title="Repair scope">{data.rehab.map((r, i) => <Row key={i} l={[r.question, r.option].filter(Boolean).join(": ")} v={money(r.total)} />)}<Row l={<b>Total</b>} v={<b>{money(a.repairCosts)}</b>} /></Section> : null}
      {data.sections.comps && data.comps.length ? (
        <Section title="Comparable sales">
          <table className="w-full text-xs"><thead><tr className="text-fg-3 border-b border-border-strong"><th className="text-left py-1">Address</th><th className="text-right">Sold</th><th className="text-right">Date</th><th className="text-right">Sq ft</th><th className="text-right">$/sf</th><th className="text-right">Miles</th></tr></thead>
            <tbody>{data.comps.slice(0, 8).map((c, i) => <tr key={i} className="border-b border-border/60"><td className="py-1">{c.address}</td><td className="text-right num">{money(c.soldPrice)}</td><td className="text-right">{c.soldAt ?? ""}</td><td className="text-right num">{c.sqft ? num(c.sqft) : ""}</td><td className="text-right num">{c.sqft && c.soldPrice ? money(c.soldPrice / c.sqft) : ""}</td><td className="text-right num">{c.distanceMi ?? ""}</td></tr>)}</tbody></table>
        </Section>
      ) : null}
      {data.sections.report && data.report ? (
        <Section title="Public record snapshot">
          <div className="grid sm:grid-cols-2 gap-x-6">
            <div><Row l="Estimated value" v={money(data.report.avm)} /><Row l="Assessed value" v={money(data.report.assessed)} /><Row l="Annual taxes" v={money(data.report.taxAmount)} /></div>
            <div><Row l="Years owned" v={data.report.yearsOwned ?? "n/a"} /><Row l="Last sale" v={data.report.lastSale ? `${data.report.lastSale.date ?? ""} ${money(data.report.lastSale.price)}` : "n/a"} /><Row l="Flags" v={data.report.flags.length ? data.report.flags.join(", ") : "none"} /></div>
          </div>
        </Section>
      ) : null}
      {data.sections.notes && data.notes ? <Section title="Notes"><p className="leading-relaxed whitespace-pre-wrap">{data.notes}</p></Section> : null}
      <div className="mt-8 border-t border-border pt-3 text-[10px] text-fg-3">{data.branding.disclosure ?? "All figures are estimates and not a guarantee of value or profit. Buyer to verify all information independently."}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mt-5"><div className="text-[11px] font-bold uppercase tracking-wide text-fg-3 mb-1.5">{title}</div>{children}</div>;
}
function Row({ l, v }: { l: React.ReactNode; v: React.ReactNode }) {
  return <div className="flex justify-between py-1 border-b border-border/60 last:border-0"><span className="text-fg-2">{l}</span><span className="num">{v}</span></div>;
}
