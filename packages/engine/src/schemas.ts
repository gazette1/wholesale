import { z } from "zod";

/** Shared field helpers. Descriptions come from the Definitions sheet where one exists. */
const usd = (desc: string) => z.number().finite().describe(desc);
const pct = (desc: string, max = 1) => z.number().min(-1).max(max).describe(desc);
const count = (desc: string) => z.number().int().min(0).describe(desc);

export const QuickOffersInputSchema = z.object({
  comps: z.tuple([usd("Comp 1 sale price"), usd("Comp 2 sale price"), usd("Comp 3 sale price")]),
  squareFeet: z.number().min(0).describe("The total square footage of the entire interior of the property"),
  assignmentFee: z.object({ full: usd("Assignment fee, entered negative"), medium: usd("Assignment fee, entered negative"), light: usd("Assignment fee, entered negative") }),
  costPerSqft: z.object({ full: usd("Full rehab cost per square foot"), medium: usd("Medium rehab cost per square foot"), light: usd("Light rehab cost per square foot") }),
  valueWant: z.object({ probabilityOfSale: pct("Probability of sale"), timeMonths: z.number().positive(), effort: z.number().positive() }),
  valueAre: z.object({ probabilityOfSale: pct("Probability of sale"), timeMonths: z.number().positive(), effort: z.number().positive() }),
  arvFactor: pct("Share of ARV used for the offer, 0.70 on the sheet").optional(),
});

export const RehabLineSchema = z.object({
  row: z.number().int(),
  itemNumber: z.number().int().nullable(),
  question: z.string().nullable(),
  option: z.string().nullable(),
  answer: z.enum(["Yes", "No"]).nullable(),
  quantity: z.number().nullable(),
  unitCost: z.number().nullable(),
  /** Work tracking. Does not change the estimate. */
  status: z.enum(["todo", "in_progress", "done"]).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** True for items added by hand, outside the workbook checklist. */
  custom: z.boolean().optional(),
});
export const RehabEstimatorInputSchema = z.object({ address: z.string().nullable().optional(), lines: z.array(RehabLineSchema) });

export const AnomalyFlagsSchema = z.object({
  fixUpfrontRoiLink: z.boolean(), fixTransactionCostBases: z.boolean(), roundDelayedDrawWeeks: z.boolean(),
  fixConstructionWeek11: z.boolean(), fixUpfrontCashToCover: z.boolean(), secondInterestTimesHold: z.boolean(),
  utilitiesInCashFlow: z.boolean(), monthlyTaxesAndHoa: z.boolean(), fixDcrRentSets: z.boolean(), calendarMonthLengths: z.boolean(),
});

export const AcquisitionsInputSchema = z.object({
  holdMonths: z.number().min(0).describe("Estimated number of months you plan to own the property from purchase date to close of escrow sale date"),
  asIsValue: usd("Value of the property in current as is condition. Not factoring repairs needed."),
  purchasePrice: usd("The dollar amount you plan to purchase the property for"),
  arv: usd("Value of the property after all repairs have been made regardless of purchase price. Also known as Fair Market Value"),
  repairCosts: usd("The dollar amount of estimated repairs based on your analysis").optional(),
  rehab: RehabEstimatorInputSchema.optional(),
  repairCostsOverride: z.number().nullable().optional(),
  assignmentFee: usd("How much you want to make on the assignment, entered negative on the sheet"),
  firstLienAmount: usd("The 1st position loan amount borrowed to purchase the property and or fund the rehab"),
  firstPointsRate: pct("The 1st position points charged as a percent of the lien amount", 0.15),
  firstInterestRate: pct("The 1st position interest rate", 0.3),
  firstMonthlyInterestOnlyRate: pct("The 1st position interest only monthly rate", 0.03),
  secondLienAmount: usd("The 2nd position loan amount"),
  secondPointsRate: pct("The 2nd position points", 0.15),
  secondInterestRate: pct("The 2nd position interest rate", 0.3),
  secondMonthlyInterestOnlyRate: pct("The 2nd position interest only monthly rate", 0.03),
  miscLienAmountPaid: usd("Misc. position loan amount paid"),
  miscPointsPaid: usd("Misc. points paid"),
  miscInterestPaid: usd("Misc. interest paid"),
  miscMonthlyInterestOnlyPaid: usd("Misc. interest only paid"),
  miscFinancingCosts: usd("Any custom costs related to financing"),
  propertyTaxRate: pct("Annualized property tax rate applied to as is value", 0.1),
  hoaMonthly: usd("Home Owner Association fees typically charged monthly"),
  insuranceMonthly: usd("Vacant property insurance premium typically billed monthly"),
  utilitiesMonthly: usd("Combined value for gas, electricity, water utilities"),
  gasMonthly: usd("Gas per month"), waterMonthly: usd("Water per month"), electricityMonthly: usd("Electricity per month"), miscUtilitiesMonthly: usd("Miscellaneous per month"),
  miscHoldingMonthly: z.tuple([usd("Miscellaneous holding cost"), usd("Miscellaneous holding cost"), usd("Miscellaneous holding cost"), usd("Miscellaneous holding cost")]),
  buyEscrowRate: pct("Fees charged by attorney or escrow company at closing, typically a percent of sales price", 0.05),
  buyTitleRate: pct("Policy to insure clear and marketable title", 0.05),
  buyMiscRate: pct("Any custom costs related to buying transactions", 0.05),
  sellEscrowRate: pct("Fees charged by attorney or escrow company at closing", 0.05),
  sellRecordingRate: pct("County recorder fees charged by escrow company", 0.02),
  sellRealtorRate: pct("Commissions paid to realtors involved as part of the transaction", 0.07),
  sellTransferRate: pct("For the transfer of land charged by County from seller to buyer", 0.03),
  sellHomeWarranty: usd("Home warranty"), sellStaging: usd("Cost for getting property ready to sell by bringing in home furnishings"),
  sellMarketing: usd("Costs related to offline and online advertising, printing, and promotion"), sellMisc: usd("Any custom costs related to selling transactions"),
  arvFactor: pct("Share of ARV used for the offer").optional(),
  maxWeeks: z.number().int().min(0).optional(),
  flags: AnomalyFlagsSchema.partial().optional(),
});

