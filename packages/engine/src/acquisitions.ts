import { withFlags, type AnomalyFlags } from "./anomalies";
import { rehabEstimator, type RehabEstimatorInput } from "./rehabEstimator";
import { drawCashFlow, type DrawCashFlowInput, type DrawCashFlowOutput, type CostColumn } from "./drawCashFlow";
import { DEFAULT_ARV_FACTOR } from "./quickOffers";

export type AcquisitionsInput = {
  holdMonths: number; asIsValue: number; purchasePrice: number; arv: number;
  /** Used when neither rehab nor repairCostsOverride is given. */
  repairCosts?: number;
  /** Linked checklist. Its total is used unless repairCostsOverride is set (A-04). */
  rehab?: RehabEstimatorInput;
  repairCostsOverride?: number | null;
  /** Entered negative on the sheet (N4). The sheet adds it. */
  assignmentFee: number;
  firstLienAmount: number; firstPointsRate: number; firstInterestRate: number; firstMonthlyInterestOnlyRate: number;
  secondLienAmount: number; secondPointsRate: number; secondInterestRate: number; secondMonthlyInterestOnlyRate: number;
  /**
   * Annual interest rate per lien, 0.14 for 14 percent. When set, it replaces that lien's two workbook rate cells:
   * interest for the hold is lien x annual / 12 x hold months. See annualRates() below.
   */
  firstAnnualRate?: number | null; secondAnnualRate?: number | null;
  miscLienAmountPaid: number; miscPointsPaid: number; miscInterestPaid: number; miscMonthlyInterestOnlyPaid: number; miscFinancingCosts: number;
  propertyTaxRate: number; hoaMonthly: number; insuranceMonthly: number; utilitiesMonthly: number;
  gasMonthly: number; waterMonthly: number; electricityMonthly: number; miscUtilitiesMonthly: number;
  miscHoldingMonthly: [number, number, number, number];
  buyEscrowRate: number; buyTitleRate: number; buyMiscRate: number;
  sellEscrowRate: number; sellRecordingRate: number; sellRealtorRate: number; sellTransferRate: number;
  sellHomeWarranty: number; sellStaging: number; sellMarketing: number; sellMisc: number;
  arvFactor?: number;
  maxWeeks?: number;
  flags?: Partial<AnomalyFlags>;
};

export type ScenarioRoi = {
  cashInvested: number; cashToCover: number; totalCash: number; cashReturn: number;
  expectedRoi: number; actualRoi: number; timeToReturn: string; cashFlow: DrawCashFlowOutput;
};

export type AcquisitionsOutput = {
  repairCosts: number;
  repairCostsSource: "override" | "rehab" | "input";
  offer: { seventyPercentArv: number; allInMaxLimit: number; offerRepairCosts: number; offer: number; offerPctOfArv: number };
  financing: {
    firstPointsPaid: number; firstInterestPaid: number; firstInterestOnlyPaid: number;
    secondPointsPaid: number; secondInterestPaid: number; secondInterestOnlyPaid: number;
    miscLienAmountPaid: number; miscPointsPaid: number; miscInterestPaid: number; miscMonthlyInterestOnlyPaid: number; miscFinancingCosts: number;
    total: number;
  };
  holding: {
    propertyTaxesTotal: number; hoaTotal: number; insuranceTotal: number; utilitiesTotal: number; gasTotal: number;
    waterTotal: number; electricityTotal: number; miscUtilitiesTotal: number; totalMaintenanceCosts: number;
    miscHoldingTotal: [number, number, number, number]; total: number;
  };
  buying: { escrow: number; title: number; misc: number; total: number };
  selling: { escrow: number; recording: number; realtor: number; transfer: number; homeWarranty: number; staging: number; marketing: number; misc: number; total: number };
  purchaseAndRepairCosts: number;
  netProfit: number;
  cashInvested: number;
  cashReturn: number;
  roiOnCash: number;
  timeToReturn: string;
  delayed: ScenarioRoi;
  upfront: ScenarioRoi;
  warnings: string[];
};

