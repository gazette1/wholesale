import { and, desc, eq, max } from "drizzle-orm";
import { dealAnalyses, rehabLineItems, costDefaults, properties, propertyReports, leads } from "@dealcalc/db";
import { ENGINE_VERSION, DealInputSchema, type DealInput, type RehabLine } from "@dealcalc/engine";
import { runDeal, type DealOutputs } from "../deal-run";
export { runDeal, type DealOutputs };
import { REHAB_CHECKLIST } from "@dealcalc/db/seed";
import { getDb } from "../db";

/** Starting inputs for a new analysis: property facts, latest report, org unit costs, workbook style defaults. */
export async function buildDefaultInputs(orgId: string, propertyId: string): Promise<DealInput> {
  const db = await getDb();
  const [property, report, costs] = await Promise.all([
    db.query.properties.findFirst({ where: and(eq(properties.id, propertyId), eq(properties.orgId, orgId)) }),
    db.query.propertyReports.findFirst({ where: eq(propertyReports.propertyId, propertyId), orderBy: desc(propertyReports.fetchedAt) }),
    db.select().from(costDefaults).where(eq(costDefaults.orgId, orgId)).orderBy(costDefaults.rowNumber),
  ]);
  if (!property) throw new Error("Property not found.");
  const sqft = property.sqft ?? report?.normalized.characteristics.sqft ?? 1400;
  const arv = report?.normalized.arv.estimate ?? report?.normalized.valuation.avm ?? 200000;
  const asIs = report?.normalized.valuation.avm ?? Math.round(arv * 0.75);
  const lead = await db.query.leads.findFirst({ where: eq(leads.propertyId, propertyId), orderBy: desc(leads.createdAt) });
  type Base = { row: number; itemNumber: number | null; question: string | null; option: string | null; unitCost: number | null; perSqft: boolean };
  const base: Base[] = costs.length
    ? costs.map((c) => ({ row: c.rowNumber, itemNumber: c.itemNumber, question: c.question, option: c.option, unitCost: c.unitCost != null ? Number(c.unitCost) : null, perSqft: c.unit === "sqft" }))
    : REHAB_CHECKLIST.map((c) => ({ row: c.row, itemNumber: c.itemNumber, question: c.question, option: c.option, unitCost: c.unitCost, perSqft: c.perSqft ?? false }));
  const lines: RehabLine[] = base
    .map((c) => ({ row: c.row, itemNumber: c.itemNumber, question: c.question, option: c.option, answer: c.unitCost != null ? "No" : null, quantity: c.perSqft ? sqft : 1, unitCost: c.unitCost }));
  const repairEstimate = 0;
  const purchasePrice = lead?.askingPrice ? Number(lead.askingPrice) : Math.round(arv * 0.7 - repairEstimate - 10000);
  const payoff = report?.normalized.mortgages.reduce((a, m) => a + (m.estimatedBalance ?? 0), 0) ?? 0;
  return {
    meta: { name: "Base case", address: `${property.addressLine1}, ${property.city}, ${property.state} ${property.postalCode}` },
    rehab: { address: property.addressLine1, lines },
    acquisitions: {
      holdMonths: 4, asIsValue: asIs, purchasePrice, arv, repairCosts: repairEstimate, assignmentFee: -10000,
      firstLienAmount: purchasePrice, firstPointsRate: 0.03, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0.14 / 12,
      secondLienAmount: 0, secondPointsRate: 0, secondInterestRate: 0, secondMonthlyInterestOnlyRate: 0,
      miscLienAmountPaid: 0, miscPointsPaid: 0, miscInterestPaid: 0, miscMonthlyInterestOnlyPaid: 0, miscFinancingCosts: 0,
      propertyTaxRate: report?.normalized.tax.taxAmount && asIs ? Math.min(0.1, report.normalized.tax.taxAmount / asIs) : 0.022,
      hoaMonthly: 0, insuranceMonthly: 100, utilitiesMonthly: 0, gasMonthly: 75, waterMonthly: 40, electricityMonthly: 90, miscUtilitiesMonthly: 0,
      miscHoldingMonthly: [0, 0, 0, 0],
      buyEscrowRate: 0.005, buyTitleRate: 0.01, buyMiscRate: 0, sellEscrowRate: 0.005, sellRecordingRate: 0.0025, sellRealtorRate: 0.03, sellTransferRate: 0.0001,
      sellHomeWarranty: 0, sellStaging: 0, sellMarketing: 0, sellMisc: 0,
    },
    wholesale: { arv, repairCosts: repairEstimate, assignmentFee: 10000, purchasePrice, investorBuyPrice: null, closingCosts: 1500, holdingCosts: 0, existingMortgagePayoff: payoff, sellerClosingCosts: 0 },
    buyAndHold: {
      salePrice: purchasePrice, taxValue: report?.normalized.tax.assessedValue ?? asIs,
      units: [{ unit: 1, beds: property.beds ? Number(property.beds) : null, baths: property.baths ? Number(property.baths) : null, rent: report?.normalized.valuation.rentEstimate ?? Math.round(arv * 0.0075), marketRent: report?.normalized.valuation.rentEstimate ?? Math.round(arv * 0.0075) }],
      propertyTaxYear: report?.normalized.tax.taxAmount ?? Math.round(asIs * 0.011), insuranceMonth: 100, gasElectricMonth: 0, waterMonth: 0, sewerMonth: 0, garbageMonth: 0, lawnSnowMonth: 0,
      managementPct: 0.08, vacancyPct: 0.05, maintenancePct: 0.05, cashReservesPct: 0, downPaymentPct: 0.2, interestRate: 0.075, loanTermYears: 30, closingCosts: Math.round(purchasePrice * 0.03),
      improvedValueRatio: 0.8, marginalTaxRate: 0.24, appreciationRate: 0.03, rentGrowthRate: 0.03, dcrRequired: 1.25,
    },
  };
}

export async function nextVersion(propertyId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ v: max(dealAnalyses.version) }).from(dealAnalyses).where(eq(dealAnalyses.propertyId, propertyId));
  return (row?.v ?? 0) + 1;
}

/** Persist outputs, denormalized columns, and rehab lines for an analysis row. */
export async function persistAnalysis(id: string, orgId: string, inputs: DealInput) {
  const db = await getDb();
  const parsed = DealInputSchema.parse(inputs);
  const out = runDeal(parsed, { sensitivity: true });
  await db.update(dealAnalyses).set({
    inputs: parsed, outputs: out as unknown as Record<string, unknown>, engineVersion: ENGINE_VERSION,
    netProfit: out.acquisitions.netProfit.toFixed(2), maxAllowableOffer: out.wholesale.maxAllowableOffer.toFixed(2), spread: out.wholesale.spread.toFixed(2),
    arv: String(parsed.acquisitions.arv), purchasePrice: String(parsed.acquisitions.purchasePrice),
  }).where(eq(dealAnalyses.id, id));
  await db.delete(rehabLineItems).where(eq(rehabLineItems.analysisId, id));
  if (parsed.rehab.lines.length) {
    await db.insert(rehabLineItems).values(parsed.rehab.lines.map((l, i) => ({
      orgId, analysisId: id, rowNumber: l.row, itemNumber: l.itemNumber, question: l.question, option: l.option, answer: l.answer,
      quantity: l.quantity != null ? String(l.quantity) : null, unitCost: l.unitCost != null ? String(l.unitCost) : null, lineTotal: String(out.rehab.lineTotals[i] ?? 0),
    })));
  }
  return out;
}
