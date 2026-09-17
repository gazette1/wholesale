import { roundUp } from "./money";
import { withFlags, type AnomalyFlags } from "./anomalies";
import type { WeekRow } from "./types";

export type DrawSchedule = "delayed" | "upfront";

export const COST_COLUMNS = [
  "constructionCosts", "purchasePrice", "firstPoints", "firstInterest", "firstInterestOnly",
  "propertyTaxes", "hoa", "insurance", "gas", "water", "electricity", "miscUtilities",
  "buyEscrow", "buyTitle", "buyMisc",
  "sellEscrow", "sellRecording", "sellRealtor", "sellTransfer", "sellHomeWarranty",
  "sellStaging", "sellMarketing", "sellMisc",
] as const;
export type CostColumn = (typeof COST_COLUMNS)[number];

/** Extra column that exists only when flag utilitiesInCashFlow is on (A-22). */
export type ExtendedCostColumn = CostColumn | "utilities";

type Timing = "weekly" | "monthly" | "oneTimeStart" | "oneTimeEnd";

/** Timing is fixed per column by the sheet's formulas. The row 4 labels are not referenced (ANOMALY-A-09). */
const TIMING: Record<CostColumn, Timing> = {
  constructionCosts: "weekly",
  purchasePrice: "oneTimeStart", firstPoints: "oneTimeStart",
  firstInterest: "monthly", firstInterestOnly: "monthly",
  propertyTaxes: "oneTimeStart", hoa: "oneTimeStart",                // ANOMALY-A-24
  insurance: "monthly", gas: "monthly", water: "monthly", electricity: "monthly", miscUtilities: "monthly",
  buyEscrow: "oneTimeStart", buyTitle: "oneTimeStart", buyMisc: "oneTimeStart",
  sellEscrow: "oneTimeEnd", sellRecording: "oneTimeEnd", sellRealtor: "oneTimeEnd", sellTransfer: "oneTimeEnd",
  sellHomeWarranty: "oneTimeEnd", sellStaging: "oneTimeEnd", sellMarketing: "oneTimeEnd", sellMisc: "oneTimeEnd",
};

export const DEFAULT_DRAW_PERCENTS: Record<DrawSchedule, [number, number, number]> = {
  delayed: [0.25, 0.5, 0.75],
  upfront: [0.01, 0.33, 0.66],
};

export const WEEKS_PER_MONTH = 4;          // F4 = holdMonths * 4 (ANOMALY-A-32)
export const MONTHLY_CADENCE_WEEKS = 4;    // monthly costs land every 4 weeks
export const REMAINDER_TOLERANCE = 0.1;    // every "is there cost left" test

export type DrawCashFlowInput = {
  schedule: DrawSchedule;
  /** Rows 6 to 41 on the sheet. 36 for parity. See A-07. */
  maxWeeks: number;
  holdMonths: number;
  beginningCashBalance: number;
  purchasePrice: number;
  repairCosts: number;
  arv: number;
  drawPercents?: [number, number, number];
  costTotals: Record<CostColumn, number> & { utilities?: number };
  otherExpenses?: { week: number; amount: number }[];
  flags?: Partial<AnomalyFlags>;
};

export type CashInRow = { label: string; week: number; amount: number };

export type DrawCashFlowOutput = {
  schedule: DrawSchedule;
  durationWeeks: number;
  drawWeeks: [number, number, number];
  cashInTable: CashInRow[];
  netCashIn: number;
  weeks: WeekRow[];
  grid: Record<ExtendedCostColumn, number[]>;
  columnTotals: Record<ExtendedCostColumn, number>;
  unaccounted: Record<ExtendedCostColumn, number>;
  totalExpenses: number;
  endingBalance: number;
  excessCash: number;
  minBalance: number;
  minBalanceWeek: number;
  warnings: string[];
};

function weeklyColumn(total: number, durationWeeks: number, maxWeeks: number, flags: AnomalyFlags): number[] {
  const cost: number[] = new Array(maxWeeks).fill(0);
  if (maxWeeks === 0) return cost;
  cost[0] = durationWeeks === 0 ? 0 : total / durationWeeks;          // L6 = L3 / F4
  for (let w = 2; w <= maxWeeks; w++) {
    let spent = 0;
    for (let k = 1; k < w; k++) spent += cost[k - 1] ?? 0;
    if (w === 11 && !flags.fixConstructionWeek11) {
      // ANOMALY-A-17: L16 subtracts the literal 15 instead of L15.
      spent = spent - (cost[9] ?? 0) + 15;
    }
    cost[w - 1] = total - spent > REMAINDER_TOLERANCE ? (cost[w - 2] ?? 0) : 0;
  }
  return cost;
}

function monthlyColumn(total: number, holdMonths: number, maxWeeks: number): number[] {
  const cost: number[] = new Array(maxWeeks).fill(0);
  if (maxWeeks === 0) return cost;
  cost[0] = holdMonths === 0 ? 0 : total / holdMonths;                 // O6 = O3 / holdMonths
  let placed = cost[0] ?? 0;
  let previous = cost[0] ?? 0;
  for (let w = 1 + MONTHLY_CADENCE_WEEKS; w <= maxWeeks; w += MONTHLY_CADENCE_WEEKS) {
    const value = total - placed > REMAINDER_TOLERANCE ? previous : 0;  // O10 = IF(O3 - O6 > 0.1, O6, 0)
    cost[w - 1] = value;
    placed += value;
    previous = value;
  }
  return cost;
}

function oneTimeStartColumn(total: number, maxWeeks: number): number[] {
  const cost: number[] = new Array(maxWeeks).fill(0);
  if (maxWeeks > 0) cost[0] = total;                                   // M6 = M3
  return cost;
}

