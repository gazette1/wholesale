import type { ProjectTimeline } from "./cashFlow";
import type { FinancingLoan } from "./schemas";
import { monthStarts, type ProjectContext } from "./types";

export type LoanCost = {
  name: string; commitment: number; purchaseFunding: number; rehabFunding: number;
  pointsPaid: number; fixedFees: number;
  /** Null when the loan charges interest on the drawn balance and the calendar timeline is not available. */
  interest: number | null;
  /** Interest charged at each month start of the hold, one entry per month start. Null with the interest. */
  interestByMonth: number[] | null;
  /** Rehab released by the draws for this loan. Zero without a timeline. */
  rehabDrawn: number;
};

export type ProjectFinancingResult = {
  loans: LoanCost[];
  allCash: boolean;
  totalPurchaseFunding: number; totalRehabFunding: number;
  /** Rehab actually released by the draws across every loan. */
  totalRehabDrawn: number;
  pointsAndFees: number;
  /** Null while any loan's interest is pending. */
  interest: number | null;
  /** Interest across every loan at each month start. Null while any loan's interest is pending. */
  interestByMonth: number[] | null;
  total: number | null;
  /** Purchase price not covered by loans, before fees. */
  ownerCashAtPurchase: number;
  pendingLoans: string[];
};

/**
 * Monthly interest is annual rate / 12, charged at each month start. Points are charged on the commitment.
 * A drawn balance loan charges interest on the debt at month start: its purchase funding plus the rehab
 * released by every draw dated on or before that month start. It needs the calendar timeline to know that.
 */
export function projectFinancing(loans: FinancingLoan[], ctx: ProjectContext, timeline?: ProjectTimeline): ProjectFinancingResult {
  const months = monthStarts(ctx.holdMonths);
  const costs: LoanCost[] = loans.map((l, i) => {
    const commitment = l.purchaseFunding + l.rehabFunding;
    const monthly = l.annualRate / 12;
    let interest: number | null;
    let interestByMonth: number[] | null;
    if (l.interestBasis === "fullCommitment") {
      interest = commitment * monthly * months;
      interestByMonth = new Array<number>(months).fill(commitment * monthly);
    } else if (timeline) {
      const drawn = timeline.rehabDrawnAtMonthStart[i] ?? [];
      interestByMonth = Array.from({ length: months }, (_, m) => (l.purchaseFunding + (drawn[m] ?? 0)) * monthly);
      interest = interestByMonth.reduce((a, b) => a + b, 0);
    } else {
      interest = null;
      interestByMonth = null;
    }
    return {
      name: l.name, commitment, purchaseFunding: l.purchaseFunding, rehabFunding: l.rehabFunding,
      pointsPaid: l.points * commitment, fixedFees: l.fixedFees, interest, interestByMonth,
      rehabDrawn: timeline ? (timeline.rehabDrawnTotal[i] ?? 0) : 0,
    };
  });
  const pendingLoans = costs.filter((c) => c.interest === null).map((c) => c.name || "Unnamed loan");
  const pointsAndFees = costs.reduce((a, c) => a + c.pointsPaid + c.fixedFees, 0);
  const interest = pendingLoans.length ? null : costs.reduce((a, c) => a + (c.interest ?? 0), 0);
  const interestByMonth = pendingLoans.length ? null : Array.from({ length: months }, (_, m) => costs.reduce((a, c) => a + (c.interestByMonth?.[m] ?? 0), 0));
  const totalPurchaseFunding = costs.reduce((a, c) => a + c.purchaseFunding, 0);
  return {
    loans: costs, allCash: loans.length === 0, totalPurchaseFunding, totalRehabFunding: costs.reduce((a, c) => a + c.rehabFunding, 0),
    totalRehabDrawn: costs.reduce((a, c) => a + c.rehabDrawn, 0),
    pointsAndFees, interest, interestByMonth, total: interest === null ? null : interest + pointsAndFees,
    ownerCashAtPurchase: Math.max(0, ctx.purchasePrice - totalPurchaseFunding), pendingLoans,
  };
}
