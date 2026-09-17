import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = resolve(here, "../../../spec/golden");

export function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(resolve(GOLDEN_DIR, name), "utf-8")) as T;
}

/**
 * Tolerance policy from docs/ARCHITECTURE.md section 3:
 * 0.01 for currency, 1e-6 for ratios and percentages. A value is a ratio when
 * its label names one (pct, rate, roi, dcr, ratio, loanToValue, or a known
 * ratio cell) or when kind is passed. The workbook's cached values carry about
 * 10 significant digits, so a balance near zero can differ from an exact
 * recomputation by a few millionths; the currency bound absorbs that.
 */
const RATIO_LABEL = /pct|rate|roi|dcr|ratio|loanToValue|probability/i;

export function expectClose(actual: number, expected: number | null | undefined, label: string, kind?: "currency" | "ratio"): void {
  const e = expected ?? 0;
  const isRatio = kind ? kind === "ratio" : RATIO_LABEL.test(label);
  const tol = isRatio ? 1e-6 : 0.01;
  const diff = Math.abs(actual - e);
  if (!(diff <= tol)) {
    expect.fail(`${label}: expected ${e}, got ${actual} (diff ${diff}, tolerance ${tol})`);
  }
}

export function expectCloseArray(actual: number[], expected: Array<number | null>, label: string): void {
  expect(actual.length, `${label}: length`).toBe(expected.length);
  actual.forEach((a, i) => expectClose(a, expected[i], `${label}[${i}]`));
}

import type { AcquisitionsInput, BuyAndHoldInput } from "../src";

export function acquisitionsInputFromFixture(): AcquisitionsInput {
  const i = loadFixture("acquisitions.json").inputs;
  return {
    holdMonths: i.holdMonths, asIsValue: i.asIsValue, purchasePrice: i.purchasePrice, arv: i.arv,
    repairCosts: i.repairCosts, assignmentFee: i.assignmentFee,
    firstLienAmount: i.firstLienAmount, firstPointsRate: i.firstPointsRate, firstInterestRate: i.firstInterestRate,
    firstMonthlyInterestOnlyRate: i.firstMonthlyInterestOnlyRate,
    secondLienAmount: i.secondLienAmount, secondPointsRate: i.secondPointsRate, secondInterestRate: i.secondInterestRate,
    secondMonthlyInterestOnlyRate: i.secondMonthlyInterestOnlyRate,
    miscLienAmountPaid: i.miscLienAmountPaid, miscPointsPaid: i.miscPointsPaid, miscInterestPaid: i.miscInterestPaid,
    miscMonthlyInterestOnlyPaid: i.miscMonthlyInterestOnlyPaid, miscFinancingCosts: i.miscFinancingCosts,
    propertyTaxRate: i.propertyTaxRate, hoaMonthly: i.hoaMonthly, insuranceMonthly: i.insuranceMonthly, utilitiesMonthly: i.utilitiesMonthly,
    gasMonthly: i.gasMonthly, waterMonthly: i.waterMonthly, electricityMonthly: i.electricityMonthly, miscUtilitiesMonthly: i.miscUtilitiesMonthly,
    miscHoldingMonthly: [i.miscHoldingMonthly1, i.miscHoldingMonthly2, i.miscHoldingMonthly3, i.miscHoldingMonthly4],
    buyEscrowRate: i.buyEscrowRate, buyTitleRate: i.buyTitleRate, buyMiscRate: i.buyMiscRate,
    sellEscrowRate: i.sellEscrowRate, sellRecordingRate: i.sellRecordingRate, sellRealtorRate: i.sellRealtorRate, sellTransferRate: i.sellTransferRate,
    sellHomeWarranty: i.sellHomeWarranty, sellStaging: i.sellStaging, sellMarketing: i.sellMarketing, sellMisc: i.sellMisc,
  };
}

export function buyAndHoldInputFromFixture(): BuyAndHoldInput {
  const i = loadFixture("buy-and-hold.json").inputs;
  return {
    salePrice: i.salePrice, taxValue: i.taxValue, units: i.units,
    propertyTaxYear: i.propertyTaxYear, insuranceMonth: i.insuranceMonth, gasElectricMonth: i.gasElectricMonth,
    waterMonth: i.waterMonth, sewerMonth: i.sewerMonth, garbageMonth: i.garbageMonth, lawnSnowMonth: i.lawnSnowMonth,
    managementPct: i.managementPct, vacancyPct: i.vacancyPct, maintenancePct: i.maintenancePct, cashReservesPct: i.cashReservesPct,
    downPaymentPct: i.downPaymentPct, interestRate: i.interestRate, loanTermYears: i.loanTermYears, closingCosts: i.closingCosts,
    improvedValueRatio: i.improvedValueRatio, marginalTaxRate: i.marginalTaxRate, appreciationRate: i.appreciationRate,
    rentGrowthRate: i.rentGrowthRate, dcrRequired: i.dcrRequired,
  };
}
