import { acquisitions, type AcquisitionsInput } from "./acquisitions";
import { wholesale } from "./wholesale";
import { buyAndHold } from "./buyAndHold";
import { rehabEstimator } from "./rehabEstimator";
import { sensitivityGrid, scaled } from "./sensitivity";
import { dealOffers, type DealOffersOutput } from "./dealOffers";
import { loanAnalysis, type LoanAnalysisOutput } from "./loanAnalysis";
import { resolveRehab, repairOverrideFor, type RehabPlanResult } from "./rehabPlan";
import { validateDeal, type DealIssue } from "./validate";
import type { DealInput } from "./schemas";
import { ENGINE_VERSION } from "./version";

export type DealOutputs = {
  acquisitions: ReturnType<typeof acquisitions>;
  wholesale: ReturnType<typeof wholesale>;
  rehab: ReturnType<typeof rehabEstimator>;
  rehabPlan: RehabPlanResult;
  offers: DealOffersOutput;
  buyAndHold: ReturnType<typeof buyAndHold> | null;
  loan: LoanAnalysisOutput | null;
  loanError: string | null;
  sensitivity: ReturnType<typeof sensitivityGrid> | null;
  /** Which cell of the sensitivity grid is the current case. */
  sensitivityCurrent: { row: number; col: number } | null;
  issues: DealIssue[];
  /** ARV used by every calculator: the comparable average when that switch is on, else the entered value. */
  effectiveArv: number;
  engineVersion: string;
};

const DEFAULT_PER_SQFT = { light: 15, medium: 30, full: 50 };

/** Run every calculator for one DealInput. Pure; safe on the server and in the browser. */
export function runDeal(inputs: DealInput, opts: { sensitivity?: boolean } = {}): DealOutputs {
  const rehab = rehabEstimator(inputs.rehab);
  const rehabPlan = resolveRehab(inputs.rehab, inputs.rehabPlan, inputs.acquisitions.repairCostsOverride);
  const fee = inputs.wholesale?.assignmentFee ?? Math.abs(inputs.acquisitions.assignmentFee);
  const offers = dealOffers({
    enteredArv: inputs.acquisitions.arv,
    comparables: inputs.offers?.comparables ?? [],
    useComparableAverage: inputs.offers?.useComparableAverage ?? false,
    offerPercent: inputs.acquisitions.arvFactor,
    assignmentFee: fee,
    squareFeet: inputs.offers?.squareFeet ?? inputs.rehabPlan?.squareFeet ?? 0,
    perSqft: inputs.offers?.perSqft ?? DEFAULT_PER_SQFT,
    linkedRepairs: rehabPlan.estimate,
    sellerCurrent: inputs.offers?.sellerCurrent ?? null,
    sellerDesired: inputs.offers?.sellerDesired ?? null,
  });
  const effectiveArv = offers.arv;

  const acqInput: AcquisitionsInput = { ...inputs.acquisitions, arv: effectiveArv, rehab: inputs.rehab, repairCostsOverride: repairOverrideFor(rehabPlan) } as AcquisitionsInput;
  const acq = acquisitions(acqInput);
  const ws = wholesale({
    arv: effectiveArv, repairCosts: acq.repairCosts, assignmentFee: fee,
    purchasePrice: inputs.acquisitions.purchasePrice, investorBuyPrice: inputs.wholesale?.investorBuyPrice ?? null,
    closingCosts: inputs.wholesale?.closingCosts ?? 0, holdingCosts: inputs.wholesale?.holdingCosts ?? 0,
    existingMortgagePayoff: inputs.wholesale?.existingMortgagePayoff ?? 0, sellerClosingCosts: inputs.wholesale?.sellerClosingCosts ?? 0, arvFactor: inputs.acquisitions.arvFactor,
  });
  const bh = inputs.buyAndHold && inputs.buyAndHold.units.length > 0 ? buyAndHold(inputs.buyAndHold) : null;

  let loan: LoanAnalysisOutput | null = null;
  let loanError: string | null = null;
  if (inputs.loan) {
    try { loan = loanAnalysis(inputs.loan); } catch (e) { loanError = e instanceof Error ? e.message : "The loan payment could not be calculated for these inputs."; }
  }

  // The current case must sit in the grid. Percent steps around a tiny repair number collapse to the same value,
  // so under 5,000 the repair axis steps up from the current figure in dollars instead and the current case is column 0.
  const repairs = acq.repairCosts;
  const lowRepairs = repairs < 5000;
  const repairAxis = lowRepairs ? [0, 2500, 5000, 10000, 20000].map((add) => repairs + add) : scaled(repairs, [0.8, 0.9, 1, 1.1, 1.25]);
  const sens = opts.sensitivity
    ? sensitivityGrid(acqInput, { key: "arv", values: scaled(effectiveArv, [0.9, 0.95, 1, 1.05, 1.1]) }, { key: "repairCosts", values: repairAxis })
    : null;
  const sensitivityCurrent = sens ? { row: 2, col: lowRepairs ? 0 : 2 } : null;
  return { acquisitions: acq, wholesale: ws, rehab, rehabPlan, offers, buyAndHold: bh, loan, loanError, sensitivity: sens, sensitivityCurrent, issues: validateDeal(inputs), effectiveArv, engineVersion: ENGINE_VERSION };
}

/** Outputs trimmed for storage: the payment rows are recomputed on load, so they are not saved. */
export function outputsForStorage(out: DealOutputs): DealOutputs {
  return out.loan ? { ...out, loan: { ...out.loan, rows: [] } } : out;
}
