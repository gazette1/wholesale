import type { DealInput } from "./schemas";
import { comparableAverage } from "./dealOffers";
import { resolveRehab } from "./rehabPlan";
import { validateProject } from "./project/validateProject";

/**
 * Plain language checks on a DealInput. Errors mean a result is wrong or
 * missing; warnings mean the numbers run but deserve a second look. The wording
 * follows the Mac reference app where it had a message for the same rule.
 */
export type DealIssue = { level: "error" | "warn"; section: "deal" | "offers" | "rehab" | "financing" | "holding" | "costs" | "rental" | "loan" | "project"; message: string };

/** The workbook cash flow grid stops at week 39, which is 9 months. */
export const MAX_GRID_HOLD_MONTHS = 9;
export const MAX_HOLD_MONTHS = 120;

export function validateDeal(input: DealInput): DealIssue[] {
  const issues: DealIssue[] = [];
  const add = (level: DealIssue["level"], section: DealIssue["section"], message: string) => issues.push({ level, section, message });
  const a = input.acquisitions;
  const w = input.wholesale;

  if (!(a.arv > 0)) add("error", "deal", "Enter a positive after repair value.");
  if (!(a.purchasePrice > 0)) add("error", "deal", "Enter a purchase price greater than zero.");
  if (a.holdMonths < 0 || a.holdMonths > MAX_HOLD_MONTHS) add("error", "deal", `Hold time must be between 0 and ${MAX_HOLD_MONTHS} months.`);
  else if (a.holdMonths > MAX_GRID_HOLD_MONTHS) add("warn", "deal", `Hold time above ${MAX_GRID_HOLD_MONTHS} months runs past the workbook cash flow grid. Weekly cash flow stops at week 39.`);
  const factor = a.arvFactor ?? 0.7;
  if (factor < 0 || factor > 1) add("error", "deal", "Enter an offer percentage between 0 and 100.");
  if ((w?.assignmentFee ?? 0) < 0) add("error", "deal", "Enter assignment fees and repair costs as positive amounts or zero.");
  if (a.arv > 0 && a.purchasePrice > a.arv) add("warn", "deal", "The proposed offer is above the after repair value.");
  if (w) {
    const sellerNet = a.purchasePrice - (w.existingMortgagePayoff ?? 0) - (w.sellerClosingCosts ?? 0);
    if (sellerNet < 0) add("warn", "deal", "At this offer the seller nets less than zero after the mortgage payoff and closing costs.");
    if (w.investorBuyPrice != null && w.investorBuyPrice < a.purchasePrice) add("warn", "deal", "The investor buy price is below your offer, so the spread is negative.");
  }

  const o = input.offers;
  if (o) {
    if (o.useComparableAverage && comparableAverage(o.comparables) === null) add("error", "offers", "Add comparable sale values.");
    if (o.perSqft.light < 0 || o.perSqft.medium < 0 || o.perSqft.full < 0) add("error", "offers", "Enter assignment fees and repair costs as positive amounts or zero.");
    if (!(o.squareFeet > 0)) add("warn", "offers", "Enter the square footage so the per foot offers can be calculated.");
    if (!(o.perSqft.light <= o.perSqft.medium && o.perSqft.medium <= o.perSqft.full)) add("warn", "offers", "Per foot rates usually rise from light to medium to full.");
    for (const [label, c] of [["current", o.sellerCurrent], ["desired", o.sellerDesired]] as const) {
      if (!c) continue;
      if (c.probability < 0 || c.probability > 1) add("error", "offers", `Seller ${label} case: probability of sale must be between 0 and 100.`);
      if (!(c.months > 0) || !(c.effort > 0)) add("warn", "offers", `Seller ${label} case: months and effort must be greater than zero to produce a score.`);
    }
  }

  const rehab = resolveRehab(input.rehab, input.rehabPlan, a.repairCostsOverride);
  if (rehab.source === "checklist" && rehab.incompleteCount > 0) add("warn", "rehab", `${rehab.incompleteCount} included checklist ${rehab.incompleteCount === 1 ? "item needs" : "items need"} a price or quantity.`);
  if (rehab.source === "perSqft" && !((input.rehabPlan?.squareFeet ?? 0) > 0)) add("warn", "rehab", "Enter the square footage for the per square foot rehab estimate.");
  if (rehab.estimate < 0) add("error", "rehab", "Enter assignment fees and repair costs as positive amounts or zero.");
  if (rehab.source !== "checklist" && rehab.checklistTotal > 0 && Math.abs(rehab.checklistTotal - rehab.estimate) > 0.25 * Math.max(rehab.estimate, 1)) {
    add("warn", "rehab", "The checklist total and the estimate in use differ by more than 25 percent.");
  }

  // Offer against the numbers the Offers tab shows, using whichever repair estimate is in use.
  const avgArv = o?.useComparableAverage ? comparableAverage(o.comparables) : null;
  const arvInUse = avgArv ?? a.arv;
  const fee = Math.abs(w?.assignmentFee ?? a.assignmentFee);
  if (arvInUse > 0 && a.purchasePrice > 0 && factor >= 0 && factor <= 1) {
    const mao = arvInUse * factor - rehab.estimate - fee;
    if (a.purchasePrice > mao + 0.5) add("warn", "deal", `The proposed offer is ${Math.round(a.purchasePrice - mao).toLocaleString("en-US")} dollars above the max allowable offer.`);
    const autoInvestorPrice = arvInUse * factor - rehab.estimate;
    if (w?.investorBuyPrice == null && autoInvestorPrice < a.purchasePrice) add("warn", "deal", "The automatic investor buy price is below your offer, so the spread is negative. Lower the offer, recheck repairs, or type the price an investor has agreed to.");
  }

  const loans = a.firstLienAmount + a.secondLienAmount;
  if (a.firstLienAmount < 0 || a.secondLienAmount < 0) add("error", "financing", "Loan amounts must be zero or more.");
  if (loans > a.purchasePrice + rehab.estimate + 0.005) add("warn", "financing", "Combined loan amounts exceed the purchase price plus the rehab estimate.");

  const b = input.buyAndHold;
  if (b) {
    if (b.units.length === 0) add("error", "rental", "Add at least one rental unit.");
    if (b.loanTermYears < 1 || b.loanTermYears > 50) add("error", "rental", "Rental loan term must be between 1 and 50 years.");
    if (b.managementPct + b.vacancyPct + b.maintenancePct + b.cashReservesPct > 1) add("error", "rental", "Combined percentage expenses exceed 100% of rent.");
    if (b.units.length > 0 && b.units.every((u) => !(Number(u.rent) > 0) && !(Number(u.marketRent) > 0))) add("warn", "rental", "Enter a current or market rent for at least one unit.");
  }

  const l = input.loan;
  if (l) {
    if (l.months < 1 || l.months > 600) add("error", "loan", "Loan term must be between 1 and 600 months.");
    if (!(l.principal > 0)) add("error", "loan", "Principal must be greater than zero.");
    if (l.payoffAfterPayment != null && l.payoffAfterPayment > l.months) add("warn", "loan", "Payoff payment number is past the end of the loan. The final payment is used.");
  }

  if (input.project) issues.push(...validateProject(input.project, { purchasePrice: a.purchasePrice, asIsValue: a.asIsValue, salePrice: arvInUse, holdMonths: a.holdMonths, rehabEstimate: rehab.estimate }));
  return issues;
}