export const UnitSchema = z.object({
  unit: z.number().nullable(), beds: z.number().nullable(), baths: z.number().nullable(),
  rent: z.number().nullable(), marketRent: z.number().nullable(),
});

export const BuyAndHoldInputSchema = z.object({
  salePrice: usd("Sale price"), taxValue: usd("Tax value"), units: z.array(UnitSchema).max(20),
  propertyTaxYear: usd("Property tax per year"), insuranceMonth: usd("Insurance per month"),
  gasElectricMonth: usd("Gas and electric per month"), waterMonth: usd("Water per month"), sewerMonth: usd("Sewer per month"),
  garbageMonth: usd("Garbage per month"), lawnSnowMonth: usd("Lawn and snow per month"),
  managementPct: pct("Management percent of gross rent", 0.5), vacancyPct: pct("Vacancy percent", 0.5), maintenancePct: pct("Maintenance percent", 0.5),
  cashReservesPct: pct("Cash reserves percent", 0.5), downPaymentPct: pct("Down payment percent"), interestRate: pct("Interest rate", 0.3),
  loanTermYears: z.number().positive(), closingCosts: usd("Closing costs"),
  improvedValueRatio: pct("Improved value to assessed value ratio"), marginalTaxRate: pct("Marginal tax rate"),
  appreciationRate: pct("Assumed annual appreciation", 0.3), rentGrowthRate: pct("Rent growth rate", 0.3), dcrRequired: z.number().positive(),
  dcrVacancyPct: pct("DCR vacancy percent", 0.5).optional(), dcrManagementPct: pct("DCR management percent", 0.5).optional(), dcrMaintenancePct: pct("DCR maintenance percent", 0.5).optional(),
  rentGrowthYears: z.number().int().min(1).max(40).optional(),
  flags: AnomalyFlagsSchema.partial().optional(),
});

export const AmortizationInputSchema = z.object({
  loanAmount: usd("Loan amount, entered negative on the sheet"), annualRate: pct("Interest rate", 0.3), periods: count("Number of monthly periods"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/), daysInMonth: z.array(z.number().int()).length(12).optional(),
  payoffLookupMonths: z.array(z.number().int()).optional(), monthlyInsurance: z.number().optional(), monthlyRevenue: z.number().optional(),
  flags: AnomalyFlagsSchema.partial().optional(),
});

export const WholesaleInputSchema = z.object({
  arv: usd("After repair value"), repairCosts: usd("Repair estimate"), assignmentFee: usd("Assignment fee or target margin, positive"),
  purchasePrice: usd("Proposed offer to the seller"), investorBuyPrice: z.number().nullable().optional(),
  closingCosts: z.number().optional(), holdingCosts: z.number().optional(), existingMortgagePayoff: z.number().optional(),
  sellerClosingCosts: z.number().optional(), arvFactor: pct("Share of ARV").optional(),
});

const SellerCaseSchema = z.object({
  outcome: usd("Dollar outcome for the seller in this case"), effort: z.number().min(0), months: z.number().min(0), probability: z.number().min(0).max(1),
});

export const DealOffersSchema = z.object({
  comparables: z.array(z.object({ label: z.string().max(120), value: usd("Comparable sale price") })).max(12),
  useComparableAverage: z.boolean(),
  squareFeet: z.number().min(0).describe("The total square footage of the entire interior of the property"),
  perSqft: z.object({ light: usd("Light rehab cost per square foot"), medium: usd("Medium rehab cost per square foot"), full: usd("Full rehab cost per square foot") }),
  sellerCurrent: SellerCaseSchema.nullable().optional(),
  sellerDesired: SellerCaseSchema.nullable().optional(),
});

export const RehabPlanSchema = z.object({
  source: z.enum(["checklist", "manual", "perSqft"]),
  perSqftRate: z.number().min(0).optional(),
  squareFeet: z.number().min(0).optional(),
});

export const LoanAnalysisInputSchema = z.object({
  principal: usd("Loan principal"), annualRate: pct("Annual interest rate", 0.5), months: z.number().int().min(1).max(600),
  firstPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/), payoffAfterPayment: z.number().int().min(1).nullable().optional(),
});

export const ProgressEventSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}/), message: z.string().min(1).max(300) });

export const DealInputSchema = z.object({
  meta: z.object({ name: z.string(), address: z.string().optional(), notes: z.string().optional(), strategy: z.enum(["wholesale", "flip", "rental"]).optional() }),
  offers: DealOffersSchema.optional(),
  rehabPlan: RehabPlanSchema.optional(),
  progress: z.array(ProgressEventSchema).max(200).optional(),
  loan: LoanAnalysisInputSchema.optional(),
  quickOffers: QuickOffersInputSchema.optional(),
  rehab: RehabEstimatorInputSchema,
  acquisitions: AcquisitionsInputSchema,
  wholesale: WholesaleInputSchema.optional(),
  buyAndHold: BuyAndHoldInputSchema.optional(),
  amortization: AmortizationInputSchema.optional(),
  flags: AnomalyFlagsSchema.partial().optional(),
});
export type DealInput = z.infer<typeof DealInputSchema>;
