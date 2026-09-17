import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { properties, propertyReports, leads } from "@dealcalc/db";
import { getDb } from "@/lib/db";
import { requireSession, can } from "@/lib/auth";
import { propertyComps } from "@/lib/data/leads";
import { runEnrichment } from "@/lib/actions/leads";
import { ActionButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ReportSummary } from "@/components/report/report-summary";
import { money, num, shortDate, relative, addressLine } from "@/lib/utils";
import { RawJson } from "./raw";

export const metadata = { title: "Property report" };

export default async function PropertyReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const db = await getDb();
  const property = await db.query.properties.findFirst({ where: and(eq(properties.id, id), eq(properties.orgId, session.orgId)) });
  if (!property) notFound();
  const [reports, comps, lead] = await Promise.all([
    db.select().from(propertyReports).where(eq(propertyReports.propertyId, id)).orderBy(desc(propertyReports.fetchedAt)).limit(10),
    propertyComps(id),
    db.query.leads.findFirst({ where: eq(leads.propertyId, id), orderBy: desc(leads.createdAt) }),
  ]);
  const report = reports[0];
  const mapUrl = property.lat && property.lng ? `https://www.google.com/maps?q=${property.lat},${property.lng}` : `https://www.google.com/maps/search/${encodeURIComponent(addressLine(property))}`;
  const included = comps.filter((c) => c.included && c.soldPrice);
  const avgPerSqft = included.length ? included.reduce((a, c) => a + (c.sqft ? Number(c.soldPrice) / c.sqft : 0), 0) / included.filter((c) => c.sqft).length : null;
  return (
    <>
      <PageHeader crumbs={[{ label: "Leads", href: "/leads" }, ...(lead ? [{ label: property.addressLine1, href: `/leads/${lead.id}` }] : []), { label: "Property report" }]} title={property.addressLine1} description={`${property.city}, ${property.state} ${property.postalCode}${property.county ? ` · ${property.county} County` : ""}`}
        actions={<>
          <a href={mapUrl} target="_blank" rel="noreferrer" className="text-[13px] text-brand hover:underline">Open map</a>
          {can(session, "lead:write") ? <ActionButton action={runEnrichment.bind(null, id, lead?.id)} variant="primary" size="md">{report ? "Refresh from provider" : "Pull report"}</ActionButton> : null}
        </>} />
      {report ? (
        <>
          <p className="text-xs text-fg-3 mb-3">Pulled {relative(report.fetchedAt)} from {report.provider}{report.costCents ? ` · ${money(report.costCents / 100, { cents: true })}` : ""}{reports.length > 1 ? ` · ${reports.length} pulls on file` : ""}</p>
          <ReportSummary report={report} />
        </>
      ) : <Card><CardBody className="text-[13px] text-fg-3">No report yet. Pull one to see ownership, valuation, mortgages, liens, tax, and distress signals.</CardBody></Card>}

      <Card className="mt-4">
        <CardHeader title="Comparable sales" description={avgPerSqft ? `${included.length} included · average ${money(avgPerSqft)} per sq ft${property.sqft ? ` · implies ${money(avgPerSqft * property.sqft)} for ${num(property.sqft)} sq ft` : ""}` : "No comps yet"} />
        <CardBody className="p-0">
          {comps.length ? (
            <Table>
              <THead><tr><TH>Address</TH><TH right>Sold</TH><TH>Date</TH><TH right>Sq ft</TH><TH right>$/sq ft</TH><TH right>Beds</TH><TH right>Baths</TH><TH right>Dist. mi</TH><TH>Source</TH></tr></THead>
              <TBody>{comps.map((c) => (
                <TR key={c.id} className={!c.included ? "opacity-50" : ""}>
                  <TD>{c.address}</TD><TD right className="font-medium">{money(c.soldPrice)}</TD><TD>{c.soldAt ? shortDate(c.soldAt) : ""}</TD><TD right>{c.sqft ? num(c.sqft) : ""}</TD>
                  <TD right>{c.sqft && c.soldPrice ? money(Number(c.soldPrice) / c.sqft) : ""}</TD><TD right>{c.beds ?? ""}</TD><TD right>{c.baths ?? ""}</TD><TD right>{c.distanceMi ?? ""}</TD><TD className="text-fg-3">{c.source}</TD>
                </TR>
              ))}</TBody>
            </Table>
          ) : <p className="p-4 text-[13px] text-fg-3">Comps arrive with the report pull.</p>}
        </CardBody>
      </Card>

      {report && session.role === "admin" ? <RawJson raw={report.raw as Record<string, unknown>} normalized={report.normalized as unknown as Record<string, unknown>} /> : null}
    </>
  );
}
