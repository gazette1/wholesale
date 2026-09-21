/** Rental figures the projection reads from DealInput.buyAndHold. Built by projectRentalContext(). */
export type ProjectRentalContext = {
  /** Property value at purchase, and the base the appreciation series grows from. */
  price: number;
  /** Gross rent a month in use for the projection. */
  grossMonthlyRent: number;
  /** Operating expenses charged as a share of gross rent. They grow with the rent. */
  percentOfRentExpenses: number;
  /** Operating expenses in dollars a month. They stay constant across the projection. */
  fixedMonthlyExpenses: number;
  downPaymentPct: number;
  closingCosts: number;
  interestRate: number;
  loanTermYears: number;
  appreciationRate: number;
  rentGrowthRate: number;
};

/** Figures the project model reads from the rest of the deal. It never writes back to them. */
export type ProjectContext = {
  purchasePrice: number;
  asIsValue: number;
  /** Sale value: the ARV in use, entered or the comparable average. */
  salePrice: number;
  holdMonths: number;
  /** Rehab estimate in use (checklist, manual, or per square foot). */
  rehabEstimate: number;
  /** Rental case for the projection. Absent on a deal with no rental units. */
  rental?: ProjectRentalContext | null;
};

/** A calculator that is not written yet reports why, so the UI can say so instead of showing a number. */
export type ModuleResult<T> = { status: "computed"; value: T } | { status: "pending"; reason: string };

export const pendingModule = <T>(reason: string): ModuleResult<T> => ({ status: "pending", reason });

/** Costs land at each month start, so a hold of 4.5 months has five month starts. */
export function monthStarts(holdMonths: number): number {
  return Math.max(0, Math.ceil(holdMonths - 1e-9));
}

/** Round to cents, half away from zero, like the Mac app's Decimal rounding. Cleans binary noise such as 1.005 stored as 1.00499. */
export function round2(value: number): number {
  const cents = Number((Math.abs(value) * 100).toPrecision(15));
  return (Math.sign(value) || 1) * (Math.round(cents) / 100);
}

/** The weekly grid covers holds up to 120 months. */
export const MAX_PROJECT_HOLD_MONTHS = 120;
