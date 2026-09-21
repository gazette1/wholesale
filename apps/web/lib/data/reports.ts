import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { leads, leadSources, pipelineStages, offers, activities, profiles, propertyReports, properties, dealAnalyses } from "@dealcalc/db";
import { getDb } from "../db";
import { appDayBounds, dayKey } from "../utils";
import { average, countAtOrUnder, daysBetween, median, rate, safeDivide } from "../reports-math";

export const RANGE_KEYS = ["30d", "90d", "ytd", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export type ReportRange = { from: Date; to: Date };
export const RANGE_LABELS: Record<RangeKey, string> = { "30d": "Last 30 days", "90d": "Last 90 days", ytd: "Year to date", all: "All time" };

export function parseRangeKey(raw: string | undefined): RangeKey {
  return RANGE_KEYS.includes(raw as RangeKey) ? (raw as RangeKey) : "90d";
}

/** Range bounds in the app time zone. Day ranges start at midnight N days back, year to date starts January 1. */
export function reportRange(key: RangeKey, now: Date = new Date()): ReportRange {
  const today = appDayBounds(now);
  if (key === "all") return { from: new Date(0), to: today.end };
  // Noon UTC on January 1 is still January 1 in every US time zone, so appDayBounds lands on the right day.
  if (key === "ytd") return { from: appDayBounds(new Date(Date.UTC(Number(dayKey(now).slice(0, 4)), 0, 1, 12))).start, to: today.end };
  return { from: new Date(today.start.getTime() - (key === "30d" ? 30 : 90) * 86_400_000), to: today.end };
}

/** Stage keys a lead is still "in it" at: due diligence follows under contract, and closed is the deal succeeding. Anything else after reaching one of these means the lead left the deal. */
export const CONTRACT_STAGE_KEYS = ["under_contract", "due_diligence", "closed"] as const;

/**
 * A lead counts as a contract when its stage_change activity history ever shows a move INTO under contract,
 * due diligence, or closed, so a deal that fell out later still counts. The current stage or a won status
 * covers rows moved with no logged transition (older seed data, imports). Needs pipelineStages joined.
 */
function reachedContractCondition(): SQL {
  const reachedByActivity = sql`exists (select 1 from ${activities} where ${activities.leadId} = ${leads.id} and ${activities.type} = 'stage_change' and (${activities.payload} ->> 'to') in ('under_contract','due_diligence','closed'))`;
  return sql`(${reachedByActivity} or ${pipelineStages.key} in ('under_contract','due_diligence','closed') or ${leads.status} = 'won')`;
}

/** A contract (see above) that is not currently under contract, in due diligence, or closed: it left the deal. Needs pipelineStages joined. */
function felloutCondition(): SQL {
  return sql`(${reachedContractCondition()} and ${pipelineStages.key} not in ('under_contract','due_diligence','closed'))`;
}

function leadsInRange(orgId: string, range: ReportRange) {
  return and(eq(leads.orgId, orgId), gte(leads.createdAt, range.from), lte(leads.createdAt, range.to));
}

export type SpeedToContactRow = { userId: string | null; name: string; leads: number; notContacted: number; medianMinutes: number | null; averageMinutes: number | null; within5: number | null; within60: number | null };

/** First response time per assigned user. The shares are out of all leads in range, so a lead nobody reached counts against the user. */
export async function speedToContact(orgId: string, range: ReportRange): Promise<SpeedToContactRow[]> {
  const db = await getDb();
  const rows = await db.select({ userId: leads.assignedTo, name: profiles.fullName, minutes: leads.firstResponseMinutes }).from(leads).leftJoin(profiles, eq(leads.assignedTo, profiles.id)).where(leadsInRange(orgId, range));
  const byUser = new Map<string, { userId: string | null; name: string; total: number; minutes: number[] }>();
  for (const r of rows) {
    const key = r.userId ?? "unassigned";
    const entry = byUser.get(key) ?? { userId: r.userId, name: r.name ?? "Unassigned", total: 0, minutes: [] };
    entry.total += 1;
    if (r.minutes !== null) entry.minutes.push(r.minutes);
    byUser.set(key, entry);
  }
  return [...byUser.values()].map((u) => ({
    userId: u.userId, name: u.name, leads: u.total, notContacted: u.total - u.minutes.length,
    medianMinutes: median(u.minutes), averageMinutes: average(u.minutes),
    within5: rate(countAtOrUnder(u.minutes, 5), u.total), within60: rate(countAtOrUnder(u.minutes, 60), u.total),
  })).sort((a, b) => b.leads - a.leads);
}

export type ConversionBySourceRow = { sourceId: string | null; source: string; costPerLead: number | null; leads: number; contacted: number; offersMade: number; contracts: number; fellOut: number; closed: number; leadToContract: number | null };

export async function conversionBySource(orgId: string, range: ReportRange): Promise<ConversionBySourceRow[]> {
  const db = await getDb();
  const hasOffer = sql`exists (select 1 from ${offers} where ${offers.leadId} = ${leads.id} and ${offers.status} <> 'draft')`;
  const rows = await db.select({
    sourceId: leads.sourceId, source: leadSources.name, costPerLead: leadSources.costPerLead, leads: count(),
    contacted: sql<number>`count(*) filter (where ${leads.contactAttempts} > 0)`.mapWith(Number),
    offersMade: sql<number>`count(*) filter (where ${hasOffer})`.mapWith(Number),
    contracts: sql<number>`count(*) filter (where ${reachedContractCondition()})`.mapWith(Number),
    fellOut: sql<number>`count(*) filter (where ${felloutCondition()})`.mapWith(Number),
    closed: sql<number>`count(*) filter (where ${leads.status} = 'won')`.mapWith(Number),
  }).from(leads).innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id)).leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(leadsInRange(orgId, range)).groupBy(leads.sourceId, leadSources.name, leadSources.costPerLead);
  return rows.map((r) => ({ ...r, source: r.source ?? "No source", costPerLead: r.costPerLead === null ? null : Number(r.costPerLead), leadToContract: rate(r.contracts, r.leads) })).sort((a, b) => b.leads - a.leads);
}

