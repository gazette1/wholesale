import type { FeeItem } from "./schemas";
import type { ProjectContext } from "./types";

export type FeeLine = { name: string; basis: FeeItem["basis"]; amount: number };
export type FeeTotals = { lines: FeeLine[]; total: number };

export function feeAmount(item: FeeItem, ctx: ProjectContext): number {
  switch (item.basis) {
    case "fixed": return item.value;
    case "pctPurchase": return item.value * ctx.purchasePrice;
    case "pctSale": return item.value * ctx.salePrice;
    case "pctAsIs": return item.value * ctx.asIsValue;
  }
}

export function feeTotals(items: FeeItem[], ctx: ProjectContext): FeeTotals {
  const lines = items.map((item) => ({ name: item.name, basis: item.basis, amount: feeAmount(item, ctx) }));
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}
