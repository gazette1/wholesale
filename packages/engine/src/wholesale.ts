import { DEFAULT_ARV_FACTOR } from "./quickOffers";

/**
 * Wholesale exit math. Not from the workbook. Built on the Quick Offers rule
 * (ARV times factor, less repairs, less fee) and on the CRM brief. Every number
 * here is a plain formula so Ous can check it on a call.
 */
export type WholesaleInput = {
  arv: number;
  repairCosts: number;
  /** Positive number. The engine subtracts it. */
  assignmentFee: number;
  /** Proposed offer to the seller. */
  purchasePrice: number;
  /** What the investor pays. Defaults to arv * arvFactor - repairCosts. */
  investorBuyPrice?: number | null;
  /** Costs the wholesaler carries between contract and assignment. */
  closingCosts?: number;
  holdingCosts?: number;
  existingMortgagePayoff?: number;
  sellerClosingCosts?: number;
  arvFactor?: number;
};

export type WholesaleOutput = {
  arvFactor: number;
  maxAllowableOffer: number;
  investorBuyPrice: number;
  spread: number;
  grossProfit: number;
  netProfit: number;
  arvPct: number;
  investorArvPct: number;
  marginPct: number;
  sellerNet: number;
  offerAboveMao: number;
  costBreakdown: { purchasePrice: number; repairCosts: number; assignmentFee: number; closingCosts: number; holdingCosts: number; allIn: number };
};

export function wholesale(input: WholesaleInput): WholesaleOutput {
  const arvFactor = input.arvFactor ?? DEFAULT_ARV_FACTOR;
  const closingCosts = input.closingCosts ?? 0;
  const holdingCosts = input.holdingCosts ?? 0;
  const maxAllowableOffer = input.arv * arvFactor - input.repairCosts - input.assignmentFee;
  const investorBuyPrice = input.investorBuyPrice ?? (input.arv * arvFactor - input.repairCosts);
  const spread = investorBuyPrice - input.purchasePrice;
  const grossProfit = spread;
  const netProfit = spread - closingCosts - holdingCosts;
  const arvPct = input.arv === 0 ? NaN : input.purchasePrice / input.arv;
  const investorArvPct = input.arv === 0 ? NaN : (investorBuyPrice + input.repairCosts) / input.arv;
  const marginPct = investorBuyPrice === 0 ? NaN : spread / investorBuyPrice;
  const sellerNet = input.purchasePrice - (input.existingMortgagePayoff ?? 0) - (input.sellerClosingCosts ?? 0);
  const offerAboveMao = input.purchasePrice - maxAllowableOffer;
  return {
    arvFactor, maxAllowableOffer, investorBuyPrice, spread, grossProfit, netProfit, arvPct, investorArvPct, marginPct, sellerNet, offerAboveMao,
    costBreakdown: {
      purchasePrice: input.purchasePrice, repairCosts: input.repairCosts, assignmentFee: input.assignmentFee, closingCosts, holdingCosts,
      allIn: input.purchasePrice + input.repairCosts + closingCosts + holdingCosts,
    },
  };
}
