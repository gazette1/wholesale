import { average } from "./money";

export type QuickOffersInput = {
  comps: [number, number, number];
  squareFeet: number;
  /** Entered negative in the workbook (C4, C13, C22). The sheet adds it. */
  assignmentFee: { full: number; medium: number; light: number };
  costPerSqft: { full: number; medium: number; light: number };
  valueWant: { probabilityOfSale: number; timeMonths: number; effort: number };
  valueAre: { probabilityOfSale: number; timeMonths: number; effort: number };
  /** Hardcoded 0.70 in the workbook. See A-27. */
  arvFactor?: number;
};

export type OfferTier = {
  seventyPercentArv: number; allInMaxLimit: number; repairCosts: number; offer: number; pctOfArv: number;
};

export type QuickOffersOutput = {
  arv: number;
  full: OfferTier; medium: OfferTier; light: OfferTier;
  valueWantPrice: number; valueArePrice: number;
  valueWant: number; valueAre: number; valueDifference: number;
};

export const DEFAULT_ARV_FACTOR = 0.7;

function tier(arv: number, arvFactor: number, squareFeet: number, fee: number, costPerSqft: number): OfferTier {
  const seventyPercentArv = arv * arvFactor;            // C3, C12, C21 (ANOMALY-A-27 hardcoded 0.7)
  const allInMaxLimit = seventyPercentArv + fee;        // C5, C14, C23 (fee is negative, ANOMALY-A-05)
  const repairCosts = -(squareFeet * costPerSqft);      // C6, C15, C24
  const offer = allInMaxLimit + repairCosts;            // C7, C16, C25
  const pctOfArv = offer / arv;                         // C8, C17, C26
  return { seventyPercentArv, allInMaxLimit, repairCosts, offer, pctOfArv };
}

export function quickOffers(input: QuickOffersInput): QuickOffersOutput {
  const arvFactor = input.arvFactor ?? DEFAULT_ARV_FACTOR;
  const arv = average(input.comps);                     // K3, F3
  const full = tier(arv, arvFactor, input.squareFeet, input.assignmentFee.full, input.costPerSqft.full);
  const medium = tier(arv, arvFactor, input.squareFeet, input.assignmentFee.medium, input.costPerSqft.medium);
  const light = tier(arv, arvFactor, input.squareFeet, input.assignmentFee.light, input.costPerSqft.light);
  // ANOMALY-A-06: the value block feeds nothing else on the sheet.
  const valueWantPrice = arv;                            // F14
  const valueArePrice = arv;                             // F15
  const w = input.valueWant;
  const a = input.valueAre;
  const valueWant = (valueWantPrice * w.probabilityOfSale) / (w.timeMonths * w.effort);   // K14
  const valueAre = (valueArePrice * a.probabilityOfSale) / (a.timeMonths * a.effort);     // K15
  const valueDifference = valueWant - valueAre;         // K16
  return { arv, full, medium, light, valueWantPrice, valueArePrice, valueWant, valueAre, valueDifference };
}
