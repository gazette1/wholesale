import { describe, it, expect } from "vitest";
import { drawCashFlow, COST_COLUMNS, type DrawSchedule } from "../src";
import { loadFixture, expectClose, expectCloseArray } from "./helpers";

function run(name: string, schedule: DrawSchedule) {
  const fx = loadFixture(name);
  const out = drawCashFlow({
    schedule,
    maxWeeks: fx.inputs.maxWeeks,
    holdMonths: fx.inputs.holdMonths,
    beginningCashBalance: fx.inputs.beginningCashBalance,
    purchasePrice: fx.inputs.purchasePrice,
    repairCosts: fx.inputs.repairCosts,
    arv: fx.inputs.arv,
    drawPercents: fx.inputs.drawPercents,
    costTotals: fx.inputs.costTotals,
  });

  describe(`${schedule} draw cash flow golden`, () => {
    it("duration, net cash in, draw weeks", () => {
      expectClose(out.durationWeeks, fx.expected.durationWeeks, "F4");
      expectClose(out.netCashIn, fx.expected.netCashIn, "C3");
      expectClose(out.totalExpenses, fx.expected.totalExpenses, "I4");
      expectCloseArray(out.drawWeeks, fx.expected.drawWeeks, "C7:C9");
    });

    it("cash in table weeks and amounts", () => {
      fx.expected.cashInTable.forEach((row: any, i: number) => {
        expectClose(out.cashInTable[i]!.week, row.week, `D${row.row} week`);
        expectClose(out.cashInTable[i]!.amount, row.amount, `D${row.row} amount`);
      });
    });

    it("every weekly balance, cash in, and expense row", () => {
      expect(out.weeks.length).toBe(36);
      fx.expected.weeks.forEach((w: any, i: number) => {
        expectClose(out.weeks[i]!.cashIn, w.cashIn, `G${6 + i}`);
        expectClose(out.weeks[i]!.expenses, w.expenses, `I${6 + i}`);
        expectClose(out.weeks[i]!.balance, w.balance, `H${6 + i}`);
      });
    });

    it("weekly cost grid per column", () => {
      for (const col of COST_COLUMNS) {
        expectCloseArray(out.grid[col], fx.expected.weeklyCostGrid[col], `grid.${col}`);
      }
    });

    it("column totals and unaccounted", () => {
      for (const col of COST_COLUMNS) {
        expectClose(out.columnTotals[col], fx.expected.columnTotals[col], `total.${col}`);
        expectClose(out.unaccounted[col], fx.expected.unaccountedCosts[col], `unaccounted.${col}`);
      }
    });

    it("ending balance, excess cash, minimum", () => {
      expectClose(out.endingBalance, fx.expected.endingBalance, "H43");
      expectClose(out.excessCash, fx.expected.excessCash, "E43");
      expectClose(out.minBalance, fx.expected.minBalance, "min H6:H41");
      expect(out.minBalanceWeek).toBe(fx.expected.minBalanceWeek);
    });
  });
}

run("draw-cash-flow-delayed.json", "delayed");
run("draw-cash-flow-upfront.json", "upfront");
