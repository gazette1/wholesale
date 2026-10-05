import { describe, it, expect } from "vitest";
import type { MatchDeal, MatchCriteria } from "../src";
import { matchedCriteria, weightedScore, trainMatchWeights, DEFAULT_WEIGHTS, MIN_TRAINING_SAMPLES, type CriteriaMatch, type CriterionKey } from "../src/matchLearning";

// Same fixtures as buyerMatch.test.ts, so the two independent scorers can be checked against each other.
const deal: MatchDeal = { state: "MD", county: "Baltimore", postalCode: "21133", propertyType: "Single Family", condition: "3", occupancy: "vacant", investorBuyPrice: 164056, arv: 250000, repairCosts: 10944, buyerProfit: 55776 };
const open: MatchCriteria = { states: [], counties: [], zips: [], propertyTypes: [], priceMin: null, priceMax: null, arvPctMax: null, conditionLevels: [], occupancyPrefs: [], minMarginAmount: null, minMarginPct: null, proofOfFundsOnFile: false, sightUnseen: false };

describe("matchedCriteria + weightedScore with default weights", () => {
  it("scores an open buy box at 100, same as scoreBuyerMatch", () => {
    const m = matchedCriteria(deal, open);
    // Every criterion matches except zip: an empty zip list is not a target, same as buyerMatch.ts's bonus rule.
    const { zip, ...rest } = m.matched;
    expect(Object.values(rest).every(Boolean)).toBe(true);
    expect(zip).toBe(false);
    expect(weightedScore(m)).toBe(100);
  });

  it("subtracts the margin weight when a required margin is not met, matching buyerMatch's $60k case", () => {
    const m = matchedCriteria(deal, { ...open, minMarginAmount: 60000 });
    expect(m.marginRequired).toBe(true);
    expect(m.matched.margin).toBe(false);
    expect(weightedScore(m)).toBe(80); // 100 - DEFAULT_WEIGHTS.margin (20)
  });

  it("adds the ZIP bonus without passing 100", () => {
    expect(weightedScore(matchedCriteria(deal, { ...open, zips: ["21133"] }))).toBe(100);
  });

  it("never goes below zero when every criterion misses", () => {
    const m = matchedCriteria(deal, { ...open, states: ["PA"], counties: ["York"], priceMin: 10000, priceMax: 90000, propertyTypes: ["Condo"], arvPctMax: 0.6, conditionLevels: [5], occupancyPrefs: ["tenant"], minMarginAmount: 500000 });
    expect(weightedScore(m)).toBe(0);
  });
});

describe("trainMatchWeights", () => {
  const fullMatch: Record<CriterionKey, boolean> = { state: true, county: true, price: true, propertyType: true, arvPct: true, condition: true, occupancy: true, zip: true, margin: true };
  const noMatch: Record<CriterionKey, boolean> = { state: false, county: false, price: false, propertyType: false, arvPct: false, condition: false, occupancy: false, zip: false, margin: false };
  const rec = (matched: Record<CriterionKey, boolean>, response: "interested" | "offer" | "pass" | "none"): { match: CriteriaMatch; response: typeof response } => ({ match: { matched, marginRequired: true }, response });

  it("returns the unchanged defaults and says so below the minimum sample size", () => {
    const records = Array.from({ length: MIN_TRAINING_SAMPLES - 1 }, () => rec(fullMatch, "interested"));
    const r = trainMatchWeights(records);
    expect(r.usedDefaults).toBe(true);
    expect(r.sampleSize).toBe(MIN_TRAINING_SAMPLES - 1);
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
    expect(r.explanations.county).toContain("Not enough data yet");
    expect(r.explanations.county).toContain(String(DEFAULT_WEIGHTS.county));
  });

  it("learns a weight of 17 for county from the hand worked example in the code comment", () => {
    // 10 matched, 8 positive (interested); 10 unmatched, 2 positive. All other criteria held at "matched"
    // for the unmatched-county records too, so only county's matched/unmatched split differs.
    const records = [
      ...Array.from({ length: 8 }, () => rec({ ...fullMatch, county: true }, "interested")),
      ...Array.from({ length: 2 }, () => rec({ ...fullMatch, county: true }, "none")),
      ...Array.from({ length: 2 }, () => rec({ ...fullMatch, county: false }, "interested")),
      ...Array.from({ length: 8 }, () => rec({ ...fullMatch, county: false }, "none")),
    ];
    const r = trainMatchWeights(records);
    expect(r.usedDefaults).toBe(false);
    expect(r.sampleSize).toBe(20);
    expect(r.weights.county).toBe(17);
    expect(r.explanations.county).toBe("Buyers responded more often when the county matched, on 20 submissions.");
  });

  it("floors a criterion's weight at 0 when matching it correlates with fewer positive responses", () => {
    const records = [
      ...Array.from({ length: 10 }, () => rec({ ...noMatch, state: true }, "none")),
      ...Array.from({ length: 10 }, () => rec({ ...noMatch, state: false }, "offer")),
    ];
    const r = trainMatchWeights(records);
    expect(r.weights.state).toBe(0);
    expect(r.explanations.state).toContain("held at 0");
  });

  it("keeps a weight near default when a criterion makes little difference", () => {
    const records = [
      ...Array.from({ length: 10 }, () => rec({ ...noMatch, propertyType: true }, "interested")),
      ...Array.from({ length: 10 }, () => rec({ ...noMatch, propertyType: false }, "interested")),
    ];
    const r = trainMatchWeights(records);
    expect(r.explanations.propertyType).toContain("little difference");
  });
});
