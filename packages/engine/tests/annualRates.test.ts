import { describe, it, expect } from "vitest";
import { acquisitions, annualRates } from "../src";
import { acquisitionsInputFromFixture } from "./helpers";

describe("annual lien interest rates", () => {
  it("reproduces the workbook's cached result when 14 percent is entered as an annual rate", () => {
    const sheet = acquisitionsInputFromFixture();                     // E22 holds =0.14/12, E21 holds 0
    const expected = acquisitions(sheet);
    const annual = acquisitions({ ...sheet, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0, firstAnnualRate: 0.14 });
    expect(annual.financing.firstInterestOnlyPaid).toBeCloseTo(9333.333333, 4);   // 200000 x 0.14 / 12 x 4, the cached F22
    expect(annual.financing.firstInterestOnlyPaid).toBeCloseTo(expected.financing.firstInterestOnlyPaid, 4);
    expect(annual.financing.total).toBeCloseTo(expected.financing.total, 4);
    expect(annual.netProfit).toBeCloseTo(expected.netProfit, 4);
    expect(annual.delayed.actualRoi).toBeCloseTo(expected.delayed.actualRoi, 6);
    expect(annual.upfront.actualRoi).toBeCloseTo(expected.upfront.actualRoi, 6);
  });

  it("ignores whatever sits in the two workbook rate cells once an annual rate is set", () => {
    const sheet = acquisitionsInputFromFixture();
    const clean = acquisitions({ ...sheet, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0, firstAnnualRate: 0.12 });
    const stale = acquisitions({ ...sheet, firstInterestRate: 0.12, firstMonthlyInterestOnlyRate: 0.05, firstAnnualRate: 0.12 });
    expect(stale.netProfit).toBeCloseTo(clean.netProfit, 6);
    expect(stale.financing.firstInterestPaid).toBe(0);
    // 12 percent a year on 200000 for 4 months is 8000, not the 96000 the sheet's F21 would charge for a typed 12 percent.
    expect(clean.financing.firstInterestOnlyPaid).toBeCloseTo(8000, 6);
  });

  it("accrues second lien interest per hold month, which the sheet's F25 does not", () => {
    const sheet = acquisitionsInputFromFixture();
    const out = acquisitions({ ...sheet, secondLienAmount: 50000, secondPointsRate: 0, secondAnnualRate: 0.12 });
    expect(out.financing.secondInterestPaid).toBe(0);
    expect(out.financing.secondInterestOnlyPaid).toBeCloseTo(50000 * 0.12 / 12 * sheet.holdMonths, 6);
  });

  it("leaves inputs alone when no annual rate is given, and treats zero as a real rate", () => {
    const sheet = acquisitionsInputFromFixture();
    expect(annualRates(sheet)).toBe(sheet);
    expect(annualRates({ ...sheet, firstAnnualRate: null })).toMatchObject({ firstMonthlyInterestOnlyRate: sheet.firstMonthlyInterestOnlyRate });
    expect(acquisitions({ ...sheet, firstAnnualRate: 0 }).financing.firstInterestOnlyPaid).toBe(0);
  });
});
