import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { dealAnalyses, properties, leads, profiles, propertyReports, comps, buyers, buyerCriteria } from "@dealcalc/db";
import { getDb } from "../db";

export type AnalysisScope = "active" | "archived" | "trash";
export type AnalysisListFilter = { status?: string; scope?: AnalysisScope; q?: string; strategy?: string; sort?: string };

const SORTS = {
  updated: [desc(dealAnalyses.updatedAt)], created: [desc(dealAnalyses.createdAt)], address: [asc(properties.addressLine1), asc(dealAnalyses.version)],
  spread: [sql`${dealAnalyses.spread} desc nulls last`], profit: [sql`${dealAnalyses.netProfit} desc nulls last`], arv: [sql`${dealAnalyses.arv} desc nulls last`],
} as const;
export const ANALYSIS_SORTS: { key: keyof typeof SORTS; label: string }[] = [
  { key: "updated", label: "Recently updated" }, { key: "created", label: "Newest first" }, { key: "address", label: "Address" },
  { key: "spread", label: "Largest spread" }, { key: "profit", label: "Largest flip profit" }, { key: "arv", label: "Highest ARV" },
];

/** The analyzer library. Scope works like a mail client: active, archived, or trash. */
export async function listAnalyses(orgId: string, filter: AnalysisListFilter = {}) {
  const db = await getDb();
  const scope = filter.scope ?? "active";
  const conds = [eq(dealAnalyses.orgId, orgId)];
  if (scope === "trash") conds.push(isNotNull(dealAnalyses.trashedAt));
  else { conds.push(isNull(dealAnalyses.trashedAt)); conds.push(scope === "archived" ? isNotNull(dealAnalyses.archivedAt) : isNull(dealAnalyses.archivedAt)); }
  if (filter.status && filter.status !== "all" && ["draft", "reviewing", "approved_for_offer", "rejected"].includes(filter.status)) conds.push(eq(dealAnalyses.status, filter.status as "draft"));
  if (filter.strategy && ["wholesale", "flip", "rental"].includes(filter.strategy)) conds.push(eq(dealAnalyses.strategy, filter.strategy));
  const q = filter.q?.trim();
  if (q) {
    // Escape LIKE wildcards so a typed percent sign or underscore is matched literally.
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    conds.push(or(ilike(properties.addressLine1, like), ilike(properties.city, like), ilike(properties.postalCode, like), ilike(dealAnalyses.name, like))!);
  }
  const order = SORTS[(filter.sort ?? "updated") as keyof typeof SORTS] ?? SORTS.updated;
  return db.select({
    id: dealAnalyses.id, version: dealAnalyses.version, name: dealAnalyses.name, status: dealAnalyses.status, isPrimary: dealAnalyses.isPrimary, updatedAt: dealAnalyses.updatedAt,
    netProfit: dealAnalyses.netProfit, maxAllowableOffer: dealAnalyses.maxAllowableOffer, spread: dealAnalyses.spread, arv: dealAnalyses.arv, purchasePrice: dealAnalyses.purchasePrice,
    strategy: dealAnalyses.strategy, archivedAt: dealAnalyses.archivedAt, trashedAt: dealAnalyses.trashedAt,
    propertyId: properties.id, address: properties.addressLine1, city: properties.city, state: properties.state, leadId: dealAnalyses.leadId, createdBy: profiles.fullName,
  }).from(dealAnalyses).innerJoin(properties, eq(dealAnalyses.propertyId, properties.id)).leftJoin(profiles, eq(dealAnalyses.createdBy, profiles.id))
    .where(and(...conds)).orderBy(...order).limit(300);
}

export async function analysisScopeCounts(orgId: string): Promise<Record<AnalysisScope, number>> {
  const db = await getDb();
  const [row] = await db.select({
    active: sql<number>`count(*) filter (where ${dealAnalyses.trashedAt} is null and ${dealAnalyses.archivedAt} is null)::int`,
    archived: sql<number>`count(*) filter (where ${dealAnalyses.trashedAt} is null and ${dealAnalyses.archivedAt} is not null)::int`,
    trash: sql<number>`count(*) filter (where ${dealAnalyses.trashedAt} is not null)::int`,
  }).from(dealAnalyses).where(eq(dealAnalyses.orgId, orgId));
  return { active: Number(row?.active ?? 0), archived: Number(row?.archived ?? 0), trash: Number(row?.trash ?? 0) };
}

/** Open leads to start an analysis from, newest first, with how many analyses each property already has. */
export async function leadsForAnalysis(orgId: string) {
  const db = await getDb();
  return db.select({
    leadId: leads.id, propertyId: properties.id, address: properties.addressLine1, city: properties.city, state: properties.state,
    analyses: sql<number>`(select count(*) from ${dealAnalyses} da where da.property_id = ${properties.id} and da.trashed_at is null)::int`,
  }).from(leads).innerJoin(properties, eq(leads.propertyId, properties.id)).where(and(eq(leads.orgId, orgId), eq(leads.status, "open"))).orderBy(desc(leads.createdAt)).limit(500);
}

