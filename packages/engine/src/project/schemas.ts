import { z } from "zod";

const usd = (desc: string) => z.number().finite().min(0).describe(desc);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const FeeBasisSchema = z.enum(["fixed", "pctPurchase", "pctSale", "pctAsIs"]);

/** value is dollars when the basis is fixed, otherwise a fraction (0.01 for 1 percent). */
export const FeeItemSchema = z.object({ name: z.string().max(80), value: z.number().finite().min(0), basis: FeeBasisSchema });

export const MonthlyCostSchema = z.object({ name: z.string().max(80), amount: usd("Charged at each month start of the hold") });

export const InterestBasisSchema = z.enum(["fullCommitment", "drawnBalance"]);

export const FinancingLoanSchema = z.object({
  name: z.string().max(80),
  purchaseFunding: usd("Part of the purchase price this loan funds"),
  rehabFunding: usd("Part of the rehab this loan funds, released through draws"),
  annualRate: z.number().min(0).max(0.5).describe("Annual interest rate, 0.12 for 12 percent"),
  points: z.number().min(0).max(0.15).describe("Points as a fraction of the commitment"),
  fixedFees: usd("Lender fees in dollars"),
  interestBasis: InterestBasisSchema,
});

export const DrawTrancheSchema = z.object({
  timingPercent: z.number().min(0).max(1).describe("Share of the hold period that has passed when the draw arrives"),
  fundingPercent: z.number().min(0).max(1).describe("Share of each loan's rehab funding released by this draw"),
});

export const RehabExpenseEventSchema = z.object({ date: isoDate, amount: usd("Rehab spend on this date") });
export const CashAdjustmentSchema = z.object({ name: z.string().max(80), date: isoDate, amount: z.number().finite().describe("Positive for income, negative for an expense") });

export const RentalProjectionAssumptionsSchema = z.object({
  years: z.number().int().min(1).max(40),
  ownerFundedRehab: usd("Initial rehab paid by the owner, part of the return denominator"),
  depreciableBasis: usd("Building value that can be depreciated"),
  depreciationYears: z.number().min(1).max(50),
  marginalTaxRate: z.number().min(0).max(1),
});

/**
 * The second financing and cash flow model, taken from the Mac app. Optional on a deal and off by default.
 * Nothing in here feeds acquisitions(), so the workbook numbers and the golden fixtures cannot move.
 */
export const ProjectModelInputSchema = z.object({
  startDate: isoDate.nullable().optional(),
  initialCash: usd("Initial owner cash").optional(),
  loans: z.array(FinancingLoanSchema).max(6),
  buyingFees: z.array(FeeItemSchema).max(20),
  sellingFees: z.array(FeeItemSchema).max(20),
  holdingCosts: z.array(MonthlyCostSchema).max(30),
  drawMode: z.enum(["upfront", "delayed"]),
  upfrontDraws: z.array(DrawTrancheSchema).max(12),
  delayedDraws: z.array(DrawTrancheSchema).max(12),
  useCustomRehabSchedule: z.boolean(),
  rehabExpenseEvents: z.array(RehabExpenseEventSchema).max(100),
  customCashEvents: z.array(CashAdjustmentSchema).max(100),
  rentalProjection: RentalProjectionAssumptionsSchema.nullable().optional(),
});

export type FeeBasis = z.infer<typeof FeeBasisSchema>;
export type FeeItem = z.infer<typeof FeeItemSchema>;
export type MonthlyCost = z.infer<typeof MonthlyCostSchema>;
export type InterestBasis = z.infer<typeof InterestBasisSchema>;
export type FinancingLoan = z.infer<typeof FinancingLoanSchema>;
export type DrawTranche = z.infer<typeof DrawTrancheSchema>;
export type RehabExpenseEvent = z.infer<typeof RehabExpenseEventSchema>;
export type CashAdjustment = z.infer<typeof CashAdjustmentSchema>;
export type RentalProjectionAssumptions = z.infer<typeof RentalProjectionAssumptionsSchema>;
export type ProjectModelInput = z.infer<typeof ProjectModelInputSchema>;

/** The Mac app's default tranches: three draws of a third each, the last taking what the first two leave. */
function defaultDraws(timings: [number, number, number]): DrawTranche[] {
  return [{ timingPercent: timings[0], fundingPercent: 1 / 3 }, { timingPercent: timings[1], fundingPercent: 1 / 3 }, { timingPercent: timings[2], fundingPercent: 1 - 2 * (1 / 3) }];
}

export function emptyProjectModel(): ProjectModelInput {
  return {
    startDate: null, initialCash: 0, loans: [], buyingFees: [], sellingFees: [], holdingCosts: [],
    drawMode: "delayed", upfrontDraws: defaultDraws([0.01, 0.33, 0.66]), delayedDraws: defaultDraws([0.25, 0.5, 0.75]), useCustomRehabSchedule: false, rehabExpenseEvents: [], customCashEvents: [], rentalProjection: null,
  };
}
