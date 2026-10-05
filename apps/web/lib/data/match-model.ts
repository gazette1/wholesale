import { and, eq } from "drizzle-orm";
import { buyerMatchModels, buyerCriteria, dealSubmissions, dealAnalyses, properties } from "@dealcalc/db";
import { matchedCriteria, DEFAULT_WEIGHTS, MIN_TRAINING_SAMPLES, CRITERIA_KEYS, type CriterionKey, type MatchDeal, type MatchCriteria, type TrainingRecord, type SubmissionOutcome } from "@dealcalc/engine";
import { getDb } from "../db";
import { isUuid } from "../safe";
import type { DealOutputs } from "../deal-run";

/** Converts a stored buy box row into the plain-number shape the engine's matcher takes. */
export function criteriaFromRow(row: typeof buyerCriteria.$inferSelect): MatchCriteria {
  const num = (v: string | null) => (v == null ? null : Number(v));
  return {
    states: row.states, counties: row.counties, zips: row.zips, propertyTypes: row.propertyTypes,
    priceMin: num(row.priceMin), priceMax: num(row.priceMax), arvPctMax: num(row.arvPctMax),
    conditionLevels: row.conditionLevels, occupancyPrefs: row.occupancyPrefs,
    minMarginAmount: num(row.minMarginAmount), minMarginPct: num(row.minMarginPct),
    proofOfFundsOnFile: row.proofOfFundsOnFile, sightUnseen: row.sightUnseen,
  };
}

type PropertyFacts = { state: string; county: string | null; postalCode: string; propertyType: string | null; condition: string; occupancy: string };

/** Same buyer profit formula as the match page and the deal package: ARV less the buyer's price, repairs,
 * and the flip's financing, holding, buying, and selling costs. Kept in one place for the model to reuse. */
export function dealFromOutputs(outputs: DealOutputs, storedArv: string | number | null, property: PropertyFacts): MatchDeal {
  const a = outputs.acquisitions;
  const investorBuyPrice = outputs.wholesale?.investorBuyPrice ?? 0;
  const arv = Number(outputs.effectiveArv ?? storedArv ?? 0);
  const repairCosts = a?.repairCosts ?? 0;
  const buyerProfit = a ? arv - investorBuyPrice - repairCosts - a.financing.total - a.holding.total - a.buying.total - a.selling.total : 0;
  return { state: property.state, county: property.county, postalCode: property.postalCode, propertyType: property.propertyType, condition: property.condition, occupancy: property.occupancy, investorBuyPrice, arv, repairCosts, buyerProfit };
}

export type ActiveModel = { weights: Record<CriterionKey, number>; explanations: Record<CriterionKey, string>; sampleSize: number; source: "learned" | "default"; trainedAt: Date | null };

/** The weights to score with right now: the org's trained model once it clears the sample floor, the
 * named default weights otherwise. Never edits buyerMatch.ts's own fixed rules, just an independent model. */
export async function getActiveWeights(orgId: string): Promise<ActiveModel> {
  const db = await getDb();
  const row = await db.query.buyerMatchModels.findFirst({ where: eq(buyerMatchModels.orgId, orgId) });
  if (!row) {
    const explanations = Object.fromEntries(CRITERIA_KEYS.map((k: CriterionKey) => [k, `No model has been trained yet for this workspace, so the default weight of ${DEFAULT_WEIGHTS[k]} is used.`])) as Record<CriterionKey, string>;
    return { weights: DEFAULT_WEIGHTS, explanations, sampleSize: 0, source: "default", trainedAt: null };
  }
  return { weights: row.weights as Record<CriterionKey, number>, explanations: row.explanations as Record<CriterionKey, string>, sampleSize: row.sampleSize, source: row.sampleSize >= MIN_TRAINING_SAMPLES ? "learned" : "default", trainedAt: row.trainedAt };
}

export type SubmissionTracking = { sentAt: Date | null; sentVia: string | null; response: string; token: string | null; firstOpenedAt: Date | null; openCount: number };

/** Send and open tracking for one analysis's submissions, keyed by buyer id. Selects the token and open
 * fields that lib/data/analyses.ts's submissionsForAnalysis does not, so the match page can show them. */
export async function matchTracking(orgId: string, analysisId: string): Promise<Map<string, SubmissionTracking>> {
  if (!isUuid(analysisId)) return new Map();
  const db = await getDb();
  const rows = await db.select({
    buyerId: dealSubmissions.buyerId, sentAt: dealSubmissions.sentAt, sentVia: dealSubmissions.sentVia, response: dealSubmissions.response,
    token: dealSubmissions.token, firstOpenedAt: dealSubmissions.firstOpenedAt, openCount: dealSubmissions.openCount,
  }).from(dealSubmissions).where(and(eq(dealSubmissions.orgId, orgId), eq(dealSubmissions.analysisId, analysisId)));
  return new Map(rows.map((r) => [r.buyerId, r]));
}

/** Every past submission in the org turned into a training record: what this buyer's CURRENT buy box
 * matched on that deal, and how they responded. Criteria are not versioned, so a buyer who tightened
 * their buy box since a deal was sent is judged by today's buy box, not the one in effect at send time. */
export async function trainingRecordsForOrg(orgId: string): Promise<TrainingRecord[]> {
  const db = await getDb();
  const rows = await db.select({
    response: dealSubmissions.response, outputs: dealAnalyses.outputs, arv: dealAnalyses.arv,
    state: properties.state, county: properties.county, postalCode: properties.postalCode, propertyType: properties.propertyType, condition: properties.condition, occupancy: properties.occupancy,
    criteria: buyerCriteria,
  }).from(dealSubmissions)
    .innerJoin(dealAnalyses, eq(dealSubmissions.analysisId, dealAnalyses.id))
    .innerJoin(properties, eq(dealAnalyses.propertyId, properties.id))
    .innerJoin(buyerCriteria, eq(buyerCriteria.buyerId, dealSubmissions.buyerId))
    .where(eq(dealSubmissions.orgId, orgId));
  return rows.map((r) => {
    const deal = dealFromOutputs(r.outputs as unknown as DealOutputs, r.arv, { state: r.state, county: r.county, postalCode: r.postalCode, propertyType: r.propertyType, condition: r.condition, occupancy: r.occupancy });
    return { match: matchedCriteria(deal, criteriaFromRow(r.criteria)), response: r.response as SubmissionOutcome };
  });
}
