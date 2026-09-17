import { pmt, SHEET_DAYS_IN_MONTH, parseIsoDate, toIsoDate, addDays, monthOf, calendarDaysInMonth } from "./money";
import { withFlags, type AnomalyFlags } from "./anomalies";

export type AmortizationInput = {
  /** Entered negative on the sheet (B2). */
  loanAmount: number;
  annualRate: number;
  periods: number;
  /** ISO date. Replaces TODAY() (A-14). */
  startDate: string;
  daysInMonth?: number[];
  payoffLookupMonths?: number[];
  monthlyInsurance?: number;
  monthlyRevenue?: number;
  flags?: Partial<AnomalyFlags>;
};

export type AmortizationRow = {
  period: number; date: string; daysInMonth: number; beginningBalance: number; payment: number;
  principal: number; interest: number; cumulativePrincipal: number; cumulativeInterest: number; endingBalance: number;
};

export type AmortizationOutput = {
  payment: number;
  rows: AmortizationRow[];
  payoffAmounts: number[];
  totalPrincipal: number;
  totalInterest: number;
  /** ANOMALY-A-13: the vehicle deal side table. Reproduced for parity, not shown in the product. */
  side: {
    monthlyOpsProfit: number;
    ownerRealizedProfit: number[];
    vdaRealizedProfit: number[];
    rows: { month: number; payment: number; insurance: number; revenue: number; profit: number; financialRisk: number; investorProfit: number; vdaProfit: number }[];
    totals: { revenue: number; profit: number; investorProfit: number; vdaProfit: number };
  };
};

export const OWNER_SHARE = 0.35;
export const VDA_SHARE = 0.65;

export function amortization(input: AmortizationInput): AmortizationOutput {
  const flags = withFlags(input.flags);
  const monthlyRate = input.annualRate / 12;
  const payment = pmt(monthlyRate, input.periods, input.loanAmount, 0, 0);            // B5
  const table = input.daysInMonth ?? [...SHEET_DAYS_IN_MONTH];
  const lookups = input.payoffLookupMonths ?? [21, 30, 45, 50, 55, 60];
  const monthlyInsurance = input.monthlyInsurance ?? 300;
  const monthlyRevenue = input.monthlyRevenue ?? 15000;

  const rows: AmortizationRow[] = [];
  let date = parseIsoDate(input.startDate);                                            // C10 = TODAY() on the sheet (ANOMALY-A-14)
  let beginningBalance = -input.loanAmount;                                            // D10 = B2 * -1
  let cumulativePrincipal = 0;
  let cumulativeInterest = 0;
  for (let period = 1; period <= input.periods; period++) {
    // ANOMALY-A-28: the sheet reads a typed 12 month table with February at 28 days.
    const daysInMonth = flags.calendarMonthLengths ? calendarDaysInMonth(date) : (table[monthOf(date) - 1] ?? 30);   // A10:A69
    const interest = beginningBalance * monthlyRate;                                   // G
    const principal = payment - interest;                                              // F = E - G
    // H10 and I10 are typed 0 on the sheet; H11 = F10 + F11, so the running total catches up at period 2.
    if (period === 1) {
      cumulativePrincipal = 0;
      cumulativeInterest = 0;
    } else if (period === 2) {
      cumulativePrincipal = rows[0]!.principal + principal;
      cumulativeInterest = rows[0]!.interest + interest;
    } else {
      cumulativePrincipal += principal;
      cumulativeInterest += interest;
    }
    const endingBalance = beginningBalance - principal;                                // J = D - F
    rows.push({ period, date: toIsoDate(date), daysInMonth, beginningBalance, payment, principal, interest, cumulativePrincipal, cumulativeInterest, endingBalance });
    date = addDays(date, daysInMonth);                                                 // C(next) = C + A
    beginningBalance = endingBalance;                                                  // D(next) = J
  }

  // E5:J5 = VLOOKUP(month, B9:J69, 3): approximate match on period, returns the beginning balance.
  const payoffAmounts = lookups.map((m) => {
    let match: AmortizationRow | undefined;
    for (const r of rows) if (r.period <= m) match = r;
    return match ? match.beginningBalance : NaN;
  });

  const totalPrincipal = rows.reduce((a, r) => a + r.principal, 0);                    // F71
  const totalInterest = rows.reduce((a, r) => a + r.interest, 0);                      // G71

  // ANOMALY-A-13: rows 6 to 7 and columns P to W describe a vehicle deal.
  const monthlyOpsProfit = 1000 * 4 - payment - 250;                                   // B6
  const ownerRealizedProfit = lookups.map((m) => monthlyOpsProfit * OWNER_SHARE * m);   // E6:J6
  const vdaRealizedProfit = lookups.map((m) => monthlyOpsProfit * VDA_SHARE * m);       // E7:J7
  const sideRows = rows.map((r) => {
    const profit = monthlyRevenue - monthlyInsurance - payment;                        // T = S - R - Q
    return { month: r.period, payment, insurance: monthlyInsurance, revenue: monthlyRevenue, profit, financialRisk: r.endingBalance, investorProfit: profit * OWNER_SHARE, vdaProfit: profit * VDA_SHARE };
  });
  const totals = {
    revenue: sideRows.reduce((a, r) => a + r.revenue, 0),
    profit: sideRows.reduce((a, r) => a + r.profit, 0),
    investorProfit: sideRows.reduce((a, r) => a + r.investorProfit, 0),
    vdaProfit: sideRows.reduce((a, r) => a + r.vdaProfit, 0),
  };

  return { payment, rows, payoffAmounts, totalPrincipal, totalInterest, side: { monthlyOpsProfit, ownerRealizedProfit, vdaRealizedProfit, rows: sideRows, totals } };
}