export type CostPerContractRow = { sourceId: string | null; source: string; leads: number; contracts: number; costPerLead: number | null; spend: number | null; costPerContract: number | null };
export type CostPerContract = { rows: CostPerContractRow[]; totalSpend: number; totalContracts: number; blendedCostPerContract: number | null; sourcesWithoutCost: number; enrichmentSpendCents: number; enrichmentReports: number };

/** Lead spend is leads times the source's cost per lead. Enrichment spend is an org level line and is not spread across sources. */
export async function costPerContract(orgId: string, range: ReportRange, sources?: ConversionBySourceRow[]): Promise<CostPerContract> {
  const db = await getDb();
  const [bySource, [enrichment]] = await Promise.all([
    sources ?? conversionBySource(orgId, range),
    db.select({ cents: sql<number>`coalesce(sum(${propertyReports.costCents}), 0)`.mapWith(Number), n: count() }).from(propertyReports).where(and(eq(propertyReports.orgId, orgId), gte(propertyReports.fetchedAt, range.from), lte(propertyReports.fetchedAt, range.to))),
  ]);
  const rows = bySource.map((s) => {
    const spend = s.costPerLead === null ? null : s.leads * s.costPerLead;
    return { sourceId: s.sourceId, source: s.source, leads: s.leads, contracts: s.contracts, costPerLead: s.costPerLead, spend, costPerContract: spend === null ? null : safeDivide(spend, s.contracts) };
  });
  // The blended figure only uses sources that have a cost, on both sides of the division.
  const costed = rows.filter((r) => r.spend !== null);
  const totalSpend = costed.reduce((a, r) => a + (r.spend ?? 0), 0);
  const totalContracts = costed.reduce((a, r) => a + r.contracts, 0);
  // TODO(phase2): decide whether enrichment spend is added into cost per contract, and whether cost per lead needs effective dates so a price change does not restate old months.
  return { rows, totalSpend, totalContracts, blendedCostPerContract: safeDivide(totalSpend, totalContracts), sourcesWithoutCost: rows.length - costed.length, enrichmentSpendCents: enrichment?.cents ?? 0, enrichmentReports: enrichment?.n ?? 0 };
}

