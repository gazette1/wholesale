import { and, desc, eq } from "drizzle-orm";
import { dealPackages, dealSubmissions, dealAnalyses, properties, orgs, propertyReports, comps, rehabLineItems } from "@dealcalc/db";
import { getDb } from "../db";
import type { PackageData } from "../pdf/package-pdf";
import type { DealOutputs } from "../deal-run";
import { shortDate } from "../utils";
import { isUuid } from "../safe";

/** Analysis notes are internal working notes, so a new package leaves them out until someone turns them on. */
export const DEFAULT_SECTIONS = { financials: true, comps: true, report: true, rehab: true, notes: false };
export const SECTION_LABELS: Record<keyof typeof DEFAULT_SECTIONS, string> = {
  financials: "Deal numbers for the buyer", comps: "Comparable sales", report: "Property facts", rehab: "Repair scope", notes: "Analysis notes (internal, read them before sharing)",
};

/** Everything the PDF and the preview page need, resolved from one package row. */
export async function packageData(pkgId: string, opts: { byToken?: boolean } = {}): Promise<{ pkg: typeof dealPackages.$inferSelect; data: PackageData; orgId: string; expired: boolean } | null> {
  if (opts.byToken ? !/^[A-Za-z0-9_-]{16,64}$/.test(pkgId) : !isUuid(pkgId)) return null;
  const db = await getDb();
  let pkg = await db.query.dealPackages.findFirst({ where: opts.byToken ? eq(dealPackages.shareToken, pkgId) : eq(dealPackages.id, pkgId) });
  if (!pkg && opts.byToken) {
    const submission = await db.query.dealSubmissions.findFirst({ where: eq(dealSubmissions.token, pkgId) });
    if (submission?.packageId) pkg = await db.query.dealPackages.findFirst({ where: and(eq(dealPackages.id, submission.packageId), eq(dealPackages.orgId, submission.orgId)) });
  }
  if (!pkg) return null;
  const expired = pkg.expiresAt != null && pkg.expiresAt < new Date();
  // Expiry closes the public link only. The owner can still open, extend, or re-enable the package.
  if (expired && opts.byToken) return null;
  const analysis = await db.query.dealAnalyses.findFirst({ where: eq(dealAnalyses.id, pkg.analysisId) });
  if (!analysis) return null;
  const [property, org, report, compRows, lines] = await Promise.all([
    db.query.properties.findFirst({ where: eq(properties.id, analysis.propertyId) }),
    db.query.orgs.findFirst({ where: eq(orgs.id, pkg.orgId) }),
    db.query.propertyReports.findFirst({ where: eq(propertyReports.propertyId, analysis.propertyId), orderBy: desc(propertyReports.fetchedAt) }),
    db.select().from(comps).where(and(eq(comps.propertyId, analysis.propertyId), eq(comps.included, true))).orderBy(comps.distanceMi),
    db.select().from(rehabLineItems).where(eq(rehabLineItems.analysisId, analysis.id)).orderBy(rehabLineItems.rowNumber),
  ]);
  if (!property) return null;
  const outputs = analysis.outputs as unknown as DealOutputs;
  const inputs = analysis.inputs;
  const sections = { ...DEFAULT_SECTIONS, ...(pkg.sections as Record<string, boolean>) };
  const data: PackageData = {
    branding: (org?.branding ?? {}) as PackageData["branding"],
    property: { address: property.addressLine1, cityStateZip: `${property.city}, ${property.state} ${property.postalCode}`, type: property.propertyType, beds: property.beds, baths: property.baths, sqft: property.sqft, yearBuilt: property.yearBuilt, lot: property.lotSqft, county: property.county, photos: property.photos },
    summary: property.notes,
    notes: analysis.notes,
    outputs: {
      acquisitions: {
        repairCosts: outputs.acquisitions?.repairCosts ?? 0,
        financing: { total: outputs.acquisitions?.financing?.total ?? 0 }, holding: { total: outputs.acquisitions?.holding?.total ?? 0 },
        buying: { total: outputs.acquisitions?.buying?.total ?? 0 }, selling: { total: outputs.acquisitions?.selling?.total ?? 0 },
      },
      wholesale: { investorBuyPrice: outputs.wholesale?.investorBuyPrice ?? 0, investorArvPct: outputs.wholesale?.investorArvPct ?? 0 },
      buyAndHold: outputs.buyAndHold ? { current: { grossRents: outputs.buyAndHold.current.grossRents } } : null,
    },
    inputs: { arv: outputs.effectiveArv ?? inputs.acquisitions.arv, repairCosts: outputs.acquisitions?.repairCosts ?? 0, investorBuyPrice: outputs.wholesale?.investorBuyPrice ?? 0, holdMonths: inputs.acquisitions.holdMonths },
    report: report ? { avm: report.normalized.valuation.avm, owner: report.normalized.owner.names[0], yearsOwned: report.normalized.owner.yearsOwned, taxAmount: report.normalized.tax.taxAmount, assessed: report.normalized.tax.assessedValue, flags: report.normalized.distress.flags.map((f) => f.replace(/_/g, " ")), rentEstimate: report.normalized.valuation.rentEstimate ?? null, lastSale: report.normalized.transactions[0] ? { date: report.normalized.transactions[0].date, price: report.normalized.transactions[0].price } : undefined } : null,
    comps: compRows.map((c) => ({ address: c.address, soldPrice: c.soldPrice ? Number(c.soldPrice) : null, soldAt: c.soldAt ? shortDate(c.soldAt) : null, sqft: c.sqft, distanceMi: c.distanceMi ? Number(c.distanceMi) : null })),
    sections: sections as PackageData["sections"],
    generatedAt: shortDate(new Date()),
    rehab: lines.filter((l) => Number(l.lineTotal) > 0).map((l) => ({ option: l.option, question: l.question, total: Number(l.lineTotal) })),
  };
  return { pkg, data, orgId: pkg.orgId, expired };
}
