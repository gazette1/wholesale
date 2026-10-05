/**
 * Scores how well one deal fits one buyer's buy box. Pure, so the rules can be tested.
 * Not from the workbook. The buyer's minimum margin is checked against the BUYER's
 * projected profit on the deal, never against the wholesaler's assignment spread.
 */
export type MatchDeal = {
  state: string; county: string | null; postalCode: string; propertyType: string | null;
  /** "1" to "5" or "unknown". */
  condition: string;
  /** owner, tenant, vacant, or unknown. */
  occupancy: string;
  /** What the buyer pays. */
  investorBuyPrice: number;
  arv: number; repairCosts: number;
  /** ARV less the buyer's price, repairs, and the flip's financing, holding, buying, and selling costs. */
  buyerProfit: number;
};

export type MatchCriteria = {
  states: string[]; counties: string[]; zips: string[]; propertyTypes: string[];
  priceMin: number | null; priceMax: number | null;
  /** 0.7 for 70 percent. */
  arvPctMax: number | null;
  conditionLevels: number[]; occupancyPrefs: string[];
  minMarginAmount: number | null;
  /** Share of the buyer's price, 0.15 for 15 percent. */
  minMarginPct: number | null;
  proofOfFundsOnFile: boolean; sightUnseen: boolean;
};

export type MatchResult = { score: number; reasons: string[]; misses: string[]; marginOk: boolean };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+county$/, "");
const k = (n: number) => `$${Math.round(n / 1000)}k`;

/** Weights sum to 100. A target ZIP adds a 5 point bonus, capped at 100. A failed margin takes 20 off. */
export function scoreBuyerMatch(deal: MatchDeal, c: MatchCriteria): MatchResult {
  const reasons: string[] = [];
  const misses: string[] = [];
  let score = 0;

  const states = c.states.map(norm);
  if (states.length === 0 || states.includes(norm(deal.state))) { score += 25; reasons.push(`Buys in ${deal.state}`); } else misses.push(`Does not buy in ${deal.state}`);

  const counties = c.counties.map(norm);
  const inCounty = deal.county ? counties.includes(norm(deal.county)) : false;
  if (counties.length === 0 || inCounty) { score += 15; if (inCounty) reasons.push(`Targets ${deal.county}`); } else misses.push("Outside target counties");

  const min = c.priceMin ?? 0;
  const max = c.priceMax ?? Infinity;
  if (deal.investorBuyPrice >= min && deal.investorBuyPrice <= max) { score += 20; reasons.push("Price in range"); }
  else misses.push(`Price outside ${min > 0 ? k(min) : "$0"} to ${Number.isFinite(max) ? k(max) : "any"}`);

  const types = c.propertyTypes.map(norm);
  if (types.length === 0 || (deal.propertyType != null && types.includes(norm(deal.propertyType)))) score += 10; else misses.push(`Does not buy ${deal.propertyType ?? "this type"}`);

  const arvPct = deal.arv > 0 ? (deal.investorBuyPrice + deal.repairCosts) / deal.arv : 1;
  if (c.arvPctMax == null || arvPct <= c.arvPctMax + 0.001) { score += 10; reasons.push(`All in ${Math.round(arvPct * 100)}% of ARV fits`); }
  else misses.push(`All in ${Math.round(arvPct * 100)}% of ARV above ${Math.round(c.arvPctMax * 100)}% max`);

  const cond = Number(deal.condition);
  if (c.conditionLevels.length === 0 || Number.isNaN(cond) || c.conditionLevels.includes(cond)) score += 10; else misses.push("Condition outside preference");

  const occ = c.occupancyPrefs.map(norm);
  if (occ.length === 0 || deal.occupancy === "unknown" || occ.includes(norm(deal.occupancy))) score += 10; else misses.push(`Prefers ${c.occupancyPrefs.join(" or ")}`);

  if (c.zips.includes(deal.postalCode)) { score += 5; reasons.push(`Targets ZIP ${deal.postalCode}`); }

  const needAmount = c.minMarginAmount ?? 0;
  const needPct = c.minMarginPct ?? 0;
  const profitPct = deal.investorBuyPrice > 0 ? deal.buyerProfit / deal.investorBuyPrice : 0;
  const amountOk = deal.buyerProfit >= needAmount;
  const pctOk = profitPct >= needPct - 0.0005;
  const marginOk = amountOk && pctOk;
  if (needAmount > 0 || needPct > 0) {
    if (marginOk) reasons.push(`Projected profit ${k(deal.buyerProfit)} clears their minimum`);
    else misses.push(!amountOk ? `Projected profit ${k(deal.buyerProfit)} under their ${k(needAmount)} minimum` : `Projected profit ${Math.round(profitPct * 100)}% under their ${Math.round(needPct * 100)}% minimum`);
  }
  if (!marginOk) score -= 20;

  if (c.proofOfFundsOnFile) reasons.push("Proof of funds on file");
  if (c.sightUnseen) reasons.push("Buys sight unseen");
  return { score: Math.max(0, Math.min(100, score)), reasons, misses, marginOk };
}
