import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from "@react-pdf/renderer";

export type PackageData = {
  branding: { companyName?: string; primaryColor?: string; disclosure?: string; phone?: string; email?: string; logoUrl?: string };
  property: { address: string; cityStateZip: string; type: string | null; beds: string | null; baths: string | null; sqft: number | null; yearBuilt: number | null; lot: number | null; county: string | null; photos: { url: string; caption?: string }[] };
  summary: string | null;
  notes: string | null;
  /**
   * Only what a buyer may see. The contract price, the spread, the max allowable offer, and the assignment fee are
   * left out on the server, so they never reach the component that renders the public page or the PDF.
   */
  outputs: {
    acquisitions: { repairCosts: number; financing: { total: number }; holding: { total: number }; buying: { total: number }; selling: { total: number } };
    wholesale: { investorBuyPrice: number; investorArvPct: number };
    buyAndHold: { current: { grossRents: number } } | null;
  };
  inputs: { arv: number; repairCosts: number; investorBuyPrice: number; holdMonths: number };
  report: { avm?: number; owner?: string; yearsOwned?: number; taxAmount?: number; assessed?: number; flags: string[]; rentEstimate?: number | null; lastSale?: { date?: string; price?: number } } | null;
  comps: { address: string; soldPrice: number | null; soldAt: string | null; sqft: number | null; distanceMi: number | null }[];
  sections: { financials: boolean; comps: boolean; report: boolean; rehab: boolean; notes: boolean };
  generatedAt: string;
  rehab: { option: string | null; question: string | null; total: number }[];
};

