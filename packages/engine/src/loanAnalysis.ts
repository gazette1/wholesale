import { parseIsoDate, toIsoDate } from "./money";

/**
 * Plain fixed rate amortization for the Loan analysis tab. Separate from
 * amortization.ts, which reproduces the workbook sheet cell for cell (negative
 * loan amount, sheet month lengths). This one takes positive numbers and
 * calendar months.
 */
export type LoanAnalysisInput = {
  principal: number;
  /** Annual rate, 0.075 for 7.5 percent. */
  annualRate: number;
  /** 1 to 600. */
  months: number;
  /** ISO date of the first payment. */
  firstPaymentDate: string;
  /** Show the balance after this payment number. */
  payoffAfterPayment?: number | null;
};

export type PaymentRow = {
  number: number; date: string; beginning: number; payment: number; principal: number; interest: number; ending: number;
  cumulativePrincipal: number; cumulativeInterest: number;
};

export type LoanAnalysisOutput = {
  payment: number; totalInterest: number; totalPaid: number; rows: PaymentRow[];
  payoffAfterPayment: number | null; payoffBalance: number | null; payoffDate: string | null; interestPaidByPayoff: number | null;
};

function addMonths(iso: string, n: number): string {
  const d = parseIsoDate(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return toIsoDate(target);
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function loanAnalysis(input: LoanAnalysisInput): LoanAnalysisOutput {
  const n = Math.floor(input.months);
  if (!(n >= 1 && n <= 600)) throw new Error("Loan term must be between 1 and 600 months.");
  if (!(input.principal > 0)) throw new Error("Principal must be greater than zero.");
  if (!(input.annualRate >= 0)) throw new Error("The loan payment could not be calculated for these inputs.");
  const r = input.annualRate / 12;
  const payment = r === 0 ? input.principal / n : (input.principal * r) / (1 - Math.pow(1 + r, -n));
  if (!Number.isFinite(payment)) throw new Error("The loan payment could not be calculated for these inputs.");
  const rows: PaymentRow[] = [];
  let balance = input.principal;
  let cumP = 0;
  let cumI = 0;
  for (let k = 1; k <= n; k++) {
    const interest = cents(balance * r);
    // The final payment clears the remaining balance so rounding never leaves a residue.
    const principal = k === n ? cents(balance) : cents(payment - interest);
    const pay = cents(principal + interest);
    const ending = cents(balance - principal);
    cumP = cents(cumP + principal);
    cumI = cents(cumI + interest);
    rows.push({ number: k, date: addMonths(input.firstPaymentDate, k - 1), beginning: cents(balance), payment: pay, principal, interest, ending, cumulativePrincipal: cumP, cumulativeInterest: cumI });
    balance = ending;
  }
  const after = input.payoffAfterPayment != null && input.payoffAfterPayment >= 1 ? Math.min(n, Math.floor(input.payoffAfterPayment)) : null;
  const row = after !== null ? rows[after - 1] ?? null : null;
  return {
    payment: cents(payment), totalInterest: cumI, totalPaid: cents(cumI + input.principal), rows,
    payoffAfterPayment: after, payoffBalance: row ? row.ending : null, payoffDate: row ? row.date : null, interestPaidByPayoff: row ? row.cumulativeInterest : null,
  };
}
