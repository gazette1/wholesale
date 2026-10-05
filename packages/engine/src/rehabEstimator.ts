export type RehabLine = {
  row: number;
  itemNumber: number | null;
  question: string | null;
  option: string | null;
  answer: "Yes" | "No" | null;
  quantity: number | null;
  unitCost: number | null;
  status?: "todo" | "in_progress" | "done" | null;
  notes?: string | null;
  custom?: boolean;
};

export type RehabEstimatorInput = { address?: string | null; lines: RehabLine[] };
export type RehabEstimatorOutput = { lineTotals: number[]; total: number };

export function rehabLineTotal(line: RehabLine): number {
  // I3:I69 = IF(E="Yes", H*F, 0). Empty H or F behave as 0 in Excel arithmetic.
  return line.answer === "Yes" ? (line.unitCost ?? 0) * (line.quantity ?? 0) : 0;
}

export function rehabEstimator(input: RehabEstimatorInput): RehabEstimatorOutput {
  const lineTotals = input.lines.map(rehabLineTotal);
  const total = lineTotals.reduce((a, b) => a + b, 0);   // I1
  return { lineTotals, total };
}
