import { describe, it } from "vitest";
import { buyAndHold } from "../src";
import { loadFixture, expectClose, buyAndHoldInputFromFixture } from "./helpers";

const fx = loadFixture("buy-and-hold.json");

function checkProForma(actual: any, expected: any, label: string) {
  for (const key of Object.keys(expected)) expectClose(actual[key], expected[key], `${label}.${key}`);
}

describe("Buy and Hold golden", () => {
  const out = buyAndHold(buyAndHoldInputFromFixture());
  const e = fx.expected;

  it("current and market pro forma blocks", () => {
    checkProForma(out.current, e.current, "current");
    checkProForma(out.market, e.market, "market");
    expectClose(out.totalRent, e.totalRent, "E29");
    expectClose(out.totalMarketRent, e.totalMarketRent, "F29");
  });

  it("five year debt paydown with CUMIPMT", () => {
    e.debtPaydown.forEach((row: any, i: number) => {
      expectClose(out.debtPaydown[i]!.totalDebtPaydown, row.totalDebtPaydown, `paydown year ${row.year}`);
      expectClose(out.debtPaydown[i]!.roiOnPaydown, row.roiOnPaydown, `roiOnPaydown year ${row.year}`);
    });
    e.taxDeductions.forEach((row: any, i: number) => {
      expectClose(out.taxDeductions[i]!.depreciation, row.depreciation, `depreciation year ${row.year}`);
      expectClose(out.taxDeductions[i]!.totalInterestPaid, row.totalInterestPaid, `interest year ${row.year}`);
      expectClose(out.taxDeductions[i]!.totalDeductions, row.totalDeductions, `deductions year ${row.year}`);
    });
    expectClose(out.avgYearlyTaxSavings, e.avgYearlyTaxSavings, "P40");
    expectClose(out.annualRoiOnTaxSavings, e.annualRoiOnTaxSavings, "P41");
  });

  it("debt coverage ratio blocks", () => {
    checkProForma(out.dcr.proForma, e.dcr.proForma, "dcr.proForma");
    checkProForma(out.dcr.actual, e.dcr.actual, "dcr.actual");
  });

  it("appreciation, total return, rent growth", () => {
    e.appreciation.forEach((row: any, i: number) => {
      expectClose(out.appreciation[i]!.estValue, row.estValue, `S${27 + i}`);
      expectClose(out.appreciation[i]!.annualGain, row.annualGain, `T${27 + i}`);
      expectClose(out.appreciation[i]!.pctGain, row.pctGain, `pctGain U${27 + i}`);
    });
    e.totalReturn.forEach((row: any, i: number) => {
      for (const key of ["cashFlow", "debtPaydown", "taxSavings", "appreciation", "totalRoi", "totalDollarReturn"]) {
        expectClose((out.totalReturn[i] as any)[key], row[key], `totalReturn year ${row.year}.${key}`, key === "totalDollarReturn" ? "currency" : "ratio");
      }
    });
    e.rentGrowth.forEach((row: any, i: number) => expectClose(out.rentGrowth[i]!.marketRent, row.marketRent, `Z${9 + i}`));
    expectClose(out.marketRentYear1, e.marketRentYear1, "Z6");
  });
});
