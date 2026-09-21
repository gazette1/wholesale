import type { MonthlyCost } from "./schemas";

export type HoldingLine = { name: string; monthly: number; total: number };
export type HoldingLinesResult = { lines: HoldingLine[]; monthlyTotal: number; months: number; total: number };

/** Flip holding is the monthly total times the hold months, as the Mac app's flip result computes it. */
export function holdingLines(items: MonthlyCost[], holdMonths: number): HoldingLinesResult {
  const months = Math.max(0, holdMonths);
  const lines = items.map((i) => ({ name: i.name, monthly: i.amount, total: i.amount * months }));
  const monthlyTotal = items.reduce((a, i) => a + i.amount, 0);
  return { lines, monthlyTotal, months, total: monthlyTotal * months };
}
