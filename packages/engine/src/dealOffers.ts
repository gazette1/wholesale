import { DEFAULT_ARV_FACTOR } from "./quickOffers";

/**
 * Quick offers for one deal: three per square foot rehab tiers plus the offer
 * built on the linked rehab estimate. Same rule as the Quick Offers sheet
 * (ARV times the offer percent, less the fee, less repairs) but with a positive
 * fee, any number of comparables, and an editable offer percent.
 */
export type Comparable = { label: string; value: number };
export type SellerCase = { outcome: number; effort: number; months: number; probability: number };

export type DealOffersInput = {
  /** ARV typed on the Deal section. Used unless useComparableAverage is on. */
  enteredArv: number;
  comparables: Comparable[];
  useComparableAverage: boolean;
  /** Share of ARV, 0 to 1. */
  offerPercent?: number;
  /** Positive. Subtracted. */
  assignmentFee: number;
  squareFeet: number;
  perSqft: { light: number; medium: number; full: number };
  /** Repair estimate from the Rehab section (checklist, manual, or per foot). */
  linkedRepairs: number;
  sellerCurrent?: SellerCase | null;
  sellerDesired?: SellerCase | null;
};

export type OfferLine = { key: "light" | "medium" | "full" | "linked"; label: string; repairs: number; offer: number; pctOfArv: number };

export type DealOffersOutput = {
  arv: number;
  arvSource: "entered" | "comparables";
  comparableAverage: number | null;
  comparableCount: number;
  offerPercent: number;
  allowance: number;
  fee: number;
  lines: OfferLine[];
  sellerCurrentScore: number | null;
  sellerDesiredScore: number | null;
  sellerScoreDifference: number | null;
};

/** Average of the comparables that carry a positive value. Null when there are none. */
export function comparableAverage(comparables: Comparable[]): number | null {
  const values = comparables.map((c) => c.value).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Seller value score from the Quick Offers sheet (K14, K15): outcome times the
 * probability of sale, divided by months times effort. A comparison score, not an appraisal.
 */
export function sellerScore(c: SellerCase | null | undefined): number | null {
  if (!c) return null;
  if (!(c.months > 0) || !(c.effort > 0)) return null;
  return (c.outcome * c.probability) / (c.months * c.effort);
}

export function dealOffers(input: DealOffersInput): DealOffersOutput {
  const avg = comparableAverage(input.comparables);
  const useAvg = input.useComparableAverage && avg !== null;
  const arv = useAvg ? (avg as number) : input.enteredArv;
  const offerPercent = input.offerPercent ?? DEFAULT_ARV_FACTOR;
  const allowance = arv * offerPercent;
  const fee = Math.abs(input.assignmentFee);
  const sqft = Math.max(0, input.squareFeet);
  const line = (key: OfferLine["key"], label: string, repairs: number): OfferLine => {
    const offer = allowance - fee - repairs;
    return { key, label, repairs, offer, pctOfArv: arv === 0 ? NaN : offer / arv };
  };
  const current = sellerScore(input.sellerCurrent);
  const desired = sellerScore(input.sellerDesired);
  return {
    arv, arvSource: useAvg ? "comparables" : "entered", comparableAverage: avg, comparableCount: input.comparables.filter((c) => c.value > 0).length,
    offerPercent, allowance, fee,
    lines: [
      line("light", "Light rehab", sqft * input.perSqft.light),
      line("medium", "Medium rehab", sqft * input.perSqft.medium),
      line("full", "Full rehab", sqft * input.perSqft.full),
      line("linked", "Offer using linked rehab", input.linkedRepairs),
    ],
    sellerCurrentScore: current, sellerDesiredScore: desired,
    sellerScoreDifference: current !== null && desired !== null ? desired - current : null,
  };
}