const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v));
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(1)}%`);

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a18" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, paddingBottom: 8, marginBottom: 14 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 10, color: "#55534d" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, color: "#55534d" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e6e4df" },
  kpis: { flexDirection: "row", gap: 8, marginTop: 6 },
  kpi: { flex: 1, borderWidth: 1, borderColor: "#e6e4df", borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 8, color: "#8a877f" },
  kpiValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", paddingRight: 12 },
  small: { fontSize: 8, color: "#8a877f" },
  photo: { width: 160, height: 110, objectFit: "cover", borderRadius: 4, marginRight: 8, marginBottom: 8 },
  table: { marginTop: 4 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#d4d1ca", paddingBottom: 3, marginBottom: 2 },
  td: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#eeece7" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: "#8a877f", borderTopWidth: 0.5, borderTopColor: "#e6e4df", paddingTop: 6 },
});

export function PackageDocument({ data }: { data: PackageData }) {
  const a = data.outputs.acquisitions;
  const w = data.outputs.wholesale;
  const color = data.branding.primaryColor ?? "#0f172a";
  return (
    <Document title={`Deal package: ${data.property.address}`} author={data.branding.companyName ?? "Acquisitions"}>
      <Page size="LETTER" style={s.page}>
        <View style={[s.header, { borderBottomColor: color }]}>
          <View>
            <Text style={[s.brand, { color }]}>{data.branding.companyName ?? "Acquisitions Team"}</Text>
            <Text style={s.sub}>{[data.branding.phone, data.branding.email].filter(Boolean).join(" · ")}</Text>
          </View>
          <Text style={s.sub}>Investor deal package · {data.generatedAt}</Text>
        </View>

        <Text style={s.h1}>{data.property.address}</Text>
        <Text style={s.sub}>{data.property.cityStateZip}{data.property.county ? ` · ${data.property.county} County` : ""}</Text>

        <View style={s.kpis}>
          <View style={s.kpi}><Text style={s.kpiLabel}>Investor price</Text><Text style={[s.kpiValue, { color }]}>{usd(w.investorBuyPrice)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>After repair value</Text><Text style={s.kpiValue}>{usd(data.inputs.arv)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Estimated repairs</Text><Text style={s.kpiValue}>{usd(a.repairCosts)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>All in as % of ARV</Text><Text style={s.kpiValue}>{pct(w.investorArvPct)}</Text></View>
        </View>

        {data.property.photos.length ? (
          <View style={[s.grid, { marginTop: 12 }]}>
            {data.property.photos.slice(0, 3).map((p, i) => <Image key={i} src={p.url} style={s.photo} />)}
          </View>
        ) : null}

        <Text style={s.h2}>Property summary</Text>
        <View style={s.grid}>
          <View style={s.cell}><View style={s.row}><Text>Type</Text><Text>{data.property.type ?? "n/a"}</Text></View><View style={s.row}><Text>Beds / baths</Text><Text>{data.property.beds ?? "?"} / {data.property.baths ?? "?"}</Text></View><View style={s.row}><Text>Square feet</Text><Text>{data.property.sqft?.toLocaleString() ?? "n/a"}</Text></View></View>
          <View style={s.cell}><View style={s.row}><Text>Year built</Text><Text>{data.property.yearBuilt ?? "n/a"}</Text></View><View style={s.row}><Text>Lot</Text><Text>{data.property.lot ? `${data.property.lot.toLocaleString()} sq ft` : "n/a"}</Text></View><View style={s.row}><Text>Hold estimate</Text><Text>{data.inputs.holdMonths} months</Text></View></View>
        </View>
        {data.summary ? <Text style={{ marginTop: 6, lineHeight: 1.4 }}>{data.summary}</Text> : null}

        {data.sections.financials ? (
          <>
            <Text style={s.h2}>Flip projection for the end buyer</Text>
            <View style={s.grid}>
              <View style={s.cell}>
                <View style={s.row}><Text>Purchase from us</Text><Text>{usd(w.investorBuyPrice)}</Text></View>
                <View style={s.row}><Text>Repairs</Text><Text>{usd(a.repairCosts)}</Text></View>
                <View style={s.row}><Text>Financing and holding (est.)</Text><Text>{usd(a.financing.total + a.holding.total)}</Text></View>
                <View style={s.row}><Text>Buying and selling costs (est.)</Text><Text>{usd(a.buying.total + a.selling.total)}</Text></View>
              </View>
              <View style={s.cell}>
                <View style={s.row}><Text>Resale at ARV</Text><Text>{usd(data.inputs.arv)}</Text></View>
                <View style={s.row}><Text>Projected end buyer profit</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{usd(data.inputs.arv - w.investorBuyPrice - a.repairCosts - a.financing.total - a.holding.total - a.buying.total - a.selling.total)}</Text></View>
                <View style={s.row}><Text>Investor all in % of ARV</Text><Text>{pct(w.investorArvPct)}</Text></View>
                <View style={s.row}><Text>Rent estimate (buy and hold)</Text><Text>{data.outputs.buyAndHold ? `${usd(data.outputs.buyAndHold.current.grossRents)} / mo` : data.report?.rentEstimate ? `${usd(data.report.rentEstimate)} / mo` : "n/a"}</Text></View>
              </View>
            </View>
          </>
        ) : null}

        {data.sections.rehab && data.rehab.length ? (
          <>
            <Text style={s.h2}>Repair scope</Text>
            {data.rehab.map((r, i) => <View key={i} style={s.row}><Text>{[r.question, r.option].filter(Boolean).join(": ")}</Text><Text>{usd(r.total)}</Text></View>)}
            <View style={s.row}><Text style={{ fontFamily: "Helvetica-Bold" }}>Total</Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{usd(a.repairCosts)}</Text></View>
          </>
        ) : null}

        {data.sections.comps && data.comps.length ? (
          <>
            <Text style={s.h2}>Comparable sales</Text>
            <View style={s.table}>
              <View style={s.th}><Text style={{ flex: 3 }}>Address</Text><Text style={{ flex: 1, textAlign: "right" }}>Sold</Text><Text style={{ flex: 1, textAlign: "right" }}>Date</Text><Text style={{ flex: 1, textAlign: "right" }}>Sq ft</Text><Text style={{ flex: 1, textAlign: "right" }}>$/sf</Text><Text style={{ flex: 1, textAlign: "right" }}>Miles</Text></View>
              {data.comps.slice(0, 8).map((c, i) => <View key={i} style={s.td}><Text style={{ flex: 3 }}>{c.address}</Text><Text style={{ flex: 1, textAlign: "right" }}>{usd(c.soldPrice)}</Text><Text style={{ flex: 1, textAlign: "right" }}>{c.soldAt ?? ""}</Text><Text style={{ flex: 1, textAlign: "right" }}>{c.sqft?.toLocaleString() ?? ""}</Text><Text style={{ flex: 1, textAlign: "right" }}>{c.sqft && c.soldPrice ? usd(c.soldPrice / c.sqft) : ""}</Text><Text style={{ flex: 1, textAlign: "right" }}>{c.distanceMi ?? ""}</Text></View>)}
            </View>
          </>
        ) : null}

        {data.sections.report && data.report ? (
          <>
            <Text style={s.h2}>Public record snapshot</Text>
            <View style={s.grid}>
              <View style={s.cell}><View style={s.row}><Text>Estimated value</Text><Text>{usd(data.report.avm)}</Text></View><View style={s.row}><Text>Assessed value</Text><Text>{usd(data.report.assessed)}</Text></View><View style={s.row}><Text>Annual taxes</Text><Text>{usd(data.report.taxAmount)}</Text></View></View>
              <View style={s.cell}><View style={s.row}><Text>Years owned</Text><Text>{data.report.yearsOwned ?? "n/a"}</Text></View><View style={s.row}><Text>Last sale</Text><Text>{data.report.lastSale ? `${data.report.lastSale.date ?? ""} ${usd(data.report.lastSale.price)}` : "n/a"}</Text></View><View style={s.row}><Text>Flags</Text><Text>{data.report.flags.length ? data.report.flags.join(", ") : "none"}</Text></View></View>
            </View>
          </>
        ) : null}

        {data.sections.notes && data.notes ? (<><Text style={s.h2}>Notes</Text><Text style={{ lineHeight: 1.4 }}>{data.notes}</Text></>) : null}

        <View style={s.footer} fixed>
          <Text>{data.branding.disclosure ?? "All figures are estimates and not a guarantee of value or profit. Buyer to verify all information independently."}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderPackagePdf(data: PackageData): Promise<Buffer> {
  return renderToBuffer(<PackageDocument data={data} />);
}