export const DEFAULT_MAX_WEEKS = 36;

/**
 * The workbook has two interest cells per lien and neither takes an annual rate. F21 multiplies its rate by the lien and
 * by the hold months, so it only works for a monthly rate; F25 leaves the hold out (A-21). Ous works around this by typing
 * =0.14/12 into the interest only cell (A-03) and leaving the other at zero. An annual rate input does the same thing
 * without the hand division: the lien's interest only cell becomes annual / 12 and its other rate cell becomes zero. For
 * the first lien this reproduces the workbook's cached result to the cent. Decided by Russ on 2026-09-21.
 */
export function annualRates(input: AcquisitionsInput): AcquisitionsInput {
  let out = input;
  if (input.firstAnnualRate != null) out = { ...out, firstInterestRate: 0, firstMonthlyInterestOnlyRate: input.firstAnnualRate / 12 };
  if (input.secondAnnualRate != null) out = { ...out, secondInterestRate: 0, secondMonthlyInterestOnlyRate: input.secondAnnualRate / 12 };
  return out;
}

export function acquisitions(rawInput: AcquisitionsInput): AcquisitionsOutput {
  const input = annualRates(rawInput);
  const flags = withFlags(input.flags);
  const arvFactor = input.arvFactor ?? DEFAULT_ARV_FACTOR;
  const hold = input.holdMonths;

  // ANOMALY-A-04: the sheet types E12 by hand. The engine links the checklist with an override.
  let repairCosts: number;
  let repairCostsSource: AcquisitionsOutput["repairCostsSource"];
  if (input.repairCostsOverride !== undefined && input.repairCostsOverride !== null) {
    repairCosts = input.repairCostsOverride; repairCostsSource = "override";
  } else if (input.rehab) {
    repairCosts = rehabEstimator(input.rehab).total; repairCostsSource = "rehab";
  } else {
    repairCosts = input.repairCosts ?? 0; repairCostsSource = "input";
  }

  // Offer block (N3:N8). ANOMALY-A-27: arvFactor is hardcoded 0.7 on the sheet.
  const seventyPercentArv = input.arv * arvFactor;                     // N3
  const allInMaxLimit = seventyPercentArv + input.assignmentFee;       // N5 (fee negative, ANOMALY-A-05)
  const offerRepairCosts = -repairCosts;                               // N6
  const offer = allInMaxLimit + offerRepairCosts;                      // N7
  const offerPctOfArv = offer / input.arv;                             // N8

  // Financing projection (F19:F31).
  const firstPointsPaid = input.firstPointsRate * input.firstLienAmount;                        // F20
  const firstInterestPaid = input.firstInterestRate * input.firstLienAmount * hold;             // F21
  // ANOMALY-A-03: E22 is =0.14/12 on the sheet; here it is a plain monthly rate input.
  const firstInterestOnlyPaid = input.firstMonthlyInterestOnlyRate * input.firstLienAmount * hold;   // F22
  const secondPointsPaid = input.secondPointsRate * input.secondLienAmount;                     // F24
  // ANOMALY-A-21: F25 has no hold months factor, unlike F21.
  const secondInterestPaid = flags.secondInterestTimesHold
    ? input.secondInterestRate * input.secondLienAmount * hold
    : input.secondInterestRate * input.secondLienAmount;                                        // F25
  const secondInterestOnlyPaid = input.secondMonthlyInterestOnlyRate * input.secondLienAmount * hold;   // F26
  const financingTotal = firstPointsPaid + firstInterestPaid + firstInterestOnlyPaid
    + secondPointsPaid + secondInterestPaid + secondInterestOnlyPaid
    + input.miscLienAmountPaid + input.miscPointsPaid + input.miscInterestPaid
    + input.miscMonthlyInterestOnlyPaid + input.miscFinancingCosts;                            // E32

  // Holding costs (K19:K31). ANOMALY-A-23: the tax rate applies to as-is value.
  const propertyTaxesTotal = ((input.propertyTaxRate * input.asIsValue) / 12) * hold;          // K19
  const hoaTotal = input.hoaMonthly * hold;                                                     // K20
  const insuranceTotal = input.insuranceMonthly * hold;                                         // K21
  const utilitiesTotal = input.utilitiesMonthly * hold;                                         // K22 (ANOMALY-A-22: no cash flow column)
  const gasTotal = input.gasMonthly * hold;                                                     // K23
  const waterTotal = input.waterMonthly * hold;                                                 // K24
  const electricityTotal = input.electricityMonthly * hold;                                     // K25
  const miscUtilitiesTotal = input.miscUtilitiesMonthly * hold;                                 // K26
  const totalMaintenanceCosts = propertyTaxesTotal + hoaTotal + insuranceTotal + utilitiesTotal
    + gasTotal + waterTotal + electricityTotal + miscUtilitiesTotal;                            // J27
  const miscHoldingTotal = input.miscHoldingMonthly.map((m) => hold * m) as [number, number, number, number];   // K28:K31
  const holdingTotal = totalMaintenanceCosts + miscHoldingTotal.reduce((a, b) => a + b, 0);    // J32

  // ANOMALY-A-02: buying costs use ARV on the sheet, and two selling costs use purchase price.
  const buyBase = flags.fixTransactionCostBases ? input.purchasePrice : input.arv;
  const buyEscrow = input.buyEscrowRate * buyBase;                                              // F37
  const buyTitle = input.buyTitleRate * buyBase;                                                // F38
  const buyMisc = input.buyMiscRate * buyBase;                                                  // F39
  const buyingTotal = buyEscrow + buyTitle + buyMisc;                                           // J12

  const sellPriceBase = flags.fixTransactionCostBases ? input.arv : input.purchasePrice;
  const sellEscrow = input.sellEscrowRate * input.arv;                                          // F42
  const sellRecording = input.sellRecordingRate * sellPriceBase;                                // F43 (purchase price on the sheet)
  const sellRealtor = input.sellRealtorRate * sellPriceBase;                                    // F44 (purchase price on the sheet)
  const sellTransfer = input.sellTransferRate * input.arv;                                      // F45
  const sellingTotal = sellEscrow + sellRecording + sellRealtor + sellTransfer
    + input.sellHomeWarranty + input.sellStaging + input.sellMarketing + input.sellMisc;         // J13

  const purchaseAndRepairCosts = -(input.purchasePrice + repairCosts);                          // E14
  const netProfit = input.arv - (input.purchasePrice + repairCosts + financingTotal + holdingTotal + buyingTotal + sellingTotal);   // J14
  // ANOMALY-A-19: cash invested excludes buying transaction costs.
  const cashInvested = financingTotal + holdingTotal;                                           // N11, H39, H46
  const cashReturn = netProfit;                                                                 // N12, H40, H47
  const roiOnCash = cashReturn / cashInvested;                                                  // N13, H41
  const timeToReturn = `${hold} Months`;                                                        // N14

  const costTotals: Record<CostColumn, number> & { utilities?: number } = {
    constructionCosts: repairCosts, purchasePrice: input.purchasePrice, firstPoints: firstPointsPaid,
    firstInterest: firstInterestPaid, firstInterestOnly: firstInterestOnlyPaid,
    propertyTaxes: propertyTaxesTotal, hoa: hoaTotal, insurance: insuranceTotal,
    gas: gasTotal, water: waterTotal, electricity: electricityTotal, miscUtilities: miscUtilitiesTotal,
    buyEscrow, buyTitle, buyMisc,
    sellEscrow, sellRecording, sellRealtor, sellTransfer,
    sellHomeWarranty: input.sellHomeWarranty, sellStaging: input.sellStaging, sellMarketing: input.sellMarketing, sellMisc: input.sellMisc,
    utilities: utilitiesTotal,
  };
  const base: Omit<DrawCashFlowInput, "schedule"> = {
    maxWeeks: input.maxWeeks ?? DEFAULT_MAX_WEEKS, holdMonths: hold, beginningCashBalance: cashInvested,
    purchasePrice: input.purchasePrice, repairCosts, arv: input.arv, costTotals, flags,
  };
  const delayedFlow = drawCashFlow({ ...base, schedule: "delayed" });
  const upfrontFlow = drawCashFlow({ ...base, schedule: "upfront" });

  const delayedCashToCover = delayedFlow.minBalance < 0 ? -delayedFlow.minBalance : 0;          // I39
  // ANOMALY-A-18: I46 returns the minimum in both IF branches.
  const upfrontCashToCover = flags.fixUpfrontCashToCover
    ? (upfrontFlow.minBalance < 0 ? -upfrontFlow.minBalance : 0)
    : -upfrontFlow.minBalance;                                                                  // I46
  const delayedTotalCash = cashInvested + delayedCashToCover;                                   // J39
  const upfrontTotalCash = cashInvested + upfrontCashToCover;                                   // J46
  // ANOMALY-A-01: H48 = H40/H39 (delayed block) on the sheet. Same value as H47/H46.
  const upfrontExpectedRoi = flags.fixUpfrontRoiLink ? cashReturn / cashInvested : roiOnCash;

  const delayed: ScenarioRoi = {
    cashInvested, cashToCover: delayedCashToCover, totalCash: delayedTotalCash, cashReturn,
    expectedRoi: roiOnCash, actualRoi: cashReturn / delayedTotalCash, timeToReturn, cashFlow: delayedFlow,   // H41, J41
  };
  const upfront: ScenarioRoi = {
    cashInvested, cashToCover: upfrontCashToCover, totalCash: upfrontTotalCash, cashReturn,
    expectedRoi: upfrontExpectedRoi, actualRoi: cashReturn / upfrontTotalCash, timeToReturn, cashFlow: upfrontFlow,   // H48, J48
  };

  return {
    repairCosts, repairCostsSource,
    offer: { seventyPercentArv, allInMaxLimit, offerRepairCosts, offer, offerPctOfArv },
    financing: {
      firstPointsPaid, firstInterestPaid, firstInterestOnlyPaid, secondPointsPaid, secondInterestPaid, secondInterestOnlyPaid,
      miscLienAmountPaid: input.miscLienAmountPaid, miscPointsPaid: input.miscPointsPaid, miscInterestPaid: input.miscInterestPaid,
      miscMonthlyInterestOnlyPaid: input.miscMonthlyInterestOnlyPaid, miscFinancingCosts: input.miscFinancingCosts, total: financingTotal,
    },
    holding: {
      propertyTaxesTotal, hoaTotal, insuranceTotal, utilitiesTotal, gasTotal, waterTotal, electricityTotal, miscUtilitiesTotal,
      totalMaintenanceCosts, miscHoldingTotal, total: holdingTotal,
    },
    buying: { escrow: buyEscrow, title: buyTitle, misc: buyMisc, total: buyingTotal },
    selling: {
      escrow: sellEscrow, recording: sellRecording, realtor: sellRealtor, transfer: sellTransfer,
      homeWarranty: input.sellHomeWarranty, staging: input.sellStaging, marketing: input.sellMarketing, misc: input.sellMisc, total: sellingTotal,
    },
    purchaseAndRepairCosts, netProfit, cashInvested, cashReturn, roiOnCash, timeToReturn, delayed, upfront,
    warnings: [...delayedFlow.warnings.map((w) => `delayed: ${w}`), ...upfrontFlow.warnings.map((w) => `upfront: ${w}`)],
  };
}