export async function getAnalysis(orgId: string, id: string) {
  const db = await getDb();
  const analysis = await db.query.dealAnalyses.findFirst({ where: and(eq(dealAnalyses.id, id), eq(dealAnalyses.orgId, orgId)) });
  if (!analysis) return null;
  const [property, lead, siblings, report, compRows] = await Promise.all([
    db.query.properties.findFirst({ where: eq(properties.id, analysis.propertyId) }),
    analysis.leadId ? db.query.leads.findFirst({ where: eq(leads.id, analysis.leadId) }) : null,
    db.select({ id: dealAnalyses.id, version: dealAnalyses.version, name: dealAnalyses.name, status: dealAnalyses.status, isPrimary: dealAnalyses.isPrimary, netProfit: dealAnalyses.netProfit, spread: dealAnalyses.spread, maxAllowableOffer: dealAnalyses.maxAllowableOffer, purchasePrice: dealAnalyses.purchasePrice, arv: dealAnalyses.arv, outputs: dealAnalyses.outputs, inputs: dealAnalyses.inputs })
      .from(dealAnalyses).where(and(eq(dealAnalyses.propertyId, analysis.propertyId), eq(dealAnalyses.orgId, orgId), or(isNull(dealAnalyses.trashedAt), eq(dealAnalyses.id, id)))).orderBy(asc(dealAnalyses.version)),
    db.query.propertyReports.findFirst({ where: eq(propertyReports.propertyId, analysis.propertyId), orderBy: desc(propertyReports.fetchedAt) }),
    db.select().from(comps).where(and(eq(comps.propertyId, analysis.propertyId), eq(comps.included, true))).orderBy(asc(comps.distanceMi)),
  ]);
  return { analysis, property: property!, lead, siblings, report, comps: compRows };
}

export type AnalysisDetail = NonNullable<Awaited<ReturnType<typeof getAnalysis>>>;

/** Buyers whose criteria fit the property and the deal, with reasons. Phase 3 scoring is a refinement of this. */
export async function matchBuyers(orgId: string, deal: { state: string; county: string | null; postalCode: string; propertyType: string | null; condition: string; occupancy: string; investorBuyPrice: number; arv: number; repairCosts: number; spread: number }) {
  const db = await getDb();
  const rows = await db.select({ buyer: buyers, criteria: buyerCriteria }).from(buyers).innerJoin(buyerCriteria, eq(buyerCriteria.buyerId, buyers.id)).where(and(eq(buyers.orgId, orgId), eq(buyers.active, true)));
  const arvPct = deal.arv > 0 ? (deal.investorBuyPrice + deal.repairCosts) / deal.arv : 1;
  return rows.map(({ buyer, criteria }) => {
    const reasons: string[] = [];
    const misses: string[] = [];
    let score = 0;
    if (criteria.states.length === 0 || criteria.states.includes(deal.state)) { score += 25; reasons.push(`Buys in ${deal.state}`); } else misses.push(`Does not buy in ${deal.state}`);
    if (criteria.counties.length === 0 || (deal.county && criteria.counties.includes(deal.county))) { score += 15; if (deal.county && criteria.counties.includes(deal.county)) reasons.push(`Targets ${deal.county} County`); } else misses.push(`Outside target counties`);
    if (criteria.zips.length && criteria.zips.includes(deal.postalCode)) { score += 10; reasons.push(`Targets ZIP ${deal.postalCode}`); }
    const min = criteria.priceMin ? Number(criteria.priceMin) : 0;
    const max = criteria.priceMax ? Number(criteria.priceMax) : Infinity;
    if (deal.investorBuyPrice >= min && deal.investorBuyPrice <= max) { score += 20; reasons.push("Price in range"); } else misses.push(`Price outside ${min > 0 ? "$" + Math.round(min / 1000) + "k" : "0"} to ${Number.isFinite(max) ? "$" + Math.round(max / 1000) + "k" : "any"}`);
    if (criteria.propertyTypes.length === 0 || (deal.propertyType && criteria.propertyTypes.includes(deal.propertyType))) { score += 10; } else misses.push(`Does not buy ${deal.propertyType ?? "this type"}`);
    if (criteria.arvPctMax == null || arvPct <= Number(criteria.arvPctMax) + 0.001) { score += 10; reasons.push(`All in ${Math.round(arvPct * 100)}% of ARV fits`); } else misses.push(`All in ${Math.round(arvPct * 100)}% of ARV above ${Math.round(Number(criteria.arvPctMax) * 100)}% max`);
    const cond = Number(deal.condition);
    if (criteria.conditionLevels.length === 0 || Number.isNaN(cond) || criteria.conditionLevels.includes(cond)) score += 5; else misses.push("Condition outside preference");
    if (criteria.occupancyPrefs.length === 0 || deal.occupancy === "unknown" || criteria.occupancyPrefs.includes(deal.occupancy)) score += 5; else misses.push(`Prefers ${criteria.occupancyPrefs.join(" or ")}`);
    const minMargin = criteria.minMarginAmount ? Number(criteria.minMarginAmount) : 0;
    if (deal.spread >= minMargin) reasons.push(minMargin ? `Spread clears ${"$" + Math.round(minMargin / 1000)}k minimum` : "No minimum margin"); else misses.push(`Spread under their ${"$" + Math.round(minMargin / 1000)}k minimum`);
    if (criteria.proofOfFundsOnFile) reasons.push("Proof of funds on file");
    if (criteria.sightUnseen) reasons.push("Buys sight unseen");
    return { buyer, criteria, score, reasons, misses };
  }).sort((a, b) => b.score - a.score);
}
