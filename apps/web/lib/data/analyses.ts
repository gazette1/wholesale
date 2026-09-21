import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { dealAnalyses, properties, leads, profiles, propertyReports, comps, buyers, buyerCriteria, dealSubmissions } from "@dealcalc/db";
import { scoreBuyerMatch, type MatchDeal } from "@dealcalc/engine";
import { getDb } from "../db";
import { isUuid } from "../safe";

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
  if (!isUuid(id)) return null;
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

/** Buyers whose criteria fit the property and the deal, with reasons. Scoring lives in the engine (buyerMatch.ts). */
export async function matchBuyers(orgId: string, deal: MatchDeal) {
  const db = await getDb();
  const rows = await db.select({ buyer: buyers, criteria: buyerCriteria }).from(buyers).innerJoin(buyerCriteria, eq(buyerCriteria.buyerId, buyers.id)).where(and(eq(buyers.orgId, orgId), eq(buyers.active, true)));
  const num = (v: string | null) => (v == null ? null : Number(v));
  return rows.map(({ buyer, criteria }) => {
    const result = scoreBuyerMatch(deal, {
      states: criteria.states, counties: criteria.counties, zips: criteria.zips, propertyTypes: criteria.propertyTypes,
      priceMin: num(criteria.priceMin), priceMax: num(criteria.priceMax), arvPctMax: num(criteria.arvPctMax),
      conditionLevels: criteria.conditionLevels, occupancyPrefs: criteria.occupancyPrefs,
      minMarginAmount: num(criteria.minMarginAmount), minMarginPct: num(criteria.minMarginPct),
      proofOfFundsOnFile: criteria.proofOfFundsOnFile, sightUnseen: criteria.sightUnseen,
    });
    return { buyer, criteria, ...result };
  }).sort((a, b) => b.score - a.score || (a.buyer.company ?? a.buyer.firstName).localeCompare(b.buyer.company ?? b.buyer.firstName));
}

/** Who this analysis was already sent to, keyed by buyer id. */
export async function submissionsForAnalysis(orgId: string, analysisId: string) {
  if (!isUuid(analysisId)) return new Map<string, { sentAt: Date | null; sentVia: string | null; response: string }>();
  const db = await getDb();
  const rows = await db.select({ buyerId: dealSubmissions.buyerId, sentAt: dealSubmissions.sentAt, sentVia: dealSubmissions.sentVia, response: dealSubmissions.response }).from(dealSubmissions).where(and(eq(dealSubmissions.orgId, orgId), eq(dealSubmissions.analysisId, analysisId)));
  return new Map(rows.map((r) => [r.buyerId, r]));
}
