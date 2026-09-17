import { acquisitions, type AcquisitionsInput } from "./acquisitions";

export type SensitivityKey = "arv" | "repairCosts" | "purchasePrice" | "holdMonths";
export type SensitivityAxis = { key: SensitivityKey; values: number[] };
export type SensitivityCell = { row: number; col: number; netProfit: number; roiOnCash: number };
export type SensitivityGrid = { rowAxis: SensitivityAxis; colAxis: SensitivityAxis; cells: SensitivityCell[][] };

/** Reruns the flip analysis over two axes. Pure; the UI renders the grid. */
export function sensitivityGrid(base: AcquisitionsInput, rowAxis: SensitivityAxis, colAxis: SensitivityAxis): SensitivityGrid {
  const cells = rowAxis.values.map((rowValue) =>
    colAxis.values.map((colValue) => {
      const input: AcquisitionsInput = { ...base, [rowAxis.key]: rowValue, [colAxis.key]: colValue };
      if (rowAxis.key === "repairCosts" || colAxis.key === "repairCosts") {
        // A repair axis must win over the linked checklist and any override.
        delete input.rehab;
        input.repairCostsOverride = null;
      }
      const out = acquisitions(input);
      return { row: rowValue, col: colValue, netProfit: out.netProfit, roiOnCash: out.roiOnCash };
    }),
  );
  return { rowAxis, colAxis, cells };
}

/** Multiplier helper: base value times each factor. */
export function scaled(value: number, factors: number[]): number[] {
  return factors.map((f) => value * f);
}
