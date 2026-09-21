import type { MonthlyCost } from "./schemas";
import { monthStarts } from "./types";

export type HoldingLine = { name: string; monthly: number; total: number };
export type HoldingLinesResult = { lines: HoldingLine[]; monthlyTotal: number; months: number; total: number };

export function holdingLines(items: MonthlyCost[], holdMonths: number): HoldingLinesResult {
  const months = monthStarts(holdMonths);
  const lines = items.map((i) => ({ name: i.name, monthly: i.amount, total: i.amount * months }));
  const monthlyTotal = items.reduce((a, i) => a + i.amount, 0);
  return { lines, monthlyTotal, months, total: monthlyTotal * months };
}
