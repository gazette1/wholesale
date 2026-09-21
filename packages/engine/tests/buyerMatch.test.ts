import { describe, it, expect } from "vitest";
import { scoreBuyerMatch, type MatchDeal, type MatchCriteria } from "../src";

const deal: MatchDeal = { state: "MD", county: "Baltimore", postalCode: "21133", propertyType: "Single Family", condition: "3", occupancy: "vacant", investorBuyPrice: 164056, arv: 250000, repairCosts: 10944, buyerProfit: 55776 };
const open: MatchCriteria = { states: [], counties: [], zips: [], propertyTypes: [], priceMin: null, priceMax: null, arvPctMax: null, conditionLevels: [], occupancyPrefs: [], minMarginAmount: null, minMarginPct: null, proofOfFundsOnFile: false, sightUnseen: false };

describe("scoreBuyerMatch", () => {
  it("gives an open buy box a full score", () => {
    const r = scoreBuyerMatch(deal, open);
    expect(r.score).toBe(100);
    expect(r.misses).toEqual([]);
    expect(r.marginOk).toBe(true);
  });

  it("checks the minimum margin against the buyer's profit, not the wholesale spread", () => {
    const r = scoreBuyerMatch(deal, { ...open, minMarginAmount: 30000 });
    expect(r.marginOk).toBe(true);
    expect(r.reasons.some((x) => x.includes("clears their minimum"))).toBe(true);
    const tooHigh = scoreBuyerMatch(deal, { ...open, minMarginAmount: 60000 });
    expect(tooHigh.marginOk).toBe(false);
    expect(tooHigh.score).toBe(80);
    expect(tooHigh.misses[0]).toContain("under their $60k minimum");
  });

  it("uses the minimum margin percent of the buyer's price", () => {
    expect(scoreBuyerMatch(deal, { ...open, minMarginPct: 0.3 }).marginOk).toBe(true);   // 55776 / 164056 = 34 percent
    const r = scoreBuyerMatch(deal, { ...open, minMarginPct: 0.4 });
    expect(r.marginOk).toBe(false);
    expect(r.misses[0]).toContain("34% under their 40% minimum");
  });

  it("matches state, county, type, and occupancy without regard to case or a County suffix", () => {
    const r = scoreBuyerMatch(deal, { ...open, states: ["md"], counties: ["baltimore county"], propertyTypes: ["single family"], occupancyPrefs: ["Vacant"] });
    expect(r.score).toBe(100);
    expect(r.reasons).toContain("Targets Baltimore");
  });

  it("drops points for each miss and never goes below zero", () => {
    const r = scoreBuyerMatch(deal, { ...open, states: ["PA"], counties: ["York"], priceMin: 10000, priceMax: 90000, propertyTypes: ["Condo"], arvPctMax: 0.6, conditionLevels: [5], occupancyPrefs: ["tenant"], minMarginAmount: 500000 });
    expect(r.score).toBe(0);
    expect(r.misses).toHaveLength(8);
  });

  it("adds the ZIP bonus without passing 100 and respects the ARV percent cap", () => {
    expect(scoreBuyerMatch(deal, { ...open, zips: ["21133"] }).score).toBe(100);
    expect(scoreBuyerMatch(deal, { ...open, states: ["PA"], zips: ["21133"] }).score).toBe(80);
    expect(scoreBuyerMatch(deal, { ...open, arvPctMax: 0.7 }).score).toBe(100);           // (164056 + 10944) / 250000 = 70 percent
    expect(scoreBuyerMatch(deal, { ...open, arvPctMax: 0.65 }).score).toBe(90);
  });

  it("treats an unknown condition or occupancy as acceptable", () => {
    expect(scoreBuyerMatch({ ...deal, condition: "unknown", occupancy: "unknown" }, { ...open, conditionLevels: [1], occupancyPrefs: ["owner"] }).score).toBe(100);
  });
});