export type OffersToContracts = { made: number; awaiting: number; accepted: number; rejected: number; countered: number; expired: number; acceptanceRate: number | null; avgDaysToAccept: number | null; acceptedMeasured: number };

/** Offers other than drafts, dated by when they were sent (or recorded, when there is no sent date). Counts are by current status. Days to accept comes straight from offers.acceptedAt. */
export async function offersToContracts(orgId: string, range: ReportRange): Promise<OffersToContracts> {
  const db = await getDb();
  const offerDate = sql`coalesce(${offers.sentAt}, ${offers.createdAt})`;
  const inRange = and(eq(offers.orgId, orgId), ne(offers.status, "draft"), sql`${offerDate} >= ${range.from.toISOString()}::timestamptz`, sql`${offerDate} <= ${range.to.toISOString()}::timestamptz`);
  const [byStatus, accepted] = await Promise.all([
    db.select({ status: offers.status, n: count() }).from(offers).where(inRange).groupBy(offers.status),
    db.select({ sentAt: offers.sentAt, acceptedAt: offers.acceptedAt }).from(offers).where(and(inRange, eq(offers.status, "accepted"))),
  ]);
  const n = (status: string) => byStatus.find((s) => s.status === status)?.n ?? 0;
  const made = byStatus.reduce((a, s) => a + s.n, 0);
  const days = accepted.map((o) => (o.sentAt && o.acceptedAt ? daysBetween(o.sentAt, o.acceptedAt) : null)).filter((d): d is number => d !== null);
  return { made, awaiting: n("sent"), accepted: n("accepted"), rejected: n("rejected"), countered: n("countered"), expired: n("expired"), acceptanceRate: rate(n("accepted"), made), avgDaysToAccept: average(days), acceptedMeasured: days.length };
}

export async function reportsData(orgId: string, range: ReportRange) {
  const [speed, sources, offerStats] = await Promise.all([speedToContact(orgId, range), conversionBySource(orgId, range), offersToContracts(orgId, range)]);
  const cost = await costPerContract(orgId, range, sources);
  return { totalLeads: sources.reduce((a, s) => a + s.leads, 0), speedToContact: speed, conversionBySource: sources, costPerContract: cost, offersToContracts: offerStats };
}

export type ReportsData = Awaited<ReturnType<typeof reportsData>>;

export type MarketRow = {
  key: string; leads: number; contacted: number; contactRate: number | null;
  offersMade: number; accepted: number; offerAcceptanceRate: number | null; contracts: number;
  avgSpread: number | null; avgAssignmentFee: number | null; medianAsking: number | null;
  /** Fewer than MIN_SAMPLE leads: rates on this row are shown, but flagged, not hidden. */
  lowSample: boolean;
};
export type MarketAnalytics = { byCounty: MarketRow[]; byZip: MarketRow[] };

const MIN_SAMPLE = 5;

