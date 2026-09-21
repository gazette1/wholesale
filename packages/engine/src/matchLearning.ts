/**
 * Learns per criterion weights for buyer matching from past submissions and their responses.
 * Deliberately not a machine learning model: for each criterion, this compares the smoothed rate of
 * positive responses (interested or offer) when the criterion matched the buyer's buy box against the
 * rate when it did not, and turns the difference into a weight. Additive (Laplace) smoothing keeps a
 * criterion with only a few data points from swinging to an extreme weight.
 *
 * `buyerMatch.ts` owns the fixed scoring rules and is not edited here. This module recomputes the same
 * pass or fail booleans independently (see matchedCriteria) so it can attach a weight to each one and
 * total them itself; the two totals agree when default weights are used (see matchLearning.test.ts).
 */
import type { MatchDeal, MatchCriteria } from "./buyerMatch";

export const CORE_CRITERIA = ["state", "county", "price", "propertyType", "arvPct", "condition", "occupancy"] as const;
export type CoreCriterion = (typeof CORE_CRITERIA)[number];
export type CriterionKey = CoreCriterion | "zip" | "margin";
export const CRITERIA_KEYS: readonly CriterionKey[] = [...CORE_CRITERIA, "zip", "margin"];

/** Same magnitudes as the fixed weights in buyerMatch.ts, so the default model scores the same way. */
export const DEFAULT_WEIGHTS: Record<CriterionKey, number> = {
  state: 25, county: 15, price: 20, propertyType: 10, arvPct: 10, condition: 10, occupancy: 10, zip: 5, margin: 20,
};

const CRITERION_LABELS: Record<CriterionKey, string> = {
  state: "the state", county: "the county", price: "the price range", propertyType: "the property type",
  arvPct: "the all-in percent of ARV", condition: "the condition level", occupancy: "the occupancy",
  zip: "the target ZIP", margin: "the buyer's minimum margin",
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+county$/, "");

export type CriteriaMatch = { matched: Record<CriterionKey, boolean>; marginRequired: boolean };

/** Which of a buyer's buy box criteria this deal satisfies, as plain booleans (no scoring, no reasons text). */
export function matchedCriteria(deal: MatchDeal, c: MatchCriteria): CriteriaMatch {
  const states = c.states.map(norm);
  const state = states.length === 0 || states.includes(norm(deal.state));

  const counties = c.counties.map(norm);
  const county = counties.length === 0 || (deal.county != null && counties.includes(norm(deal.county)));

  const min = c.priceMin ?? 0;
  const max = c.priceMax ?? Infinity;
  const price = deal.investorBuyPrice >= min && deal.investorBuyPrice <= max;

  const types = c.propertyTypes.map(norm);
  const propertyType = types.length === 0 || (deal.propertyType != null && types.includes(norm(deal.propertyType)));

  const arvPctValue = deal.arv > 0 ? (deal.investorBuyPrice + deal.repairCosts) / deal.arv : 1;
  const arvPct = c.arvPctMax == null || arvPctValue <= c.arvPctMax + 0.001;

  const condNum = Number(deal.condition);
  const condition = c.conditionLevels.length === 0 || Number.isNaN(condNum) || c.conditionLevels.includes(condNum);

  const occPrefs = c.occupancyPrefs.map(norm);
  const occupancy = occPrefs.length === 0 || deal.occupancy === "unknown" || occPrefs.includes(norm(deal.occupancy));

  const zip = c.zips.includes(deal.postalCode);

  const needAmount = c.minMarginAmount ?? 0;
  const needPct = c.minMarginPct ?? 0;
  const profitPct = deal.investorBuyPrice > 0 ? deal.buyerProfit / deal.investorBuyPrice : 0;
  const margin = deal.buyerProfit >= needAmount && profitPct >= needPct - 0.0005;
  const marginRequired = needAmount > 0 || needPct > 0;

  return { matched: { state, county, price, propertyType, arvPct, condition, occupancy, zip, margin }, marginRequired };
}

/** Adds up the weight of every criterion this deal satisfies for this buyer, 0 to 100. Mirrors buyerMatch.ts's
 * shape: the seven core criteria and the ZIP bonus add points, an unmet margin requirement subtracts them. */
