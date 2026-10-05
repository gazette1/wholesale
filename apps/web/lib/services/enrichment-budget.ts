import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { enrichmentSettings, propertyReports, activities, leads } from "@dealcalc/db";
import { propertyDataProvider } from "@dealcalc/integrations";
import { getDb } from "../db";
import { appDayBounds, dayKey, money } from "../utils";
import { enrichProperty } from "./enrichment";

export type EnrichmentSettings = { autoEnrichOnCreate: boolean; perLeadCapCents: number; monthlyBudgetCents: number };
/** Same values as the column defaults in packages/db/src/schema/enrichment.ts. */
export const ENRICHMENT_DEFAULTS: EnrichmentSettings = { autoEnrichOnCreate: false, perLeadCapCents: 100, monthlyBudgetCents: 5000 };

// TODO(phase2): take the per call price from the provider once RealEstateAPI pricing is confirmed. PropertyDataProvider exposes no price today, and the RealEstateAPI adapter records costCents 0 on every call, so the ledger and both caps stay at zero on live data until it reports a real cost.
const ESTIMATED_REPORT_COST_CENTS = 50;

/** Expected cost of one enrichProperty run (one lookup plus one comps call). The mock provider is free. */
export function estimatedReportCostCents(): number {
  return propertyDataProvider().name === "mock" ? 0 : ESTIMATED_REPORT_COST_CENTS;
}

export async function getEnrichmentSettings(orgId: string): Promise<EnrichmentSettings> {
  const db = await getDb();
  const row = await db.query.enrichmentSettings.findFirst({ where: eq(enrichmentSettings.orgId, orgId) });
  return row ? { autoEnrichOnCreate: row.autoEnrichOnCreate, perLeadCapCents: row.perLeadCapCents, monthlyBudgetCents: row.monthlyBudgetCents } : { ...ENRICHMENT_DEFAULTS };
}

/** Where the current calendar month starts in the app time zone. */
export function appMonthStart(now: Date = new Date()): Date {
  const [year, month] = dayKey(now).split("-").map(Number);
  // Noon UTC on the 1st is still the 1st in every US time zone, so appDayBounds lands on the right day.
  return appDayBounds(new Date(Date.UTC(year!, month! - 1, 1, 12))).start;
}

/** Spend read from the property_reports ledger. The per lead cap is measured per property, across all of its reports. */
export async function enrichmentSpend(orgId: string, propertyId?: string): Promise<{ monthCents: number; propertyCents: number; monthReports: number }> {
  const db = await getDb();
  const cents = sql<number>`coalesce(sum(${propertyReports.costCents}), 0)`.mapWith(Number);
  const [[month], [property]] = await Promise.all([
    db.select({ cents, n: count() }).from(propertyReports).where(and(eq(propertyReports.orgId, orgId), gte(propertyReports.fetchedAt, appMonthStart()))),
    propertyId ? db.select({ cents }).from(propertyReports).where(and(eq(propertyReports.orgId, orgId), eq(propertyReports.propertyId, propertyId))) : Promise.resolve([{ cents: 0 }]),
  ]);
  return { monthCents: month?.cents ?? 0, propertyCents: property?.cents ?? 0, monthReports: month?.n ?? 0 };
}

export type BudgetCheck = { allowed: true } | { allowed: false; reason: string };
const dollars = (cents: number) => money(cents / 100, { cents: true });
const RAISE = "An admin can raise it under Settings, Enrichment.";

// TODO(phase2): the check and the spend are not atomic, so two leads created in the same second can both pass. Decide whether a small overrun is acceptable or the check needs a lock.
export async function checkEnrichmentBudget(orgId: string, propertyId: string, estimatedCostCents: number): Promise<BudgetCheck> {
  const [settings, spend] = await Promise.all([getEnrichmentSettings(orgId), enrichmentSpend(orgId, propertyId)]);
  if (spend.monthCents >= settings.monthlyBudgetCents && estimatedCostCents > 0) return { allowed: false, reason: `This month's report budget of ${dollars(settings.monthlyBudgetCents)} is used up. ${RAISE}` };
  if (spend.monthCents + estimatedCostCents > settings.monthlyBudgetCents) return { allowed: false, reason: `A report costs about ${dollars(estimatedCostCents)} and only ${dollars(settings.monthlyBudgetCents - spend.monthCents)} is left in this month's report budget of ${dollars(settings.monthlyBudgetCents)}. ${RAISE}` };
  if (spend.propertyCents + estimatedCostCents > settings.perLeadCapCents) return { allowed: false, reason: `This property has used ${dollars(spend.propertyCents)} of its ${dollars(settings.perLeadCapCents)} per lead report limit, and another report costs about ${dollars(estimatedCostCents)}. ${RAISE}` };
  return { allowed: true };
}

export type AutoEnrichResult = { ran: true } | { ran: false; reason: string };

/** Called right after a lead is created. Never throws: a refused or failed report must not fail lead creation. */
export async function autoEnrichNewLead(orgId: string, propertyId: string, actorId: string | null): Promise<AutoEnrichResult> {
  try {
    const settings = await getEnrichmentSettings(orgId);
    if (!settings.autoEnrichOnCreate) return { ran: false, reason: "Automatic reports are off." };
    const check = await checkEnrichmentBudget(orgId, propertyId, estimatedReportCostCents());
    if (!check.allowed) {
      const db = await getDb();
      const lead = await db.query.leads.findFirst({ where: and(eq(leads.orgId, orgId), eq(leads.propertyId, propertyId)), orderBy: desc(leads.createdAt) });
      await db.insert(activities).values({ orgId, leadId: lead?.id ?? null, propertyId, actorId, type: "system", payload: { text: `Automatic property report skipped. ${check.reason}`, reason: "enrichment_budget" } });
      return { ran: false, reason: check.reason };
    }
    // TODO(phase2): decide whether a lead on a property that already has a recent report should reuse it instead of buying another.
    await enrichProperty(orgId, propertyId, actorId);
    return { ran: true };
  } catch (err) {
    console.error("[auto enrich]", err);
    return { ran: false, reason: "The property report could not be fetched." };
  }
}