/** Number for math, or NaN (never 0) when the value is missing, so a null asking price cannot masquerade as a free property. */
function numOrNaN(v: string | number | null): number {
  if (v === null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

type MarketBucket = { leads: number; contacted: number; offered: number; accepted: number; contracts: number; askingPrices: number[]; propertyIds: Set<string> };

function bucketFor(map: Map<string, MarketBucket>, key: string): MarketBucket {
  let b = map.get(key);
  if (!b) { b = { leads: 0, contacted: 0, offered: 0, accepted: 0, contracts: 0, askingPrices: [], propertyIds: new Set() }; map.set(key, b); }
  return b;
}

/**
 * Leads grouped by county and by zip: volume, contact and offer funnel, contracts (see reachedContractCondition),
 * and deal economics from the primary analysis on each property (spread is denormalized on the row; the assignment
 * fee only lives in the saved inputs, the same way runDeal reads it). One pass over the leads in range, aggregated
 * in memory, the same way speedToContact does it above.
 */
export async function marketAnalytics(orgId: string, range: ReportRange): Promise<MarketAnalytics> {
  const db = await getDb();
  const hasOffer = sql`exists (select 1 from ${offers} where ${offers.leadId} = ${leads.id} and ${offers.status} <> 'draft')`;
  const hasAccepted = sql`exists (select 1 from ${offers} where ${offers.leadId} = ${leads.id} and ${offers.status} = 'accepted')`;
  const rows = await db.select({
    propertyId: leads.propertyId, county: properties.county, zip: properties.postalCode,
    askingPrice: leads.askingPrice, contactAttempts: leads.contactAttempts,
    offered: sql<boolean>`${hasOffer}`, accepted: sql<boolean>`${hasAccepted}`, contract: sql<boolean>`${reachedContractCondition()}`,
  }).from(leads)
    .innerJoin(properties, eq(leads.propertyId, properties.id))
    .innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .where(leadsInRange(orgId, range));

  const propertyIds = [...new Set(rows.map((r) => r.propertyId))];
  const analysisRows = propertyIds.length ? await db.select({
    propertyId: dealAnalyses.propertyId, spread: dealAnalyses.spread, inputs: dealAnalyses.inputs, isPrimary: dealAnalyses.isPrimary, version: dealAnalyses.version,
  }).from(dealAnalyses).where(and(eq(dealAnalyses.orgId, orgId), inArray(dealAnalyses.propertyId, propertyIds), isNull(dealAnalyses.trashedAt)))
    .orderBy(desc(dealAnalyses.isPrimary), desc(dealAnalyses.version)) : [];
  // The primary analysis, else the latest version, matching primaryAnalysesByProperty's pick in lib/data/leads.ts.
  const primaryByProperty = new Map<string, { spread: number | null; assignmentFee: number | null }>();
  for (const a of analysisRows) {
    if (primaryByProperty.has(a.propertyId)) continue;
    const spread = a.spread === null ? null : numOrNaN(a.spread);
    const fee = a.inputs ? (a.inputs.wholesale?.assignmentFee ?? Math.abs(a.inputs.acquisitions.assignmentFee)) : null;
    primaryByProperty.set(a.propertyId, {
      spread: spread !== null && Number.isFinite(spread) ? spread : null,
      assignmentFee: fee !== null && Number.isFinite(fee) ? fee : null,
    });
  }

  const byCountyMap = new Map<string, MarketBucket>();
  const byZipMap = new Map<string, MarketBucket>();
  for (const r of rows) {
    const countyKey = r.county?.trim() || "No county recorded";
    for (const [map, key] of [[byCountyMap, countyKey], [byZipMap, r.zip]] as const) {
      const b = bucketFor(map, key);
      b.leads += 1;
      if (r.contactAttempts > 0) b.contacted += 1;
      if (r.offered) b.offered += 1;
      if (r.accepted) b.accepted += 1;
      if (r.contract) b.contracts += 1;
      b.askingPrices.push(numOrNaN(r.askingPrice));
      b.propertyIds.add(r.propertyId);
    }
  }

  function toRows(map: Map<string, MarketBucket>): MarketRow[] {
    return [...map.entries()].map(([key, b]) => {
      const spreads: number[] = [], fees: number[] = [];
      for (const pid of b.propertyIds) {
        const a = primaryByProperty.get(pid);
        if (a?.spread !== null && a?.spread !== undefined) spreads.push(a.spread);
        if (a?.assignmentFee !== null && a?.assignmentFee !== undefined) fees.push(a.assignmentFee);
      }
      return {
        key, leads: b.leads, contacted: b.contacted, contactRate: rate(b.contacted, b.leads),
        offersMade: b.offered, accepted: b.accepted, offerAcceptanceRate: rate(b.accepted, b.offered),
        contracts: b.contracts, avgSpread: average(spreads), avgAssignmentFee: average(fees),
        medianAsking: median(b.askingPrices), lowSample: b.leads < MIN_SAMPLE,
      };
    }).sort((a, b) => b.leads - a.leads);
  }

  return { byCounty: toRows(byCountyMap), byZip: toRows(byZipMap) };
}