export function weightedScore(m: CriteriaMatch, weights: Record<CriterionKey, number> = DEFAULT_WEIGHTS): number {
  let score = 0;
  for (const k of CORE_CRITERIA) if (m.matched[k]) score += weights[k];
  if (m.matched.zip) score += weights.zip;
  if (m.marginRequired && !m.matched.margin) score -= weights.margin;
  return Math.max(0, Math.min(100, score));
}

/** Below this many submissions with a response, there is not enough signal to learn from and the defaults are kept. */
export const MIN_TRAINING_SAMPLES = 20;
const SMOOTHING_ALPHA = 2;
const MAX_LEARNED_WEIGHT = 40;

export type SubmissionOutcome = "none" | "interested" | "pass" | "offer";
export type TrainingRecord = { match: CriteriaMatch; response: SubmissionOutcome };

export type TrainResult = {
  weights: Record<CriterionKey, number>;
  explanations: Record<CriterionKey, string>;
  sampleSize: number;
  usedDefaults: boolean;
};

const isPositive = (r: SubmissionOutcome) => r === "interested" || r === "offer";

/** (positives + alpha) / (n + 2*alpha). With zero data this returns the neutral 0.5, not an extreme. */
function smoothedRate(positives: number, n: number): number {
  return (positives + SMOOTHING_ALPHA) / (n + 2 * SMOOTHING_ALPHA);
}

/**
 * Learns one weight per criterion from past submissions.
 *
 * Hand worked example for "county" with alpha=2: 10 submissions where the county matched, 8 of them
 * came back interested or with an offer; 10 where it did not, 2 of them positive.
 *   matchedRate = (8+2) / (10+4) = 10/14 = 0.7142857
 *   unmatchedRate = (2+2) / (10+4) = 4/14 = 0.2857143
 *   diff = 0.4285714
 *   weight = round(diff * 40) = round(17.142857) = 17
 */
export function trainMatchWeights(records: TrainingRecord[]): TrainResult {
  const sampleSize = records.length;
  if (sampleSize < MIN_TRAINING_SAMPLES) {
    const explanations = Object.fromEntries(CRITERIA_KEYS.map((k) => [
      k,
      `Not enough data yet to learn a weight for ${CRITERION_LABELS[k]} (${sampleSize} submission${sampleSize === 1 ? "" : "s"} on file, ${MIN_TRAINING_SAMPLES} needed), so the default weight of ${DEFAULT_WEIGHTS[k]} is used.`,
    ])) as Record<CriterionKey, string>;
    return { weights: { ...DEFAULT_WEIGHTS }, explanations, sampleSize, usedDefaults: true };
  }

  const weights = {} as Record<CriterionKey, number>;
  const explanations = {} as Record<CriterionKey, string>;
  for (const k of CRITERIA_KEYS) {
    const matchedGroup = records.filter((r) => r.match.matched[k]);
    const unmatchedGroup = records.filter((r) => !r.match.matched[k]);
    const matchedRate = smoothedRate(matchedGroup.filter((r) => isPositive(r.response)).length, matchedGroup.length);
    const unmatchedRate = smoothedRate(unmatchedGroup.filter((r) => isPositive(r.response)).length, unmatchedGroup.length);
    const diff = matchedRate - unmatchedRate;
    weights[k] = Math.max(0, Math.min(MAX_LEARNED_WEIGHT, Math.round(diff * MAX_LEARNED_WEIGHT)));
    const label = CRITERION_LABELS[k];
    if (diff > 0.05) explanations[k] = `Buyers responded more often when ${label} matched, on ${sampleSize} submissions.`;
    else if (diff < -0.05) explanations[k] = `Buyers responded less often when ${label} matched, on ${sampleSize} submissions, so this weight is held at 0.`;
    else explanations[k] = `${label.charAt(0).toUpperCase()}${label.slice(1)} matching made little difference to responses, on ${sampleSize} submissions.`;
  }
  return { weights, explanations, sampleSize, usedDefaults: false };
}