function oneTimeEndColumn(total: number, durationWeeks: number, maxWeeks: number): number[] {
  const cost: number[] = new Array(maxWeeks).fill(0);
  for (let w = 1; w <= maxWeeks; w++) cost[w - 1] = w === durationWeeks ? total : 0;   // AA6 = IF(K6 = F4, AA3, 0)
  return cost;
}

export function drawCashFlow(input: DrawCashFlowInput): DrawCashFlowOutput {
  const flags = withFlags(input.flags);
  const warnings: string[] = [];
  const maxWeeks = Math.max(0, Math.floor(input.maxWeeks));
  const durationWeeks = input.holdMonths * WEEKS_PER_MONTH;            // F4
  if (durationWeeks > maxWeeks) {
    warnings.push(`Duration of ${durationWeeks} weeks exceeds the ${maxWeeks} week grid (A-07). Events past week ${maxWeeks} are dropped.`);
  }
  if (durationWeeks === 0) warnings.push("Hold time is 0 months. Weekly construction cost cannot be spread (division by zero on the sheet).");

  const pct = input.drawPercents ?? DEFAULT_DRAW_PERCENTS[input.schedule];
  const roundDraws = input.schedule === "upfront" || flags.roundDelayedDrawWeeks;   // ANOMALY-A-08
  const drawWeeks = pct.map((p) => (roundDraws ? roundUp(durationWeeks * p, 0) : durationWeeks * p)) as [number, number, number];
  drawWeeks.forEach((w, i) => {
    if (!Number.isInteger(w)) warnings.push(`Draw ${i + 1} lands on fractional week ${w} and will not match any week (A-08).`);
  });

  const drawAmount = input.repairCosts / 3;                             // D7:D9
  const cashInTable: CashInRow[] = [
    { label: "Lender Purchase Loan", week: 1, amount: input.purchasePrice },
    { label: `Lender Draw 1 at ${Math.round(pct[0] * 100)}%`, week: drawWeeks[0], amount: drawAmount },
    { label: `Lender Draw 2 at ${Math.round(pct[1] * 100)}%`, week: drawWeeks[1], amount: drawAmount },
    { label: `Lender Draw 3 at ${Math.round(pct[2] * 100)}%`, week: drawWeeks[2], amount: drawAmount },
    { label: "Property Sale", week: durationWeeks, amount: input.arv },
    { label: "Purchase Loan Repayment", week: durationWeeks, amount: -input.purchasePrice },
    { label: "Construction Loan Repayment", week: durationWeeks, amount: -input.repairCosts },
    ...(input.otherExpenses ?? []).map((e, i) => ({ label: `Other Expense ${i + 1}`, week: e.week, amount: e.amount })),
  ];
  const netCashIn = cashInTable.reduce((a, r) => a + r.amount, 0);     // C3

  const columns: ExtendedCostColumn[] = [...COST_COLUMNS];
  if (flags.utilitiesInCashFlow) columns.push("utilities");            // A-22 corrected form

  const grid = {} as Record<ExtendedCostColumn, number[]>;
  const columnTotals = {} as Record<ExtendedCostColumn, number>;
  const unaccounted = {} as Record<ExtendedCostColumn, number>;
  for (const col of columns) {
    const total = col === "utilities" ? (input.costTotals.utilities ?? 0) : input.costTotals[col];
    let timing: Timing = col === "utilities" ? "monthly" : TIMING[col];
    if (flags.monthlyTaxesAndHoa && (col === "propertyTaxes" || col === "hoa")) timing = "monthly";   // A-24 corrected form
    let values: number[];
    switch (timing) {
      case "weekly": values = weeklyColumn(total, durationWeeks, maxWeeks, flags); break;
      case "monthly": values = monthlyColumn(total, input.holdMonths, maxWeeks); break;
      case "oneTimeStart": values = oneTimeStartColumn(total, maxWeeks); break;
      case "oneTimeEnd": values = oneTimeEndColumn(total, durationWeeks, maxWeeks); break;
    }
    grid[col] = values;
    columnTotals[col] = values.reduce((a, b) => a + b, 0);            // L42:AH42
    unaccounted[col] = total - columnTotals[col];                      // L43:AH43
  }

  const weeks: WeekRow[] = [];
  let balance = input.beginningCashBalance;                            // H3 (H4 is empty)
  for (let w = 1; w <= maxWeeks; w++) {
    let expenses = 0;
    for (const col of columns) expenses += grid[col][w - 1] ?? 0;      // I = SUM(L:AH)
    let cashIn = 0;
    for (const row of cashInTable) if (row.week === w) cashIn += row.amount;   // G = SUMIF(week)
    balance = balance - expenses + cashIn;                             // H = H(prev) - I + G
    weeks.push({ week: w, cashIn, expenses, balance });
  }

  const totalExpenses = weeks.reduce((a, r) => a + r.expenses, 0);    // I4
  const balances = weeks.map((r) => r.balance);
  const endingBalance = balances.length ? (balances[balances.length - 1] as number) : input.beginningCashBalance;   // H43 (last numeric)
  const excessCash = endingBalance - input.beginningCashBalance;      // E43
  let minBalance = Number.POSITIVE_INFINITY;
  let minBalanceWeek = 0;
  balances.forEach((b, i) => { if (b < minBalance) { minBalance = b; minBalanceWeek = i + 1; } });
  if (!balances.length) { minBalance = input.beginningCashBalance; minBalanceWeek = 0; }

  return {
    schedule: input.schedule, durationWeeks, drawWeeks, cashInTable, netCashIn, weeks, grid,
    columnTotals, unaccounted, totalExpenses, endingBalance, excessCash, minBalance, minBalanceWeek, warnings,
  };
}
